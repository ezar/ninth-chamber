/**
 * Set dressing with a model of its own (`decor` entities: the Clay Archive's
 * kiln, the Forge's mould), standing on its cell's floor and facing its `face`.
 * The cell is solid in the simulation unless the entity says otherwise; nothing shows until the model has loaded. Each
 * stands in a holder placed from the start, which room culling files in its
 * room (the group itself is flattened, like the monuments).
 *
 * The Wind Stair's levers also get a stone flute beside them: each lever opens
 * or shuts a flute's wind, so the flute stands against the same wall.
 */
import * as THREE from 'three/webgpu';
import type { Level } from '../sim/grid/level';
import { BLOCK, DIR_VEC, DIR_YAW, type Dir } from '../sim/grid/units';
import { fitCopy, loadStaticModel, type Fit } from './static-models';

/**
 * How big each model is drawn: within its cell, which is all the simulation makes solid
 * (a little inside it, so Nora's shoulder does not sink into the model).
 */
const FITS: Readonly<Record<string, Fit>> = {
  kiln: { width: BLOCK - 0.1, origin: 'bottom' },
  mould: { width: BLOCK - 0.1, origin: 'bottom', brightness: 1.4 },
};

/** The flutes beside the Wind Stair's levers: against the lever's wall, to one side of it. */
const FLUTE: Fit = { height: 1.5, origin: 'bottom' };
const AWAY: Record<Dir, Dir> = { N: 'S', S: 'N', E: 'W', W: 'E' };

export class DecorViews {
  readonly group = new THREE.Group();
  private readonly materials: THREE.Material[] = [];

  constructor(level: Level) {
    this.group.name = 'decor';
    if (level.id === 'wind_stair') this.flutes(level);
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

  /** A stone flute against the wall of each lever, a little to its side, facing the room. */
  private flutes(level: Level): void {
    for (const e of level.entities) {
      if (e.type !== 'lever') continue;
      const [cx, cz] = e.at;
      const back = DIR_VEC[e.wall];
      // Along the wall, to the lever's side: the flute stands where it does not hide the handle.
      const side = { x: -back.z, z: back.x };
      const x = cx * BLOCK + BLOCK / 2 + back.x * (BLOCK / 2 - 0.35) + side.x * 0.6;
      const z = cz * BLOCK + BLOCK / 2 + back.z * (BLOCK / 2 - 0.35) + side.z * 0.6;
      const holder = new THREE.Group();
      holder.position.set(x, level.floorAt(x, z), z);
      holder.rotation.y = DIR_YAW[AWAY[e.wall]];
      this.group.add(holder);
      void loadStaticModel('flute').then((model) => {
        if (!model) return;
        const { root, materials } = fitCopy(model, FLUTE);
        this.materials.push(...materials);
        holder.add(root);
      });
    }
  }

  dispose(): void {
    for (const m of this.materials) m.dispose();
  }
}
