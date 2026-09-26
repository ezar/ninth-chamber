import './ui/style.css';
import levelJson from '../levels/antechamber.level.json';
import { AudioEngine, type ReverbPreset } from './audio/engine';
import { OrbitCamera, cameraTuning } from './camera/orbit';
import { EventBus, type SimEvent } from './core/events';
import { Haptics, hapticsEnabled, setHapticsEnabled } from './core/haptics';
import { GamepadDevice, KeyboardMouseDevice, TouchDevice, mergeDevices } from './core/input';
import { InputFramer, emptyFrame, isPressed } from './core/input-frame';
import { FixedStepLoop } from './core/loop';
import { GroundFx } from './render/fx';
import {
  DynamicResolution,
  QUALITY,
  TierBenchmark,
  heuristicTier,
  lowerTier,
  type DeviceHints,
  type QualityTier,
} from './render/quality';
import { GameRenderer, type PlayerPose } from './render/scene';
import { Level } from './sim/grid/level';
import { BLOCK } from './sim/grid/units';
import { createWorld, respawn, stepWorld, type World } from './sim/world';
import { Hud, type Device } from './ui/hud';
import { applyStaticStrings, pickLocale, setLocale, type StringKey } from './ui/i18n';
import { LoadingScreen } from './ui/loading';
import { Menu } from './ui/menu';
import {
  DirectionRepeat,
  PAD,
  PadReader,
  focusItem,
  moveFocus,
  navItems,
  padDirection,
  padHas,
} from './ui/pad';
import { browserStorage, defaultSettings, loadSettings, saveSettings, type Settings } from './ui/settings';

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing ${sel}`);
  return el;
};

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

function deviceHints(): DeviceHints {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: navigator.userAgent,
    coarsePointer: matchMedia('(pointer: coarse)').matches,
    finePointer: matchMedia('(any-pointer: fine)').matches,
    ...(nav.hardwareConcurrency ? { cores: nav.hardwareConcurrency } : {}),
    ...(nav.deviceMemory ? { memoryGb: nav.deviceMemory } : {}),
  };
}

async function main(): Promise<void> {
  const storage = browserStorage();
  const settings: Settings = loadSettings(
    storage,
    defaultSettings(matchMedia('(prefers-reduced-motion: reduce)').matches),
  );
  setLocale(settings.language ?? pickLocale(navigator.languages));
  applyStaticStrings();
  document.body.classList.toggle('reduce-motion', settings.reducedMotion);

  const loading = new LoadingScreen();
  loading.trackDownloads();

  const canvas = $<HTMLCanvasElement>('#game');
  const stats = $('#hud-stats');
  const startButton = $<HTMLButtonElement>('#start-button');

  // Quality: the stored tier, or on first run the device heuristic until the benchmark decides.
  const hints = deviceHints();
  let tier: QualityTier = settings.quality ?? heuristicTier(hints);
  const renderer = new GameRenderer(canvas, QUALITY[tier]);
  renderer.setReducedMotion(settings.reducedMotion);
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
  const baseSensitivity = cameraTuning.sensitivity;
  const hud = new Hud(() => restart());
  const keyboard = new KeyboardMouseDevice(canvas);
  const gamepad = new GamepadDevice();
  const touch = new TouchDevice(canvas, $('#touch'), { base: $('#stick'), knob: $('#stick-knob') });
  const devices = [keyboard, gamepad, touch];
  const framer = new InputFramer();
  const pads = new PadReader();
  const titleRepeat = new DirectionRepeat();
  const drs = new DynamicResolution(QUALITY[tier].minRenderScale);
  let benchmark: TierBenchmark | null = null;
  let playing = false;
  let paused = false;
  /** Re-render once while paused (resize, options changes). */
  let redraw = false;
  // The keyboard belongs to the page (buttons, Tab) until the game starts.
  keyboard.setEnabled(false);

  const setDevice = (d: Device): void => {
    hud.device = d;
    menu.setDevice(d);
  };

  // ───────────────────────────── Settings ─────────────────────────────

  const applyTier = (t: QualityTier): void => {
    tier = t;
    renderer.setQuality(QUALITY[t]);
    drs.reset(QUALITY[t].minRenderScale);
    renderer.setRenderScale(1);
  };
  const applyVolumes = (): void => {
    const m = settings.masterVolume;
    audio.setBusVolume('music', m * settings.musicVolume);
    audio.setBusVolume('sfx', m * settings.sfxVolume);
    audio.setBusVolume('ambience', m * settings.sfxVolume);
    audio.setBusVolume('ui', m);
    audio.setBusVolume('voice', m);
  };
  const applyCamera = (): void => {
    cameraTuning.sensitivity = baseSensitivity * settings.cameraSensitivity;
    cameraTuning.invertY = settings.invertY;
    camera.calm = settings.reducedMotion;
  };
  const applySetting = (key: keyof Settings): void => {
    switch (key) {
      case 'quality':
        if (settings.quality && settings.quality !== tier) applyTier(settings.quality);
        break;
      case 'masterVolume':
      case 'musicVolume':
      case 'sfxVolume':
        applyVolumes();
        break;
      case 'cameraSensitivity':
      case 'invertY':
        applyCamera();
        break;
      case 'reducedMotion':
        renderer.setReducedMotion(settings.reducedMotion);
        applyCamera();
        document.body.classList.toggle('reduce-motion', settings.reducedMotion);
        break;
      case 'language':
        setLocale(settings.language ?? pickLocale(navigator.languages));
        applyStaticStrings();
        menu.refresh();
        loading.refresh();
        break;
      default:
        break;
    }
    saveSettings(storage, settings);
    redraw = true;
  };

  const menu = new Menu(settings, {
    resume: () => resume(),
    restart: () => restartCheckpoint(),
    quit: () => quitToTitle(),
    closed: () => {
      menu.close();
      focusItem($('#start-options'));
    },
    change: applySetting,
    vibration: { get: hapticsEnabled, set: setHapticsEnabled },
  });
  applyVolumes();
  applyCamera();

  // ───────────────────────────── Game flow ─────────────────────────────

  /**
   * Buttons used in menus (A to resume, Enter to start) must not reach the
   * game as fresh presses when control returns to the player.
   */
  const flushInput = (): void => {
    gamepad.update(0);
    for (const d of devices) d.takeLook();
    const { raw } = mergeDevices(devices);
    framer.next(raw, 0, camera.yaw);
  };

  /**
   * Entering the tomb: the button answers at once (press flash, busy), the
   * screen cuts to black, play begins under the curtain with the camera
   * already behind Nora, and the curtain lifts on the level title.
   */
  let starting = false;
  const curtain = $('#curtain');
  const start = (): void => {
    if (playing || starting || !loading.isReady || menu.isOpen) return;
    starting = true;
    // Audio and fullscreen must be requested inside the gesture itself.
    void audio.unlock();
    if (document.body.classList.contains('touch')) {
      // Phones: reclaim the browser chrome for the game.
      void document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
    }
    startButton.classList.add('pressed');
    startButton.setAttribute('aria-busy', 'true');
    curtain.classList.add('in');
    window.setTimeout(() => {
      starting = false;
      playing = true;
      $('#start').classList.add('hidden');
      startButton.classList.remove('pressed');
      startButton.removeAttribute('aria-busy');
      document.body.classList.add('playing');
      camera.yaw = world.state.player.yaw;
      camera.recenter(world.state.player.yaw);
      keyboard.setEnabled(true);
      flushInput();
      canvas.focus();
      // Two frames of play under the curtain, then lift it on the title.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          curtain.classList.remove('in');
          hud.showTitle(level.name as StringKey);
        }),
      );
    }, 480);
  };
  startButton.addEventListener('click', start);
  $('#start-options').addEventListener('click', () => {
    if (!menu.isOpen) menu.open('title');
  });

  const pause = (): void => {
    if (!playing || paused || world.ended) return;
    paused = true;
    keyboard.setEnabled(false);
    audio.setPaused(true);
    document.body.classList.add('paused');
    menu.open('pause');
  };
  const resume = (): void => {
    if (!paused) return;
    paused = false;
    menu.close();
    document.body.classList.remove('paused');
    audio.setPaused(false);
    keyboard.setEnabled(true);
    flushInput();
    canvas.focus({ preventScroll: true });
  };
  $('#pause-button').addEventListener('click', pause);
  // Leaving the tab pauses the game (and its sound).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });

  const restartCheckpoint = (): void => {
    respawn(world);
    prev = pose();
    camera.recenter(world.state.player.yaw);
    resume();
  };

  const restart = (): void => {
    world = createWorld(level, 1);
    renderer.setWorld(world);
    prev = pose();
    hud.hideEnd();
    camera.recenter(world.state.player.yaw);
    flushInput();
    playing = true;
    document.body.classList.add('playing');
  };

  const quitToTitle = (): void => {
    paused = false;
    playing = false;
    menu.close();
    document.body.classList.remove('paused', 'playing');
    world = createWorld(level, 1);
    renderer.setWorld(world);
    prev = pose();
    hud.reset();
    audio.setPaused(false);
    keyboard.setEnabled(false);
    $('#start').classList.remove('hidden');
    focusItem(startButton);
  };

  // ───────────────────────────── Input routing ─────────────────────────────

  if (matchMedia('(pointer: coarse)').matches) {
    document.body.classList.add('touch');
    setDevice('touch');
  }
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') {
      document.body.classList.add('touch');
      setDevice('touch');
    } else if (e.pointerType === 'mouse') {
      setDevice('keyboard');
    }
  });
  window.addEventListener('keydown', (e) => {
    setDevice('keyboard');
    if (menu.handleKey(e)) return;
    if (e.code === 'Escape') {
      if (!e.repeat) pause();
      return;
    }
    if (playing || !loading.isReady) return;
    const title = $('#start');
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      moveFocus(title, e.code === 'ArrowDown' ? 1 : -1);
      e.preventDefault();
    } else if ((e.code === 'Enter' || e.code === 'Space') && !e.repeat) {
      // A focused title button handles its own activation.
      if (document.activeElement instanceof HTMLButtonElement) return;
      e.preventDefault();
      start();
    }
  });

  /** Gamepad outside the game: title and end screens, the pause menu, Start to pause. */
  const routePad = (dt: number): void => {
    const pad = pads.read();
    if (!pad.connected) return;
    if (pad.pressed) setDevice('gamepad');
    if (menu.isOpen) {
      menu.update(pad, dt);
      return;
    }
    if (playing && !world.ended) {
      if (padHas(pad.pressed, PAD.START)) pause();
      return;
    }
    const screen = hud.endVisible ? $('#end') : !playing && loading.isReady ? $('#start') : null;
    if (!screen) return;
    const dir = titleRepeat.update(padDirection(pad), dt);
    if (dir === 'up' || dir === 'down') moveFocus(screen, dir === 'down' ? 1 : -1);
    if (padHas(pad.pressed, PAD.A)) {
      const focused = document.activeElement;
      const target =
        focused instanceof HTMLButtonElement && screen.contains(focused) ? focused : navItems(screen)[0];
      target?.click();
    }
  };

  // ───────────────────────────── Simulation ─────────────────────────────

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

  window.addEventListener('resize', () => {
    renderer.resize();
    redraw = true;
  });

  // ───────────────────────────── Frame ─────────────────────────────

  let alpha = 0;
  /** Renders the interpolated state; `cameraDt` lets the first frame snap the camera into place. */
  const draw = (dt: number, cameraDt = dt): void => {
    const curr = pose();
    const p = world.state.player;
    const at = {
      x: prev.pos.x + (curr.pos.x - prev.pos.x) * alpha,
      y: prev.pos.y + (curr.pos.y - prev.pos.y) * alpha,
      z: prev.pos.z + (curr.pos.z - prev.pos.z) * alpha,
    };
    camera.aiming = p.weapon.drawn && (p.mode === 'ground' || p.mode === 'air');
    camera.update(at, p.mode === 'hang' || p.mode === 'climb', world.grid, cameraDt, {
      vx: p.mode === 'ground' || p.mode === 'air' ? p.vel.x : 0,
      vz: p.mode === 'ground' || p.mode === 'air' ? p.vel.z : 0,
      vy: p.vel.y,
    });
    renderer.setFocus(camera.focusPoint, camera.focusWeight);
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
      alpha,
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
    fx.update(dt);
  };

  // First frames behind the loading screen compile every shader the opening
  // needs: the gameplay view behind Nora, every effect, then the title view.
  loading.setStage('loading.prepare', 0.8);
  await nextFrame();
  camera.yaw = world.state.player.yaw;
  draw(0, 1);
  renderer.warmup();
  await nextFrame();
  camera.yaw = world.state.player.yaw + Math.PI * 0.85;
  draw(0, 1);
  canvas.classList.add('ready');

  if (settings.quality === null) {
    const guess = heuristicTier(hints);
    if (guess === 'mobile') {
      settings.quality = 'mobile';
      saveSettings(storage, settings);
      loading.ready();
    } else {
      // First run (spec §11): measure the title scene for ~3 s at the guessed tier.
      benchmark = new TierBenchmark(guess);
      loading.setStage('loading.calibrate', 0.9);
    }
  } else {
    loading.ready();
  }

  const finishBenchmark = (b: TierBenchmark): void => {
    const chosen = b.result() ?? heuristicTier(hints);
    settings.quality = chosen;
    settings.qualitySource = 'auto';
    saveSettings(storage, settings);
    if (chosen !== tier) applyTier(chosen);
    menu.refresh();
    loading.ready();
  };

  let last = performance.now();
  let fpsFrames = 0;
  let fpsTime = 0;
  let introYaw = 0;
  let room: string | null = null;

  renderer.renderer.setAnimationLoop((now: number) => {
    const rawDt = (now - last) / 1000;
    const dt = Math.min(0.1, rawDt);
    last = now;

    routePad(dt);
    if (paused) {
      gamepad.update(0);
      if (redraw) {
        redraw = false;
        draw(0);
      }
      return;
    }

    gamepad.update(dt);
    if (gamepad.poll().held !== 0) setDevice('gamepad');
    for (const d of devices) {
      const l = d.takeLook();
      if (playing) camera.look(l.x, l.y, l.zoom);
    }
    if (!playing) {
      // Slow cinematic orbit behind the start screen (held still with reduced motion).
      if (!settings.reducedMotion) introYaw += dt * 0.08;
      camera.yaw = world.state.player.yaw + Math.PI * 0.85 + Math.sin(introYaw) * 0.6;
    }

    alpha = loop.advance(dt).alpha;
    draw(dt);
    redraw = false;
    if (playing) hud.update(world, dt);

    const p = world.state.player.pos;
    const r = level.roomAt(Math.floor(p.x / BLOCK), Math.floor(p.z / BLOCK));
    if (r && r.id !== room) {
      room = r.id;
      audio.setRoom((r.reverb as ReverbPreset | null) ?? null);
    }
    // The camera looks along the same yaw convention as the player.
    audio.update({ ...camera.eye, yaw: camera.yaw }, dt);

    // Quality: the first-run benchmark, then dynamic resolution (spec §14).
    if (benchmark) {
      const b = benchmark;
      loading.setProgress(0.9 + 0.1 * b.progress);
      if (b.add(rawDt)) {
        benchmark = null;
        finishBenchmark(b);
      }
    } else {
      const change = drs.update(rawDt);
      if (change === 'down' || change === 'up') renderer.setRenderScale(drs.scale);
      else if (change === 'floor' && settings.qualitySource === 'auto' && tier !== 'mobile') {
        settings.quality = lowerTier(tier);
        saveSettings(storage, settings);
        applyTier(settings.quality);
        menu.refresh();
      }
    }

    fpsFrames++;
    fpsTime += dt;
    if (fpsTime >= 0.5) {
      const scale = drs.scale < 1 ? ` · ${Math.round(drs.scale * 100)}%` : '';
      stats.textContent = `${renderer.backendName} · ${tier} · ${Math.round(fpsFrames / fpsTime)} fps${scale}`;
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
    pause,
    resume,
    renderer,
    fx,
    menu,
    settings,
    drs,
    setQuality: (t: QualityTier) => {
      settings.quality = t;
      settings.qualitySource = 'user';
      applySetting('quality');
    },
  };
}

void main();
