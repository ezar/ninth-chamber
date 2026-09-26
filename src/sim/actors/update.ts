/**
 * Per-tick update of level mechanisms: doors, falling blocks, plates,
 * collapsing tiles, zones and auto-pickups.
 */
import { BLOCK } from '../grid/units';
import { setSignal } from '../logic/rules';
import { mechanics } from '../player/tuning';
import { tileState, type World } from '../world';

export function updateActors(world: World, dt: number): void {
  const { state, events, level } = world;
  const tick = world.tick;
  const p = state.player;
  const pcx = Math.floor(p.pos.x / BLOCK);
  const pcz = Math.floor(p.pos.z / BLOCK);
  const onGround = p.mode === 'ground' || p.mode === 'block' || p.mode === 'lever' || p.mode === 'pickup';

  for (const a of state.actors) {
    switch (a.kind) {
      case 'door': {
        if (a.closeIn !== null && a.open >= 1) {
          a.closeIn -= dt;
          if (a.closeIn <= 0) {
            a.closeIn = null;
            a.target = 0;
            events.emit({ type: 'door.closing', tick, id: a.id });
          }
        }
        // A closing door waits while the player stands in its doorway.
        const blocked = a.target === 0 && pcx === a.cx && pcz === a.cz;
        if (!blocked && a.open !== a.target) {
          const step = mechanics.doorSpeed * dt;
          a.open = a.target === 1 ? Math.min(1, a.open + step) : Math.max(0, a.open - step);
          if (a.open === a.target)
            events.emit({ type: a.target === 1 ? 'door.opened' : 'door.closed', tick, id: a.id });
        }
        setSignal(world, `${a.id}.open`, a.open >= 1);
        break;
      }
      case 'block': {
        if (a.fallTo !== null) {
          a.y = Math.max(a.fallTo, a.y - mechanics.blockFallSpeed * dt);
          if (a.y === a.fallTo) {
            a.fallTo = null;
            events.emit({ type: 'block.landed', tick, id: a.id });
          }
        }
        break;
      }
      case 'plate': {
        const byBlock = state.actors.some(
          (b) => b.kind === 'block' && b.cx === a.cx && b.cz === a.cz && b.from === null && b.fallTo === null,
        );
        const byPlayer = onGround && pcx === a.cx && pcz === a.cz;
        const pressed = byBlock || byPlayer;
        if (pressed !== a.pressed) {
          a.pressed = pressed;
          events.emit({ type: pressed ? 'plate.pressed' : 'plate.released', tick, id: a.id });
        }
        setSignal(world, `${a.id}.pressed`, pressed);
        break;
      }
      case 'zone': {
        const inside =
          pcx >= a.cx && pcx < a.cx + a.w && pcz >= a.cz && pcz < a.cz + a.h && p.mode !== 'dead';
        if (inside && !a.inside) setSignal(world, `${a.id}.entered`, true);
        a.inside = inside;
        break;
      }
      case 'medkit': {
        if (!a.taken && onGround && pcx === a.cx && pcz === a.cz) {
          a.taken = true;
          state.inventory[`medkit_${a.variant}`] = (state.inventory[`medkit_${a.variant}`] ?? 0) + 1;
          world.stats.medkits++;
          events.emit({ type: 'pickup', tick, id: a.id, kind: 'medkit', variant: a.variant });
        }
        break;
      }
      default:
        break;
    }
  }

  // Collapsing tiles: they crack when stood on and fall after a short warning.
  const here = level.sector(pcx, pcz);
  if (here?.flags.has('crumble') && onGround) {
    const t = tileState(world, pcx, pcz);
    if (t.cracked === null && !t.fallen) {
      t.cracked = 0;
      events.emit({ type: 'tile.cracked', tick, cx: pcx, cz: pcz });
    }
  }
  for (const [key, t] of Object.entries(state.tiles)) {
    if (t.cracked === null || t.fallen) continue;
    t.cracked += dt;
    if (t.cracked >= mechanics.crumbleDelay) {
      t.fallen = true;
      const [cx, cz] = key.split(',').map(Number);
      events.emit({ type: 'tile.fell', tick, cx, cz });
    }
  }
}
