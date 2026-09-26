/**
 * Minimal glTF 2.0 binary (.glb) reader for the animation pipeline: node
 * hierarchy, rest transforms and keyframe sampling. Only what the pipeline
 * needs (float accessors, LINEAR/STEP samplers); no meshes or textures.
 */
import { readFileSync } from 'node:fs';
import { Matrix4, Quaternion, Vector3 } from 'three/webgpu';

interface Accessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4';
}

interface BufferView {
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}

interface GltfNode {
  name?: string;
  children?: number[];
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
}

interface Sampler {
  input: number;
  output: number;
  interpolation?: 'LINEAR' | 'STEP' | 'CUBICSPLINE';
}

interface Channel {
  sampler: number;
  target: { node?: number; path: 'translation' | 'rotation' | 'scale' | 'weights' };
}

interface GltfJson {
  nodes: GltfNode[];
  accessors: Accessor[];
  bufferViews: BufferView[];
  animations?: { name?: string; samplers: Sampler[]; channels: Channel[] }[];
  scenes?: { nodes: number[] }[];
}

const SIZE: Record<Accessor['type'], number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** Local transform of one node. */
export interface Trs {
  t: Vector3;
  r: Quaternion;
  s: Vector3;
}

interface Track {
  times: Float32Array;
  values: Float32Array;
  step: boolean;
}

export class Gltf {
  readonly json: GltfJson;
  private readonly bin: Buffer;
  readonly parent: number[];

  constructor(path: string) {
    const buf = readFileSync(path);
    if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} is not a GLB file`);
    const jsonLen = buf.readUInt32LE(12);
    this.json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as GltfJson;
    const binStart = 20 + jsonLen;
    const binLen = buf.readUInt32LE(binStart);
    this.bin = buf.subarray(binStart + 8, binStart + 8 + binLen);
    this.parent = this.json.nodes.map(() => -1);
    this.json.nodes.forEach((n, i) => n.children?.forEach((c) => (this.parent[c] = i)));
  }

  get names(): string[] {
    return this.json.nodes.map((n) => n.name ?? '');
  }

  nodeIndex(name: string): number {
    const i = this.json.nodes.findIndex((n) => n.name === name);
    if (i < 0) throw new Error(`no node '${name}'`);
    return i;
  }

  /** Reads a float accessor as a flat array. */
  accessor(index: number): Float32Array {
    const a = this.json.accessors[index];
    if (!a || a.bufferView === undefined) throw new Error(`bad accessor ${index}`);
    if (a.componentType !== 5126) throw new Error(`accessor ${index}: only float data is supported`);
    const view = this.json.bufferViews[a.bufferView];
    if (!view) throw new Error(`bad buffer view ${a.bufferView}`);
    const n = SIZE[a.type];
    const stride = view.byteStride ?? n * 4;
    const base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const out = new Float32Array(a.count * n);
    for (let i = 0; i < a.count; i++)
      for (let k = 0; k < n; k++) out[i * n + k] = this.bin.readFloatLE(base + i * stride + k * 4);
    return out;
  }

  /** Rest (node) transform of every node. */
  restPose(): Trs[] {
    return this.json.nodes.map((n) => ({
      t: new Vector3(...(n.translation ?? [0, 0, 0])),
      r: new Quaternion(...(n.rotation ?? [0, 0, 0, 1])),
      s: new Vector3(...(n.scale ?? [1, 1, 1])),
    }));
  }

  animationNames(): string[] {
    return (this.json.animations ?? []).map((a) => a.name ?? '');
  }

  /** An animation as a sampler of local node transforms. */
  animation(name: string): Animation {
    const anim = this.json.animations?.find((a) => a.name === name);
    if (!anim) throw new Error(`no animation '${name}'`);
    const tracks = new Map<string, Track>();
    let duration = 0;
    for (const ch of anim.channels) {
      const s = anim.samplers[ch.sampler];
      if (!s || ch.target.node === undefined || ch.target.path === 'weights') continue;
      if (s.interpolation === 'CUBICSPLINE') throw new Error('cubic spline tracks are not supported');
      const times = this.accessor(s.input);
      duration = Math.max(duration, times[times.length - 1] ?? 0);
      tracks.set(`${ch.target.node}:${ch.target.path}`, {
        times,
        values: this.accessor(s.output),
        step: s.interpolation === 'STEP',
      });
    }
    return new Animation(this, tracks, duration);
  }
}

export class Animation {
  constructor(
    private readonly gltf: Gltf,
    private readonly tracks: Map<string, Track>,
    readonly duration: number,
  ) {}

  /** Local transforms of all nodes at time t (rest values where a node has no track). */
  sample(t: number): Trs[] {
    const pose = this.gltf.restPose();
    pose.forEach((p, node) => {
      const tr = this.tracks.get(`${node}:translation`);
      if (tr) sampleVec(tr, t, p.t);
      const rr = this.tracks.get(`${node}:rotation`);
      if (rr) sampleQuat(rr, t, p.r);
      const sr = this.tracks.get(`${node}:scale`);
      if (sr) sampleVec(sr, t, p.s);
    });
    return pose;
  }
}

function locate(times: Float32Array, t: number): [number, number, number] {
  const n = times.length;
  if (n === 1 || t <= (times[0] ?? 0)) return [0, 0, 0];
  if (t >= (times[n - 1] ?? 0)) return [n - 1, n - 1, 0];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((times[mid] ?? 0) <= t) lo = mid;
    else hi = mid;
  }
  const a = times[lo] ?? 0;
  const b = times[hi] ?? 0;
  return [lo, hi, b > a ? (t - a) / (b - a) : 0];
}

function sampleVec(tr: Track, t: number, out: Vector3): void {
  const [i, j, f0] = locate(tr.times, t);
  const f = tr.step ? 0 : f0;
  const v = tr.values;
  out.set(
    (v[i * 3] ?? 0) * (1 - f) + (v[j * 3] ?? 0) * f,
    (v[i * 3 + 1] ?? 0) * (1 - f) + (v[j * 3 + 1] ?? 0) * f,
    (v[i * 3 + 2] ?? 0) * (1 - f) + (v[j * 3 + 2] ?? 0) * f,
  );
}

const _qa = new Quaternion();
const _qb = new Quaternion();
function sampleQuat(tr: Track, t: number, out: Quaternion): void {
  const [i, j, f] = locate(tr.times, t);
  const v = tr.values;
  _qa.set(v[i * 4] ?? 0, v[i * 4 + 1] ?? 0, v[i * 4 + 2] ?? 0, v[i * 4 + 3] ?? 1);
  _qb.set(v[j * 4] ?? 0, v[j * 4 + 1] ?? 0, v[j * 4 + 2] ?? 0, v[j * 4 + 3] ?? 1);
  out.slerpQuaternions(_qa, _qb, tr.step ? 0 : f);
}

/** Model-space (scene root) matrices of every node for a set of local transforms. */
export function worldMatrices(gltf: { readonly parent: readonly number[] }, pose: Trs[]): Matrix4[] {
  const out: Matrix4[] = new Array<Matrix4>(pose.length);
  const visit = (i: number): Matrix4 => {
    const done = out[i];
    if (done) return done;
    const p = pose[i];
    if (!p) throw new Error(`no pose for node ${i}`);
    const local = new Matrix4().compose(p.t, p.r, p.s);
    const parent = gltf.parent[i] ?? -1;
    const m = parent >= 0 ? new Matrix4().multiplyMatrices(visit(parent), local) : local;
    out[i] = m;
    return m;
  };
  for (let i = 0; i < pose.length; i++) visit(i);
  return out;
}
