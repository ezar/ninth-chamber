/**
 * FBX source files for the clip pipeline (Mixamo downloads), read with
 * three's FBXLoader in Node. Exposes the same shape as the GLB reader: node
 * names and hierarchy, rest transforms and animations sampled as local
 * transforms.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import type { Trs } from './gltf';

export interface SourceAnimation {
  readonly duration: number;
  sample(t: number): Trs[];
}

/** A skeleton with animations: what build-clips.ts reads from a GLB or an FBX file. */
export interface SourceFile {
  readonly names: readonly string[];
  readonly parent: readonly number[];
  restPose(): Trs[];
  animationNames(): string[];
  animation(name: string): SourceAnimation;
}

/** FBXLoader creates images for embedded textures; Node has no DOM, and the pipeline needs no textures. */
function stubDom(): void {
  const g = globalThis as { document?: unknown };
  if (g.document) return;
  const element = { addEventListener: (): void => {}, removeEventListener: (): void => {}, style: {} };
  g.document = { createElementNS: () => ({ ...element }) };
}

export class Fbx implements SourceFile {
  readonly names: string[] = [];
  readonly parent: number[] = [];
  private readonly nodes: THREE.Object3D[] = [];
  private readonly rest: Trs[] = [];
  private readonly clips: THREE.AnimationClip[];

  constructor(path: string) {
    const buf = readFileSync(path);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    stubDom();
    const group = new FBXLoader().parse(ab, '');
    group.updateMatrixWorld(true);
    group.traverse((o) => {
      this.nodes.push(o);
    });
    this.nodes.forEach((o) => {
      this.names.push(o.name);
      this.parent.push(o.parent ? this.nodes.indexOf(o.parent) : -1);
      this.rest.push({ t: o.position.clone(), r: o.quaternion.clone(), s: o.scale.clone() });
    });
    this.clips = group.animations;
  }

  restPose(): Trs[] {
    return this.rest.map((p) => ({ t: p.t.clone(), r: p.r.clone(), s: p.s.clone() }));
  }

  animationNames(): string[] {
    return this.clips.map((c) => c.name);
  }

  animation(name: string): SourceAnimation {
    const clip = this.clips.find((c) => c.name === name);
    if (!clip) throw new Error(`no animation '${name}'`);
    const tracks = clip.tracks.map((track) => {
      const dot = track.name.lastIndexOf('.');
      const node = this.names.indexOf(track.name.slice(0, dot));
      const interp =
        track instanceof THREE.QuaternionKeyframeTrack
          ? new THREE.QuaternionLinearInterpolant(track.times, track.values, 4)
          : new THREE.LinearInterpolant(track.times, track.values, track.getValueSize());
      return { node, prop: track.name.slice(dot + 1), interp };
    });
    return {
      duration: clip.duration,
      sample: (t: number): Trs[] => {
        const pose = this.restPose();
        for (const tr of tracks) {
          const p = pose[tr.node];
          if (!p) continue;
          const v = tr.interp.evaluate(Math.min(clip.duration, Math.max(0, t)));
          if (tr.prop === 'position') p.t.set(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
          else if (tr.prop === 'quaternion') p.r.set(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 1).normalize();
          else if (tr.prop === 'scale') p.s.set(v[0] ?? 1, v[1] ?? 1, v[2] ?? 1);
        }
        return pose;
      },
    };
  }
}
