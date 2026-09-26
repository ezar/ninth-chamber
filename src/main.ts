import './ui/style.css';
import './ui/screens.css';
import levelJson from '../levels/antechamber.level.json';
import { AudioEngine, type ReverbPreset } from './audio/engine';
import { entranceShots, shotYaw, titleShot, type Shot } from './camera/cinematic';
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
import type { NoteStyle } from './sim/grid/schema';
import { BLOCK } from './sim/grid/units';
import { createWorld, respawn, stepWorld, type World } from './sim/world';
import { chamberOf } from './ui/campaign';
import { EndScreen } from './ui/end-screen';
import { Hud, type Device } from './ui/hud';
import { applyStaticStrings, pickLocale, setLocale, type StringKey } from './ui/i18n';
import { Intro } from './ui/intro';
import { LoadingScreen } from './ui/loading';
import { Menu } from './ui/menu';
import { PadEdgeReader } from './ui/nav';
import { PAD, PadReader, focusItem, padHas } from './ui/pad';
import { Reader } from './ui/reader';
import { browserStorage, defaultSettings, loadSettings, saveSettings, type Settings } from './ui/settings';
import { TitleScreen } from './ui/title';

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing ${sel}`);
  return el;
};

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

/** Title screen → intro → play (the pause menu and the note reader stop it) → end of the level. */
type Phase = 'title' | 'intro' | 'play' | 'end';

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
  const chamber = chamberOf(level.id);
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
  const hud = new Hud();
  const keyboard = new KeyboardMouseDevice(canvas);
  const gamepad = new GamepadDevice();
  const touch = new TouchDevice(canvas, $('#touch'), { base: $('#stick'), knob: $('#stick-knob') });
  const devices = [keyboard, gamepad, touch];
  const framer = new InputFramer();
  const pads = new PadReader();
  const padEdges = new PadEdgeReader();
  const drs = new DynamicResolution(QUALITY[tier].minRenderScale);
  let benchmark: TierBenchmark | null = null;

  let phase: Phase = 'title';
  const setPhase = (p: Phase): void => {
    phase = p;
    document.body.dataset.phase = p;
    document.body.classList.toggle('playing', p === 'play');
  };
  setPhase('title');
  let paused = false;
  /** Re-render once while paused (resize, options changes). */
  let redraw = false;
  /** After a menu, the reader or the intro closes, ignore the presses that closed it until every button is up. */
  let swallow = false;
  // The keyboard belongs to the page (buttons, Tab) until the game starts.
  keyboard.setEnabled(false);

  /**
   * UI cues (intro, reader, end screen) go through the same bus as simulation
   * events, so audio and the HUD can react to them: see ui/intro.ts,
   * ui/end-screen.ts and `note.closed` below.
   */
  const cue = (type: string, data: Record<string, unknown> = {}): void =>
    bus.dispatch([{ type, tick: world.tick, ...data }]);

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
    swallow = true;
  };

  // Cinematic shots in the entrance: the title drifts on the first, the intro runs through all.
  let shots = entranceShots(level, world.state.player.pos, world.state.player.yaw);
  let clock = 0;
  let view: Shot = titleShot(shots[0] ?? { eye: camera.eye, look: camera.lookAt }, 0);

  /** The intro has landed behind Nora: control to the player, and the level title. */
  const beginPlay = (): void => {
    setPhase('play');
    keyboard.setEnabled(true);
    flushInput();
    hud.showTitle(level.name as StringKey, chamber?.kicker);
    canvas.focus({ preventScroll: true });
  };
  const intro = new Intro(beginPlay, cue);

  /**
   * Entering the tomb: the button answers at once (press flash, busy), the
   * screen cuts to black, the intro begins under the curtain from the title's
   * shot, and the curtain lifts on the first story card.
   */
  let starting = false;
  const curtain = $('#curtain');
  // The first gesture on the title screen unlocks audio and brings in the title theme.
  const titleMusic = (): void => {
    if (phase !== 'title') return;
    void audio.unlock();
    audio.playTrack('title', 3);
  };
  window.addEventListener('pointerdown', titleMusic, { capture: true });
  window.addEventListener('keydown', titleMusic, { capture: true });
  for (const b of document.querySelectorAll<HTMLButtonElement>('#start button, #end button')) {
    b.addEventListener('pointerenter', () => audio.ui('hover'));
  }

  const start = (): void => {
    if (phase !== 'title' || starting || !loading.isReady || menu.isOpen) return;
    starting = true;
    // Audio and fullscreen must be requested inside the gesture itself.
    void audio.unlock();
    audio.ui('confirm');
    // The theme opens the level (it starts now if the title screen was silent), then leaves the tomb to its ambience.
    audio.playTrack('title', 3);
    audio.stopMusic(8, 6);
    if (document.body.classList.contains('touch')) {
      // Phones: reclaim the browser chrome for the game.
      void document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
    }
    startButton.classList.add('pressed');
    startButton.setAttribute('aria-busy', 'true');
    curtain.classList.add('in');
    window.setTimeout(() => {
      starting = false;
      title.hide();
      startButton.classList.remove('pressed');
      startButton.removeAttribute('aria-busy');
      // The orbit camera waits behind Nora; the intro lands on it.
      camera.yaw = world.state.player.yaw;
      camera.recenter(world.state.player.yaw);
      setPhase('intro');
      intro.start(
        [view, ...shots.slice(1)],
        chamber?.intro ?? [],
        document.body.classList.contains('touch'),
        settings.reducedMotion,
      );
      // Two frames of the intro under the curtain, then lift it.
      requestAnimationFrame(() => requestAnimationFrame(() => curtain.classList.remove('in')));
    }, 480);
  };
  const title = new TitleScreen(
    start,
    (type) => cue(type),
    () => menu.isOpen || !loading.isReady,
  );
  $('#start-options').addEventListener('click', () => {
    if (!menu.isOpen) menu.open('title');
  });

  const pause = (): void => {
    if (phase !== 'play' || paused || world.ended || reader.isOpen) return;
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

  /** Play again from the end screen: a fresh world, straight into play. */
  const restart = (): void => {
    audio.ui('confirm');
    world = createWorld(level, 1);
    renderer.resetWorld(world);
    prev = pose();
    hud.reset();
    endScreen.hide();
    camera.yaw = world.state.player.yaw;
    camera.recenter(world.state.player.yaw);
    beginPlay();
  };

  const quitToTitle = (): void => {
    paused = false;
    menu.close();
    document.body.classList.remove('paused');
    world = createWorld(level, 1);
    renderer.resetWorld(world);
    prev = pose();
    shots = entranceShots(level, world.state.player.pos, world.state.player.yaw);
    hud.reset();
    endScreen.hide();
    audio.setPaused(false);
    keyboard.setEnabled(false);
    setPhase('title');
    title.show();
    focusItem(startButton);
  };
  const endScreen = new EndScreen(restart, quitToTitle, cue);

  const reader = new Reader(
    (note) => {
      flushInput();
      canvas.focus({ preventScroll: true });
      cue('note.closed', { id: note.id, first: note.first, count: note.count, total: note.total });
    },
    () => hud.device,
  );

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
    // Any click or tap skips the intro (after half a second).
    if (phase === 'intro') intro.skip();
  });
  window.addEventListener('keydown', (e) => {
    setDevice('keyboard');
    if (menu.handleKey(e)) return;
    // Any key skips the intro (after half a second).
    if (phase === 'intro') {
      intro.skip();
      return;
    }
    if (e.code === 'Escape' && !e.repeat) pause();
    // The title screen, the credits, the reader and the end screen handle their own keys.
  });

  /** Gamepad: the pause menu and Start to pause (their PadReader); the other screens read `padEdges`. */
  const routePad = (dt: number): boolean => {
    const pad = pads.read();
    if (!pad.connected) return false;
    if (pad.pressed) setDevice('gamepad');
    if (menu.isOpen) {
      menu.update(pad, dt);
      return true;
    }
    if (phase === 'play' && !world.ended && !reader.isOpen && padHas(pad.pressed, PAD.START)) {
      pause();
      return true;
    }
    return false;
  };

  // ───────────────────────────── Simulation ─────────────────────────────

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
    const p = world.state.player.pos;
    audio.onEvent(e, soundAt(e));
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
    if (e.type === 'note.read') {
      reader.open({
        id: String(e.id),
        text: String(e.text),
        style: e.style as NoteStyle,
        first: e.first === true,
        count: Number(e.count),
        total: Number(e.total),
      });
    }
    if (e.type === 'level.end') {
      setPhase('end');
      // The page owns the keyboard again (Tab, Enter on the end screen's buttons).
      keyboard.setEnabled(false);
      endScreen.show(world, (id) => id === level.id);
    }
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
    // Framed every tick, even when stopped, so edges stay in step with the devices.
    const live = framer.next(raw, tapped, camera.yaw);
    const running = phase === 'play' && !reader.isOpen;
    const input = running && !camera.focusing ? live : emptyFrame();
    if (swallow) {
      input.pressed = 0;
      if (live.held === 0) swallow = false;
    }
    if (running && camera.focusing && (tapped !== 0 || Math.hypot(raw.moveX, raw.moveY) > 0.5))
      camera.skipFocus();
    if (isPressed(input, 'recenter')) camera.recenter(world.state.player.yaw);
    if (running) stepWorld(world, input);
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
  /**
   * Renders the interpolated state; `cameraDt` lets the first frame snap the
   * camera into place, and `gameplay` forces the view behind Nora (warm-up).
   */
  const draw = (dt: number, cameraDt = dt, gameplay = false): void => {
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
    camera.narrow = renderer.camera.aspect < 0.8;
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
    // The title drifts on the entrance shot (held still with reduced motion); the intro flies its path.
    const orbit: Shot = { eye: { ...camera.eye }, look: { ...camera.lookAt } };
    view = gameplay
      ? orbit
      : phase === 'title'
        ? titleShot(shots[0] ?? orbit, settings.reducedMotion ? 0 : clock)
        : phase === 'intro'
          ? intro.update(dt, orbit)
          : orbit;
    const cinematic = view !== orbit;
    const toNora = Math.hypot(view.eye.x - at.x, view.eye.y - at.y - 1.4, view.eye.z - at.z);
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
      view.eye,
      view.look,
      cinematic ? toNora : camera.currentDistance,
      dt,
    );
    fx.update(dt);
    // The listener follows the view, with the player's yaw convention.
    audio.update({ ...view.eye, yaw: cinematic ? shotYaw(view) : camera.yaw }, dt);
  };

  // First frames behind the loading screen compile every shader the opening
  // needs: the gameplay view behind Nora, every effect, then the title view.
  loading.setStage('loading.prepare', 0.8);
  await nextFrame();
  camera.yaw = world.state.player.yaw;
  draw(0, 1, true);
  renderer.warmup();
  await nextFrame();
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
  let room: string | null = null;

  renderer.renderer.setAnimationLoop((now: number) => {
    const rawDt = (now - last) / 1000;
    const dt = Math.min(0.1, rawDt);
    last = now;

    const menuOwnsPad = routePad(dt);
    if (paused) {
      gamepad.update(0);
      if (redraw) {
        redraw = false;
        draw(0);
      }
      return;
    }
    clock += dt;

    gamepad.update(dt);
    const padState = gamepad.poll();
    if (padState.held !== 0) setDevice('gamepad');
    const pad = padEdges.next(padState);
    if (!menuOwnsPad) {
      if (phase === 'title') title.pad(pad);
      else if (phase === 'intro' && pad.any) intro.skip();
      else if (phase === 'end') endScreen.pad(pad);
      else reader.pad(pad);
    }
    reader.update(dt);

    const looking = phase === 'play' && !reader.isOpen;
    for (const d of devices) {
      const l = d.takeLook();
      if (looking) camera.look(l.x, l.y, l.zoom);
    }

    alpha = loop.advance(dt).alpha;
    draw(dt);
    redraw = false;
    if (phase === 'play') hud.update(world, dt);

    const p = world.state.player.pos;
    const r = level.roomAt(Math.floor(p.x / BLOCK), Math.floor(p.z / BLOCK));
    if (r && r.id !== room) {
      room = r.id;
      audio.setRoom((r.reverb as ReverbPreset | null) ?? null);
    }

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
    get phase() {
      return phase;
    },
    /** The entrance camera shots (title drift and intro path), editable for framing tests. */
    get shots() {
      return shots;
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
    loading,
    intro,
    reader,
    endScreen,
    skipIntro: () => intro.skip(),
    setQuality: (t: QualityTier) => {
      settings.quality = t;
      settings.qualitySource = 'user';
      applySetting('quality');
    },
  };
}

void main();
