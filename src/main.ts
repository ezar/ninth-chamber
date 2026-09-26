import './ui/style.css';
import levelJson from '../levels/antechamber.level.json';
import { AudioEngine, type ReverbPreset } from './audio/engine';
import { OrbitCamera } from './camera/orbit';
import { EventBus, type SimEvent } from './core/events';
import { GamepadDevice, KeyboardMouseDevice, TouchDevice, mergeDevices } from './core/input';
import { InputFramer, emptyFrame, isPressed } from './core/input-frame';
import { FixedStepLoop } from './core/loop';
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
  const hud = new Hud(() => restart());
  const keyboard = new KeyboardMouseDevice(canvas);
  const gamepad = new GamepadDevice();
  const touch = new TouchDevice(canvas, $('#touch'), { base: $('#stick'), knob: $('#stick-knob') });
  const devices = [keyboard, gamepad, touch];
  const framer = new InputFramer();
  let playing = false;

  if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') {
      document.body.classList.add('touch');
      hud.device = 'touch';
    }
  });
  window.addEventListener('keydown', () => (hud.device = 'keyboard'));

  // The first gesture on the title screen unlocks audio and brings in the title theme.
  const titleMusic = (): void => {
    if (playing) return;
    void audio.unlock();
    audio.playTrack('title', 3);
  };
  window.addEventListener('pointerdown', titleMusic, { capture: true });
  window.addEventListener('keydown', titleMusic, { capture: true });
  for (const b of document.querySelectorAll<HTMLButtonElement>('#start-button, #end-restart')) {
    b.addEventListener('pointerenter', () => audio.ui('hover'));
  }

  const start = (): void => {
    if (playing) return;
    playing = true;
    void audio.unlock();
    audio.ui('confirm');
    // The theme opens the level (it starts now if the title screen was silent), then leaves the tomb to its ambience.
    audio.playTrack('title', 3);
    audio.stopMusic(8, 6);
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
    audio.ui('confirm');
    world = createWorld(level, 1);
    renderer.setWorld(world);
    hud.hideEnd();
    playing = true;
  };

  const pose = (): PlayerPose => ({ pos: { ...world.state.player.pos }, yaw: world.state.player.yaw });
  let prev = pose();
  let lastMaterial = 'stone';
  let stepDistance = 0;

  /** Where an event sounds: at the actor or tile it names, else at the player. */
  const soundAt = (e: SimEvent): { x: number; y: number; z: number } => {
    let cell: { cx: number; cz: number } | undefined;
    if (typeof e.id === 'string') cell = world.state.actors.find((a) => a.id === e.id);
    else if (typeof e.cx === 'number' && typeof e.cz === 'number') cell = { cx: e.cx, cz: e.cz };
    if (!cell) return world.state.player.pos;
    const x = cell.cx * BLOCK + BLOCK / 2;
    const z = cell.cz * BLOCK + BLOCK / 2;
    return { x, y: level.floorAt(x, z) + 1, z };
  };

  const onEvent = (e: SimEvent): void => {
    audio.onEvent(e, soundAt(e));
    hud.onEvent(e, world);
    if (e.type === 'camera.focus') {
      const at = renderer.entityPosition(String(e.target));
      if (at) camera.focusOn(at, Number(e.duration) || 2);
    }
    if (e.type === 'player.grabbed') camera.swingBehind(world.state.player.yaw);
  };
  bus.on('*', onEvent);

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
    camera.update(at, p.mode === 'hang' || p.mode === 'climb', world.grid, dt);
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
      },
      camera.eye,
      camera.lookAt,
      camera.currentDistance,
      dt,
    );
    hud.update(world, dt);

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
  };
}

void main();
