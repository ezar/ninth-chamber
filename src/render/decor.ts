/**
 * Set dressing with a model of its own (`decor` entities: the Clay Archive's
 * kiln, the Forge's mould), standing on its cell's floor and facing its `face`.
 * The cell is solid in the simulation unless the entity says otherwise; nothing shows until the model has loaded. Each
 * stands in a holder placed from the start, which room culling files in its
 * room (the group itself is flattened, like the monuments).
 */
import * as THREE from 'three/webgpu';
import type { Level } from '../sim/grid/level';
import { BLOCK, DIR_YAW } from '../sim/grid/units';
import { fitCopy, loadStaticModel, type Fit } from './static-models';

/**
 * How big each model is drawn: within its cell, which is all the simulation makes solid
 * (a little inside it, so Nora's shoulder does not sink into the model).
 */
const FITS: Readonly<Record<string, Fit>> = {
  kiln: { width: BLOCK - 0.1, origin: 'bottom' },
  mould: { width: BLOCK - 0.1, origin: 'bottom', brightness: 1.4 },
};

export class DecorViews {
  readonly group = new THREE.Group();
  private readonly materials: THREE.Material[] = [];

  constructor(level: Level) {
    this.group.name = 'decor';
    for (const e of level.entities) {
      if (e.type !== 'decor') continue;
      const [cx, cz] = e.at;
      const x = cx * BLOCK + BLOCK / 2;
      const z = cz * BLOCK + BLOCK / 2;
      const y = level.floorAt(x, z);
      const fit = FITS[e.model];
      if (!fit) continue;
      // The holder stands in its cell from the start, so room culling files it in its room.
      const holder = new THREE.Group();
      holder.position.set(x, y, z);
      holder.rotation.y = DIR_YAW[e.face];
      this.group.add(holder);
      void loadStaticModel(e.model).then((model) => {
        if (!model) return;
        const { root, materials } = fitCopy(model, fit);
        this.materials.push(...materials);
        holder.add(root);
      });
    }
  }

  dispose(): void {
    for (const m of this.materials) m.dispose();
  }
}
