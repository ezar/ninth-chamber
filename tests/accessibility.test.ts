/**
 * Accessibility helpers (spec §13 "Accesibilidad"): which sounds get a
 * caption and from which side, and which edges the high-contrast mode marks.
 */
import { describe, expect, it } from 'vitest';
import { CAPTION_RANGE, CaptionGate, captionFor } from '../src/ui/captions';
import { grabEdges } from '../src/sim/grid/edges';
import { ledgeAhead } from '../src/sim/grid/collision';
import { DIR_VEC, type Dir } from '../src/sim/grid/units';
import { testLevel } from './helpers';
import { defaultSettings, loadSettings } from '../src/ui/settings';

const ev = (type: string, extra: Record<string, unknown> = {}) => ({ type, tick: 0, id: 'a', ...extra });
const me = { x: 0, z: 0 };

describe('captions', () => {
  it('name the side a sound comes from, relative to the camera', () => {
    // Camera yaw 0 looks north (-Z).
    expect(captionFor(ev('darts.click'), { x: 0, z: -6 }, me, 0)?.side).toBe('ahead');
    expect(captionFor(ev('darts.click'), { x: 6, z: 0 }, me, 0)?.side).toBe('right');
    expect(captionFor(ev('darts.click'), { x: -6, z: 0 }, me, 0)?.side).toBe('left');
    expect(captionFor(ev('darts.click'), { x: 0, z: 6 }, me, 0)?.side).toBe('behind');
    // Turned to face east, a sound in the north is on the left.
    expect(captionFor(ev('darts.click'), { x: 0, z: -6 }, me, -Math.PI / 2)?.side).toBe('left');
    expect(captionFor(ev('darts.click'), { x: 1, z: 0 }, me, 0)?.side).toBe('near');
  });

  it('mark traps, skip sounds without a caption and sounds out of earshot', () => {
    expect(captionFor(ev('boulder.warning'), { x: 0, z: -4 }, me, 0)?.trap).toBe(true);
    expect(captionFor(ev('door.opening'), { x: 0, z: -4 }, me, 0)?.trap).toBe(false);
    expect(captionFor(ev('player.jumped'), me, me, 0)).toBeNull();
    expect(captionFor(ev('darts.click'), { x: CAPTION_RANGE + 1, z: 0 }, me, 0)).toBeNull();
  });

  it('caption enemies by kind', () => {
    expect(captionFor(ev('enemy.alerted', { enemy: 'jackal' }), me, me, 0)?.key).toBe(
      'caption.jackalAlerted',
    );
    expect(captionFor(ev('enemy.reformed', { enemy: 'clay' }), me, me, 0)?.key).toBe('caption.clayReformed');
    expect(captionFor(ev('enemy.reformed', { enemy: 'jackal' }), me, me, 0)).toBeNull();
  });

  it('keep a repeating sound from flooding the screen', () => {
    const gate = new CaptionGate();
    const c = captionFor(ev('blade.swish'), me, me, 0);
    if (!c) throw new Error('no caption');
    expect(gate.allow(c, 0)).toBe(true);
    expect(gate.allow(c, 2)).toBe(false);
    expect(gate.allow(c, 9)).toBe(true);
  });
});

describe('high-contrast edges', () => {
  it('match every ledge the controller can grab', () => {
    const w = testLevel(['#######', '#..4..#', '#.....#', '#.2.8.#', '#..S..#', '#######']);
    const edges = grabEdges(w.level);
    // From each floor cell, each direction: a ledge is grabbable exactly where an edge is drawn.
    for (const s of w.level.allSectors()) {
      if (s.wall) continue;
      for (const dir of ['N', 'E', 'S', 'W'] as Dir[]) {
        const v = DIR_VEC[dir];
        const hit = ledgeAhead(w.grid, s.cx * 2 + 1, s.cz * 2 + 1, dir);
        // The shared side of the cell and its neighbour, and a point in its middle.
        const bx = v.x === 0 ? s.cx * 2 + 1 : (s.cx + (v.x > 0 ? 1 : 0)) * 2;
        const bz = v.z === 0 ? s.cz * 2 + 1 : (s.cz + (v.z > 0 ? 1 : 0)) * 2;
        const drawn = edges.some(
          (e) =>
            e.y === hit?.y &&
            e.nx === -v.x &&
            e.nz === -v.z &&
            Math.min(e.x1, e.x2) <= bx &&
            Math.max(e.x1, e.x2) >= bx &&
            Math.min(e.z1, e.z2) <= bz &&
            Math.max(e.z1, e.z2) >= bz,
        );
        expect(drawn, `${s.cx},${s.cz} ${dir}`).toBe(hit !== null);
      }
    }
    // The two free columns have a lip on all four sides, the one against the north wall on three.
    expect(edges).toHaveLength(11);
  });
});

describe('accessibility settings', () => {
  it('fall back to safe defaults on bad values', () => {
    const store = {
      getItem: () =>
        JSON.stringify({
          gameSpeed: 0.5,
          actionMode: 'toggle',
          touchSize: 9,
          subtitleSize: 'huge',
          version: 3,
        }),
      setItem: () => undefined,
    };
    const s = loadSettings(store, defaultSettings());
    expect(s.gameSpeed).toBe(1);
    expect(s.actionMode).toBe('toggle');
    expect(s.touchSize).toBe(1.4);
    expect(s.subtitleSize).toBe('medium');
    expect(s.trapCues).toBe(true);
  });
});
