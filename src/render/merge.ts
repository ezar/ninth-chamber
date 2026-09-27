/** Draw-call savings for static models built from many primitives. */
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Merges the static meshes under `root` into one mesh per material (their
 * transforms baked in), so a mechanism of twenty parts costs a draw call or
 * three. Children marked `userData.keep` (moving parts) are left alone.
 */
export function mergeStatic(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const merged: THREE.Mesh[] = [];
  const visit = (o: THREE.Object3D): void => {
    for (const c of o.children) {
      if (c.userData.keep) continue;
      if (c instanceof THREE.Mesh && !(c instanceof THREE.InstancedMesh) && !Array.isArray(c.material)) {
        const g = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
        for (const name of Object.keys(g.attributes))
          if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, c.matrixWorld));
        const list = byMaterial.get(c.material) ?? [];
        list.push(g);
        byMaterial.set(c.material, list);
        merged.push(c);
      } else if (!(c instanceof THREE.Mesh)) visit(c);
    }
  };
  visit(root);
  for (const [material, geos] of byMaterial) {
    if (geos.length < 2) continue;
    const geo = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!geo) continue;
    for (const m of merged) if (m.material === material) m.removeFromParent();
    root.add(new THREE.Mesh(geo, material));
  }
}
