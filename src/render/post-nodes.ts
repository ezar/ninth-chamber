/**
 * The post-processing nodes from three's addons (SMAA's lookup textures alone
 * are ~60 kB). Split into their own chunk and loaded by GameRenderer.init()
 * alongside the textures, so the main bundle stays lean.
 */
import type * as THREE from 'three/webgpu';
import DepthOfFieldNode from 'three/addons/tsl/display/DepthOfFieldNode.js';
import GodraysNode from 'three/addons/tsl/display/GodraysNode.js';

export { bloom } from 'three/addons/tsl/display/BloomNode.js';
export { depthAwareBlur } from 'three/addons/tsl/display/depthAwareBlur.js';
export { fxaa } from 'three/addons/tsl/display/FXAANode.js';
export { ao } from 'three/addons/tsl/display/GTAONode.js';
export { smaa } from 'three/addons/tsl/display/SMAANode.js';

/** Depth of field that skips its seven passes while no focus shot is running. */
export class GatedDepthOfField extends DepthOfFieldNode {
  active = false;

  override updateBefore(frame: THREE.NodeFrame): boolean | undefined {
    if (!this.active) return undefined;
    return super.updateBefore(frame);
  }
}

/** God rays that stop ray marching while no sun shines in the room. */
export class GatedGodrays extends GodraysNode {
  active = true;

  override updateBefore(frame: THREE.NodeFrame): boolean | undefined {
    if (!this.active) return undefined;
    return super.updateBefore(frame);
  }
}
