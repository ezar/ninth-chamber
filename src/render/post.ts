/**
 * Post-processing (spec §11 "Postproceso"), one RenderPipeline built from TSL
 * nodes. In HDR linear light: ambient occlusion (GTAO), depth of field for
 * focus shots, bloom, the room grade (saturation, tint, contrast). Then AgX
 * tone mapping, anti-aliasing on the display image (SMAA or FXAA), and last
 * the vignette and film grain so the AA pass never smears them.
 *
 * Which effects exist depends on the quality tier; the per-room values are
 * uniforms, so blending looks never recompiles anything.
 */
import * as THREE from 'three/webgpu';
import {
  float,
  fract,
  length,
  luminance,
  max,
  mix,
  pass,
  pow,
  rand,
  renderOutput,
  rtt,
  screenUV,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import DepthOfFieldNode from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { depthAwareBlur } from 'three/addons/tsl/display/depthAwareBlur.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';

export interface PostOptions {
  ambientOcclusion: boolean;
  antialias: 'smaa' | 'fxaa';
  bloom: boolean;
  depthOfField: boolean;
}

/** Depth of field that skips its seven passes while no focus shot is running. */
class GatedDepthOfField extends DepthOfFieldNode {
  active = false;

  override updateBefore(frame: THREE.NodeFrame): boolean | undefined {
    if (!this.active) return undefined;
    return super.updateBefore(frame);
  }
}

/** The display nodes are vec4 at runtime; their typings omit the swizzles. */
const vec4Node = (n: THREE.Node): THREE.Node<'vec4'> => n as unknown as THREE.Node<'vec4'>;

/** Mid-grey in linear light: the pivot of the log-space contrast. */
const CONTRAST_PIVOT = 0.18;
/** AO resolution relative to the drawing buffer. */
const AO_SCALE = 0.5;
/** Film grain cadence (updates per second): film, not video noise. */
const GRAIN_FPS = 24;

export class PostStack {
  // Per-room grade and effect strengths (spec §11 "LUT por sala", art/looks/*.json).
  readonly tint = uniform(new THREE.Color('#ffffff'));
  readonly saturation = uniform(1);
  readonly contrast = uniform(1);
  readonly vignette = uniform(0.35);
  readonly grain = uniform(0.035);
  readonly aoStrength = uniform(0.85);
  readonly bloomStrength = uniform(0.5);
  readonly bloomRadius = uniform(0.5);
  readonly bloomThreshold = uniform(0.8);
  // Depth of field.
  readonly dofAmount = uniform(0);
  readonly focusDistance = uniform(8);
  readonly focusRange = uniform(3);
  readonly bokehScale = uniform(6);

  private readonly grainSeed = uniform(0);
  private readonly aspect = uniform(16 / 9);
  private readonly aoTexel = uniform(new THREE.Vector2(1 / 960, 1 / 540));

  private pipeline: THREE.RenderPipeline | null = null;
  private scenePass: ReturnType<typeof pass> | null = null;
  private dof: GatedDepthOfField | null = null;
  private disposables: { dispose(): void }[] = [];
  private options: PostOptions | null = null;
  private renderScale = 1;
  private grainClock = 0;

  constructor(
    private readonly renderer: THREE.WebGPURenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {}

  /** (Re)builds the pipeline when the enabled effects change. */
  configure(options: PostOptions): void {
    const o = this.options;
    if (
      o &&
      o.ambientOcclusion === options.ambientOcclusion &&
      o.antialias === options.antialias &&
      o.bloom === options.bloom &&
      o.depthOfField === options.depthOfField
    ) {
      return;
    }
    this.options = { ...options };
    this.build(options);
  }

  private build(options: PostOptions): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.pipeline?.dispose();

    const camera = this.camera;
    // No MSAA on the scene target: edges are handled by SMAA/FXAA on the display image.
    const scenePass = pass(this.scene, camera, { samples: 0 });
    scenePass.setResolutionScale(this.renderScale);
    this.scenePass = scenePass;
    this.disposables.push(scenePass);
    const color = scenePass.getTextureNode('output');
    const depth = scenePass.getTextureNode('depth');

    let hdr = color.rgb;

    if (options.depthOfField) {
      const dof = new GatedDepthOfField(
        color,
        scenePass.getViewZNode(),
        this.focusDistance,
        this.focusRange,
        this.bokehScale,
      );
      this.dof = dof;
      this.disposables.push(dof);
      hdr = mix(hdr, vec4Node(dof).rgb, this.dofAmount);
    } else {
      this.dof = null;
    }

    if (options.ambientOcclusion) {
      // Normals are reconstructed from depth: no MRT, so additive sprites and
      // light shafts cannot corrupt them.
      const aoPass = ao(depth, null as unknown as THREE.Node, camera);
      aoPass.resolutionScale = AO_SCALE;
      aoPass.radius.value = 0.45;
      aoPass.thickness.value = 0.9;
      aoPass.samples.value = 16;
      this.disposables.push(aoPass);
      // GTAO's noise tiles every 5 px: a separable depth-aware blur removes it without haloes.
      const aoRaw = aoPass.getTextureNode();
      const blurX = rtt(depthAwareBlur(aoRaw, depth, vec2(this.aoTexel.x, 0), camera, 2, 1), null, null, {
        resolutionScale: AO_SCALE,
      });
      this.disposables.push(blurX);
      const occlusion = depthAwareBlur(blurX, depth, vec2(0, this.aoTexel.y), camera, 2, 1);
      // Occlusion is about ambient light: keep flames, sunlit stone and the relic clean.
      const lit = smoothstep(0.5, 2.5, luminance(hdr));
      hdr = hdr.mul(mix(float(1), occlusion, this.aoStrength.mul(lit.oneMinus())));
    }

    if (options.bloom) {
      const glow = bloom(color, this.bloomStrength, this.bloomRadius, this.bloomThreshold);
      this.disposables.push(glow);
      hdr = hdr.add(glow.rgb);
    }

    // Room grade in linear light: saturation, tint, then contrast in log space
    // around mid-grey on luminance only, so shadows deepen without clipping or hue shifts.
    const saturated = mix(vec3(luminance(hdr)), hdr, this.saturation);
    const tinted = saturated.mul(mix(vec3(1, 1, 1), this.tint, 0.5));
    const lum = max(luminance(tinted), 1e-5);
    const contrasted = tinted.mul(pow(lum.div(CONTRAST_PIVOT), this.contrast).mul(CONTRAST_PIVOT).div(lum));

    // AgX and sRGB (from the renderer's tone mapping and exposure), then AA on the display image.
    const display = renderOutput(vec4(contrasted, 1));
    const aa = options.antialias === 'smaa' ? smaa(display) : fxaa(display);
    this.disposables.push(aa);

    // Vignette: a soft elliptical falloff that only really darkens the corners.
    const centered = screenUV
      .sub(0.5)
      .mul(vec2(this.aspect.mul(0.75).max(1), 1))
      .mul(2);
    const vig = smoothstep(0.55, 1.6, length(centered)).mul(this.vignette).mul(0.9);
    let out = vec4Node(aa).rgb.mul(float(1).sub(vig));

    // Film grain: strongest in the midtones, absent in black and white.
    const noise = rand(screenUV.add(fract(vec2(this.grainSeed.mul(0.1731), this.grainSeed.mul(0.3317))))).sub(
      0.5,
    );
    const l = luminance(out);
    const weight = l.mul(l.oneMinus()).mul(4).add(0.15).min(1);
    out = out.add(noise.mul(this.grain).mul(weight));

    const pipeline = new THREE.RenderPipeline(this.renderer);
    pipeline.outputColorTransform = false;
    pipeline.outputNode = vec4(out, 1);
    this.pipeline = pipeline;
  }

  /** Scene render scale for dynamic resolution; post effects stay at the output resolution. */
  setRenderScale(scale: number): void {
    this.renderScale = scale;
    this.scenePass?.setResolutionScale(scale);
  }

  get hasDepthOfField(): boolean {
    return this.dof !== null;
  }

  /** Output size in drawing-buffer pixels. */
  setSize(width: number, height: number): void {
    this.aspect.value = width / Math.max(1, height);
    this.aoTexel.value.set(1 / Math.max(1, width * AO_SCALE), 1 / Math.max(1, height * AO_SCALE));
    // Bokeh radius in full-resolution pixels, tuned at 1080p.
    this.bokehScale.value = 7 * (height / 1080);
  }

  render(dt: number): void {
    if (!this.pipeline) return;
    this.grainClock += dt;
    const frame = Math.floor(this.grainClock * GRAIN_FPS);
    this.grainSeed.value = frame % 997;
    if (this.dof) this.dof.active = this.dofAmount.value > 0.005;
    this.pipeline.render();
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.pipeline?.dispose();
    this.pipeline = null;
  }
}
