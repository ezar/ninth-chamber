import './ui/style.css';
import levelJson from '../levels/antechamber.level.json';
import { AudioEngine, type ReverbPreset } from './audio/engine';
import { OrbitCamera } from './camera/orbit';
import { EventBus, type SimEvent } from './core/events';
import { Haptics } from './core/haptics';
import { GamepadDevice, KeyboardMouseDevice, TouchDevice, mergeDevices } from './core/input';
import { InputFramer, emptyFrame, isPressed } from './core/input-frame';
import { FixedStepLoop } from './core/loop';
import { GroundFx } from './render/fx';
import { GameRenderer, type PlayerPose } from './render/scene';
import { Level } from './sim/grid/level';
import { BLOCK } from './sim/grid/units';
import { createWorld, stepWorld, type World } from './sim/world';
import { Hud } from './ui/hud';
import { applyStaticStrings, pickLocale, setLocale, type StringKey } from './ui/i18n';

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing ${sel}`);
  return el;
};

async function main(): Promise<void> {
  setLocale(pickLocale(navigator.languages));
  applyStaticStrings();

  const canvas = $<HTMLCanvasElement>('#game');
  const stats = $('#hud-stats');

  const renderer = new GameRenderer(canvas);
  try {
    await renderer.init();
  } catch (err) {
    $('#fatal').hidden = false;
    throw err;
  }

  const level = Level.parse(levelJson);
  let world: World = createWorld(level, 1);
  renderer.setWorld(world);

  const audio = new AudioEngine();
  audio.setEmitters(
    level.entities
      .filter((e) => e.type === 'brazier' || e.type === 'relic')
      .map((e) => {
        const x = e.at[0] * BLOCK + BLOCK / 2;
        const z = e.at[1] * BLOCK + BLOCK / 2;
        return {
          id: e.id,
          x,
          y: level.floorAt(x, z) + 1.2,
          z,
          kind: e.type === 'relic' ? 'relic' : 'brazier',
        };
      }),
  );

  const bus = new EventBus();
  const camera = new OrbitCamera();
  const fx = new GroundFx(renderer.scene);
  const haptics = new Haptics();
  const hud = new Hud(() => restart());
  const keyboard = new KeyboardMouseDevice(canvas);
  const gamepad = new GamepadDevice();
  const touch = new TouchDevice(canvas, $('#touch'), { base: $('#stick'), knob: $('#stick-knob') });
  const devices = [keyboard, gamepad, touch];
  const framer = new InputFramer();
  let playing = false;

  if (matchMedia('(pointer: coarse)').matches) {
    document.body.classList.add('touch');
    hud.device = 'touch';
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') {
      document.body.classList.add('touch');
      hud.device = 'touch';
    }
  });
  window.addEventListener('keydown', () => (hud.device = 'keyboard'));

  const start = (): void => {
    if (playing) return;
    playing = true;
    void audio.unlock();
    document.body.classList.add('playing');
    if (document.body.classList.contains('touch')) {
      // Phones: reclaim the browser chrome for the game.
      void document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
    }
    $('#start').classList.add('hidden');
    hud.showTitle(level.name as StringKey);
    camera.recenter(world.state.player.yaw);
    canvas.focus();
  };
  $('#start-button').addEventListener('click', start);
  window.addEventListener('keydown', (e) => {
    if (!playing && (e.code === 'Enter' || e.code === 'Space')) start();
  });

  const restart = (): void => {
    world = createWorld(level, 1);
    renderer.setWorld(world);
    hud.hideEnd();
    playing = true;
    document.body.classList.add('playing');
  };

  const pose = (): PlayerPose => ({ pos: { ...world.state.player.pos }, yaw: world.state.player.yaw });
  let prev = pose();
  let lastMaterial = 'stone';
  let stepDistance = 0;

  const onEvent = (e: SimEvent): void => {
    const p = world.state.player.pos;
    audio.onEvent(e, p);
    hud.onEvent(e, world);
    renderer.combat.onEvent(e, world);
    if (e.type === 'camera.focus') {
      const at = renderer.entityPosition(String(e.target));
      if (at) camera.focusOn(at, Number(e.duration) || 2);
    }
    if (e.type === 'player.grabbed') camera.swingBehind(world.state.player.yaw);
    camera.onEvent(e, p, (id) => renderer.entityPosition(id));
    groundFx(e);
    haptics.device = hud.device;
    haptics.onEvent(e, p, (id) => renderer.entityPosition(id));
    if (e.type === 'level.end') document.body.classList.remove('playing');
  };
  bus.on('*', onEvent);

  /** Dust and footprints for events that move stone or bodies. */
  const groundFx = (e: SimEvent): void => {
    const cell = (cx: number, cz: number): { x: number; y: number; z: number } => {
      const x = cx * BLOCK + BLOCK / 2;
      const z = cz * BLOCK + BLOCK / 2;
      return { x, y: level.floorAt(x, z), z };
    };
    const p = world.state.player;
    if (e.type === 'player.landed') {
      const s = level.sector(Math.floor(p.pos.x / BLOCK), Math.floor(p.pos.z / BLOCK));
      fx.land(p.pos, Number(e.fall) || 0, s?.mat ?? 'stone');
    } else if (e.type === 'block.landed') {
      const b = world.state.actors.find((a) => a.kind === 'block' && a.id === e.id);
      if (b && b.kind === 'block') fx.impact({ ...cell(b.cx, b.cz), y: b.y }, 1);
    } else if (e.type === 'tile.fell') {
      const at = cell(Number(e.cx), Number(e.cz));
      fx.impact({ ...at, y: at.y - 0.4 }, 0.7);
    } else if (e.type === 'door.opening' || e.type === 'door.closing') {
      const at = renderer.entityPosition(String(e.id));
      if (at) fx.sift({ ...at, y: at.y - 1.5 });
    }
  };

  const loop = new FixedStepLoop(() => {
    prev = pose();
    const { raw, tapped } = mergeDevices(devices);
    const input = playing && !camera.focusing ? framer.next(raw, tapped, camera.yaw) : emptyFrame();
    if (camera.focusing && (tapped !== 0 || Math.hypot(raw.moveX, raw.moveY) > 0.5)) camera.skipFocus();
    if (isPressed(input, 'recenter')) camera.recenter(world.state.player.yaw);
    if (playing) stepWorld(world, input);
    bus.dispatch(world.events.drain());

    // Footsteps from ground distance travelled (a stride every ~0.8 m running, 0.6 m walking).
    const p = world.state.player;
    if (p.mode === 'ground') {
      const d = Math.hypot(p.pos.x - prev.pos.x, p.pos.z - prev.pos.z);
      stepDistance += d;
      const running = d > 0.06;
      const stride = running ? 0.85 : 0.6;
      if (stepDistance > stride) {
        stepDistance = 0;
        const s = level.sector(Math.floor(p.pos.x / BLOCK), Math.floor(p.pos.z / BLOCK));
        lastMaterial = s?.mat ?? lastMaterial;
        audio.onEvent({ type: 'footstep', tick: world.tick, material: lastMaterial, run: running }, p.pos);
        fx.footstep(p.pos, p.yaw, lastMaterial, running);
      }
    }
  });

  window.addEventListener('resize', () => renderer.resize());

  let last = performance.now();
  let fpsFrames = 0;
  let fpsTime = 0;
  let introYaw = 0;
  let room: string | null = null;

  renderer.renderer.setAnimationLoop((now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    gamepad.update(dt);
    if (gamepad.poll().held !== 0) hud.device = 'gamepad';
    for (const d of devices) {
      const l = d.takeLook();
      if (playing) camera.look(l.x, l.y, l.zoom);
    }
    if (!playing) {
      // Slow cinematic orbit behind the start screen.
      introYaw += dt * 0.08;
      camera.yaw = world.state.player.yaw + Math.PI * 0.85 + Math.sin(introYaw) * 0.6;
    }

    const frame = loop.advance(dt);
    const curr = pose();
    const a = frame.alpha;
    const p = world.state.player;
    const at = {
      x: prev.pos.x + (curr.pos.x - prev.pos.x) * a,
      y: prev.pos.y + (curr.pos.y - prev.pos.y) * a,
      z: prev.pos.z + (curr.pos.z - prev.pos.z) * a,
    };
    camera.aiming = p.weapon.drawn && (p.mode === 'ground' || p.mode === 'air');
    camera.update(at, p.mode === 'hang' || p.mode === 'climb', world.grid, dt, {
      vx: p.mode === 'ground' || p.mode === 'air' ? p.vel.x : 0,
      vz: p.mode === 'ground' || p.mode === 'air' ? p.vel.z : 0,
      vy: p.vel.y,
    });
    // Narrow (portrait) screens keep a playable horizontal field of view.
    const minHFov = (58 * Math.PI) / 180;
    const fov = Math.max(
      camera.fov,
      (2 * Math.atan(Math.tan(minHFov / 2) / renderer.camera.aspect) * 180) / Math.PI,
    );
    if (Math.abs(renderer.camera.fov - fov) > 0.01) {
      renderer.camera.fov = fov;
      renderer.camera.updateProjectionMatrix();
    }
    renderer.render(
      prev,
      curr,
      a,
      {
        mode: p.mode,
        modeTime: p.modeTime,
        speed: Math.hypot(p.vel.x, p.vel.z),
        vy: p.vel.y,
        climbT: p.move ? Math.min(1, p.modeTime / p.move.duration) : 0,
        health: p.health,
        ...renderer.combat.aimPose(world),
      },
      camera.eye,
      camera.lookAt,
      camera.currentDistance,
      dt,
    );
    hud.update(world, dt);
    fx.update(dt);

    const r = level.roomAt(Math.floor(at.x / BLOCK), Math.floor(at.z / BLOCK));
    if (r && r.id !== room) {
      room = r.id;
      audio.setRoom((r.reverb as ReverbPreset | null) ?? null);
    }
    // The camera looks along the same yaw convention as the player.
    audio.update({ ...camera.eye, yaw: camera.yaw }, dt);

    fpsFrames++;
    fpsTime += dt;
    if (fpsTime >= 0.5) {
      stats.textContent = `${renderer.backendName} · ${Math.round(fpsFrames / fpsTime)} fps`;
      fpsFrames = 0;
      fpsTime = 0;
    }
  });

  // Debug handle for the console and smoke tests.
  (window as unknown as { __nc: unknown }).__nc = {
    get world() {
      return world;
    },
    camera,
    start,
    renderer,
    fx,
  };
}

void main();
