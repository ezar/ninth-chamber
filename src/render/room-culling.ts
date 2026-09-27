/**
 * Draws only the rooms the camera can see (render/rooms.ts): every static
 * mesh, prop, particle system and sprite that belongs to one room lives in
 * that room's group, and groups of rooms out of sight are hidden. Lights are
 * never hidden here (a changing light count recompiles every material); their
 * cost is bounded by pools elsewhere.
 */
import * as THREE from 'three/webgpu';
import type { Level } from '../sim/grid/level';
import { BLOCK } from '../sim/grid/units';
import { roomAtPoint, roomGraph, visibleRooms, type Portal, type RoomGraph } from './rooms';

/** How many portals deep visibility reaches (spec §14). */
const MAX_DEPTH = 3;

const box = new THREE.Box3();
const portalBox = new THREE.Box3();
const centre = new THREE.Vector3();
const viewProjection = new THREE.Matrix4();

export class RoomCulling {
  readonly graph: RoomGraph;
  private readonly groups = new Map<string, THREE.Group>();
  private readonly visible = new Set<string>();
  private readonly start: string[] = [];
  private readonly frustum = new THREE.Frustum();
  private readonly seen = (p: Portal): boolean => {
    portalBox.min.set(p.box.min.x, p.box.min.y, p.box.min.z);
    portalBox.max.set(p.box.max.x, p.box.max.y, p.box.max.z);
    return this.frustum.intersectsBox(portalBox);
  };
  /** Children of adopted parents at the last sweep, to notice new ones cheaply. */
  private readonly adoptedCounts = new Map<THREE.Object3D, number>();
  private enabled = true;

  constructor(
    private readonly level: Level,
    parent: THREE.Object3D,
  ) {
    this.graph = roomGraph(level);
    for (const r of level.rooms) {
      const g = new THREE.Group();
      g.name = `room:${r.id}`;
      this.groups.set(r.id, g);
      parent.add(g);
    }
  }

  /** The group holding a room's objects (at the origin, so world positions stay as they are). */
  group(room: string): THREE.Group | undefined {
    return this.groups.get(room);
  }

  /** Rooms drawn this frame. */
  get rooms(): ReadonlySet<string> {
    return this.visible;
  }

  /**
   * The room an object lies in, from its bounds; null when it spans several
   * rooms (or none), in which case it stays where it is and is always drawn.
   */
  roomOf(o: THREE.Object3D): string | null {
    o.updateWorldMatrix(true, true);
    if (o instanceof THREE.InstancedMesh) {
      if (!o.boundingBox) o.computeBoundingBox();
      box.copy(o.boundingBox ?? box.makeEmpty()).applyMatrix4(o.matrixWorld);
    } else {
      box.setFromObject(o);
    }
    if (box.isEmpty()) box.setFromCenterAndSize(o.getWorldPosition(centre), centre.set(0, 0, 0));
    box.getCenter(centre);
    const at = roomAtPoint(this.level, centre.x, centre.z);
    if (!at) return null;
    // Small things (a prop, a door in its doorway) go with the room of their centre.
    if (box.max.x - box.min.x <= BLOCK * 2.5 && box.max.z - box.min.z <= BLOCK * 2.5) return at;
    const corners = [
      roomAtPoint(this.level, box.min.x + 0.01, box.min.z + 0.01),
      roomAtPoint(this.level, box.max.x - 0.01, box.min.z + 0.01),
      roomAtPoint(this.level, box.min.x + 0.01, box.max.z - 0.01),
      roomAtPoint(this.level, box.max.x - 0.01, box.max.z - 0.01),
    ];
    return corners.every((c) => c === at || c === null) ? at : null;
  }

  /** Moves an object into its room's group (it must not sit under a transformed parent). */
  place(o: THREE.Object3D, room: string | null = this.roomOf(o)): void {
    const g = room ? this.groups.get(room) : undefined;
    if (g && o.parent !== g) g.add(o);
  }

  /**
   * Moves the children of `parent` (an untransformed group) into their rooms,
   * except those `keep` accepts. Children of groups named in `flatten` are
   * sorted one by one. Cheap when nothing was added since the last call.
   */
  adopt(parent: THREE.Object3D, keep: (o: THREE.Object3D) => boolean, flatten: ReadonlySet<string>): void {
    if (this.adoptedCounts.get(parent) === parent.children.length) return;
    for (const child of [...parent.children]) {
      if (keep(child)) continue;
      if (flatten.has(child.name)) {
        for (const c of [...child.children]) this.place(c);
        parent.remove(child);
        continue;
      }
      this.place(child);
    }
    this.adoptedCounts.set(parent, parent.children.length);
  }

  /** Whether a point lies in a room drawn this frame (anything outside the rooms counts as drawn). */
  readonly shows = (x: number, z: number): boolean => {
    if (!this.enabled || this.visible.size === 0) return true;
    const room = roomAtPoint(this.level, x, z);
    return room === null || this.visible.has(room);
  };

  /** Culling off draws every room (warm-up, debugging). */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) for (const g of this.groups.values()) g.visible = true;
  }

  /** Shows the rooms visible from the camera (and from the player's room). */
  update(camera: THREE.Camera, player: { x: number; z: number }): void {
    if (!this.enabled) return;
    camera.updateMatrixWorld();
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(viewProjection);
    this.start.length = 0;
    const cam = roomAtPoint(this.level, camera.position.x, camera.position.z);
    const own = roomAtPoint(this.level, player.x, player.z);
    if (cam) this.start.push(cam);
    if (own && own !== cam) this.start.push(own);
    visibleRooms(this.graph, this.start, this.seen, MAX_DEPTH, this.visible);
    // Outside the level entirely (a cinematic shot): draw everything rather than nothing.
    const all = this.visible.size === 0;
    for (const [id, g] of this.groups) g.visible = all || this.visible.has(id);
  }
}
