/**
 * Room camera framing (spec §19, chamber VII: "vistas verticales y encuadres
 * fijos en la travesía"): a room can set a preferred pitch looking up or down
 * its shaft, a distance, and a fixed shot the camera eases into and out of.
 */
import { describe, expect, it } from 'vitest';
import { OrbitCamera } from '../src/camera/orbit';
import { Level } from '../src/sim/grid/level';
import { validateLevel } from '../src/sim/grid/validate';
import { testLevel } from './helpers';

const DEG = Math.PI / 180;
const DT = 1 / 60;

function settle(cam: OrbitCamera, grid: ReturnType<typeof testLevel>['grid'], seconds: number): void {
  const at = { x: 11, y: 0, z: 13 };
  for (let i = 0; i < seconds / DT; i++) cam.update(at, false, grid, DT);
}

describe('camera framing', () => {
  // A large hall, the camera's subject in its middle: nothing near to pull the camera in.
  const rows = ['###########', ...Array<string>(12).fill('#.........#'), '###########'];
  rows[4] = '#.S.......#';
  const w = testLevel(rows, { ceil: 60 });

  it('eases the pitch to the room’s once the player leaves the camera alone', () => {
    const cam = new OrbitCamera();
    cam.setFraming({ pitch: -35 * DEG, distance: null, shot: null });
    settle(cam, w.grid, 5);
    expect(cam.pitch).toBeCloseTo(-35 * DEG, 2);
  });

  it('keeps the room’s pitch while she runs and the lazy follow turns the camera', () => {
    const cam = new OrbitCamera();
    cam.setFraming({ pitch: -35 * DEG, distance: null, shot: null });
    const at = { x: 11, y: 0, z: 13 };
    for (let i = 0; i < 6 / DT; i++) cam.update(at, false, w.grid, DT, { vx: 5.4, vz: 0, vy: 0 });
    expect(cam.pitch).toBeCloseTo(-35 * DEG, 2);
  });

  it('travels from one fixed shot to the next without a cut', () => {
    const cam = new OrbitCamera();
    const a = { x: 3, y: 6, z: 3 };
    const b = { x: 19, y: 6, z: 3 };
    cam.setFraming({ pitch: null, distance: null, shot: a });
    settle(cam, w.grid, 6);
    cam.setFraming({ pitch: null, distance: null, shot: b });
    const x0 = cam.eye.x;
    settle(cam, w.grid, DT);
    expect(Math.abs(cam.eye.x - x0)).toBeLessThan(1);
    settle(cam, w.grid, 6);
    expect(cam.eye.x).toBeCloseTo(b.x, 1);
  });

  it('lets the player look further up in a room framed looking up', () => {
    const free = new OrbitCamera();
    free.look(0, -10_000, 0);
    const framed = new OrbitCamera();
    framed.setFraming({ pitch: -35 * DEG, distance: null, shot: null });
    framed.look(0, -10_000, 0);
    expect(framed.pitch).toBeLessThan(free.pitch - 20 * DEG);
  });

  it('pulls the camera to the room’s distance', () => {
    const cam = new OrbitCamera();
    cam.setFraming({ pitch: null, distance: 8, shot: null });
    settle(cam, w.grid, 5);
    expect(cam.currentDistance).toBeCloseTo(8, 1);
  });

  it('moves into a fixed shot and out of it again on leaving the room', () => {
    const cam = new OrbitCamera();
    const shot = { x: 3, y: 6, z: 3 };
    cam.setFraming({ pitch: null, distance: null, shot });
    settle(cam, w.grid, 6);
    expect(Math.hypot(cam.eye.x - shot.x, cam.eye.y - shot.y, cam.eye.z - shot.z)).toBeLessThan(0.05);
    // Still watching her.
    expect(cam.lookAt.x).toBeCloseTo(11, 0);
    cam.setFraming(null);
    settle(cam, w.grid, 6);
    expect(Math.hypot(cam.eye.x - shot.x, cam.eye.y - shot.y, cam.eye.z - shot.z)).toBeGreaterThan(2);
  });
});

describe('room camera entries', () => {
  it('parse into world units: degrees to radians, the shot from room cell and clicks', () => {
    const level = Level.parse({
      schema: 1,
      id: 't',
      name: 't',
      start: { room: 'shaft', at: [1, 1], face: 'N' },
      rooms: [
        {
          id: 'shaft',
          origin: [4, 6, 2],
          ceil: 40,
          legend: { '#': 'wall', '.': 0 },
          rows: ['####', '#..#', '#..#', '####'],
          camera: { pitch: -30, distance: 7, shot: [1, 2, 10] },
        },
      ],
      entities: [],
      logic: [],
    });
    const cam = level.rooms[0]?.camera;
    expect(cam?.pitch).toBeCloseTo(-30 * DEG, 6);
    expect(cam?.distance).toBe(7);
    // Cell (4 + 1, 6 + 2) centre, height (2 + 10) clicks.
    expect(cam?.shot).toEqual({ x: 11, y: 6, z: 17 });
  });

  it('fail validation when the shot sits on the floor or the ceiling', () => {
    const lv = (h: number): unknown => ({
      schema: 1,
      id: 't',
      name: 't',
      start: { room: 'r', at: [1, 1], face: 'N' },
      rooms: [
        {
          id: 'r',
          origin: [0, 0, 0],
          ceil: 20,
          legend: { '#': 'wall', '.': 0 },
          rows: ['####', '#..#', '#..#', '####'],
          camera: { shot: [2, 2, h] },
        },
      ],
      entities: [],
      logic: [],
    });
    const shotError = (h: number): boolean =>
      validateLevel(lv(h)).errors.some((e) => e.includes('camera shot'));
    expect(shotError(0)).toBe(true);
    expect(shotError(20)).toBe(true);
    expect(shotError(10)).toBe(false);
  });

  it('are optional', () => {
    const w = testLevel(['#####', '#...#', '#.S.#', '#####']);
    expect(w.level.rooms[0]?.camera).toBeNull();
  });
});

describe('camera behind Nora for tank controls', () => {
  const rows = ['###########', ...Array<string>(12).fill('#.........#'), '###########'];
  rows[4] = '#.S.......#';
  const w = testLevel(rows, { ceil: 60 });

  it('turns behind the way she faces, even standing still', () => {
    const cam = new OrbitCamera();
    cam.chase = Math.PI / 2;
    settle(cam, w.grid, 4);
    expect(
      Math.abs(Math.atan2(Math.sin(cam.yaw - Math.PI / 2), Math.cos(cam.yaw - Math.PI / 2))),
    ).toBeLessThan(0.02);
  });

  it('leaves the camera alone while the player looks around', () => {
    const cam = new OrbitCamera();
    cam.chase = Math.PI / 2;
    cam.look(200, 0, 0);
    const yaw = cam.yaw;
    const at = { x: 11, y: 0, z: 13 };
    cam.update(at, false, w.grid, DT);
    expect(cam.yaw).toBeCloseTo(yaw, 5);
  });
});
