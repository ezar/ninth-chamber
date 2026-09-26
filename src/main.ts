import './ui/style.css';
import { EventBus } from './core/events';
import { InputFramer, isPressed } from './core/input-frame';
import { GamepadDevice, KeyboardMouseDevice, TouchDevice, mergeDevices } from './core/input';
import { FixedStepLoop } from './core/loop';
import { OrbitCamera } from './camera/orbit';
import { GameRenderer, type PlayerPose } from './render/scene';
import { createWorld, stepWorld } from './sim/world';
import { applyStaticStrings, pickLocale, setLocale, t } from './ui/i18n';

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing ${sel}`);
  return el;
};

async function main(): Promise<void> {
  setLocale(pickLocale(navigator.languages));
  applyStaticStrings();

  const canvas = $<HTMLCanvasElement>('#game');
  const hud = $('#hud-stats');

  const renderer = new GameRenderer(canvas);
  try {
    await renderer.init();
  } catch (err) {
    $('#fatal').hidden = false;
    throw err;
  }

  const world = createWorld(1);
  const bus = new EventBus();
  const camera = new OrbitCamera();
  const keyboard = new KeyboardMouseDevice(canvas);
  const gamepad = new GamepadDevice();
  const touch = new TouchDevice(canvas, $('#touch'), { base: $('#stick'), knob: $('#stick-knob') });
  const devices = [keyboard, gamepad, touch];
  const framer = new InputFramer();

  if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') document.body.classList.add('touch');
  });

  const pose = (): PlayerPose => ({ pos: { ...world.player.pos }, yaw: world.player.yaw });
  let prev = pose();

  const loop = new FixedStepLoop(() => {
    prev = pose();
    const { raw, tapped } = mergeDevices(devices);
    const input = framer.next(raw, tapped, camera.yaw);
    if (isPressed(input, 'recenter')) camera.recenter(world.player.yaw);
    stepWorld(world, input);
    bus.dispatch(world.events.drain());
  });

  let jumps = 0;
  bus.on('player.jumped', () => jumps++);

  window.addEventListener('resize', () => renderer.resize());

  let last = performance.now();
  let fpsFrames = 0;
  let fpsTime = 0;
  let fps = 0;

  renderer.renderer.setAnimationLoop((now: number) => {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;

    gamepad.update(dt);
    for (const d of devices) {
      const l = d.takeLook();
      camera.look(l.x, l.y, l.zoom);
    }

    const frame = loop.advance(dt);
    const curr = pose();
    const a = frame.alpha;
    camera.follow(
      prev.pos.x + (curr.pos.x - prev.pos.x) * a,
      prev.pos.y + (curr.pos.y - prev.pos.y) * a,
      prev.pos.z + (curr.pos.z - prev.pos.z) * a,
      dt,
    );
    renderer.render(prev, curr, a, camera.eye(), camera.target);

    fpsFrames++;
    fpsTime += dt;
    if (fpsTime >= 0.5) {
      fps = Math.round(fpsFrames / fpsTime);
      fpsFrames = 0;
      fpsTime = 0;
      hud.textContent = t('hud.stats', { backend: renderer.backendName, fps, tick: world.tick, jumps });
    }
  });

  // Debug handle for the console and smoke tests.
  (window as unknown as { __nc: unknown }).__nc = { world, camera };
}

void main();
