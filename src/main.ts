import './ui/style.css';
import './ui/screens.css';
import './ui/prelude.css';
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
  MOBILE_DEFAULT_PIXEL_RATIO,
  QUALITY,
  TierBenchmark,
  dynamicResolutionFor,
  heuristicTier,
  autoFloor,
  lowerTier,
  type DeviceHints,
  type QualityTier,
} from './render/quality';
import { GameRenderer, type PlayerPose } from './render/scene';
import { levelFromQuery, levelIds, levelUrl, loadPlayableLevel } from './levels';
import type { NoteStyle } from './sim/grid/schema';
import { BLOCK } from './sim/grid/units';
import { torchInHand } from './sim/player/torch';
import { tuning } from './sim/player/tuning';
import { createWorld, respawn, stepWorld, type World } from './sim/world';
import { chamberOf, nextChamber } from './ui/campaign';
import { waterSurface } from './sim/actors/water';
import { ChamberMap } from './ui/chamber-map';
import { EndScreen } from './ui/end-screen';
import { browserProgressStorage, loadReached, markReached } from './ui/progress';
import { Hud, type Device } from './ui/hud';
import { applyStaticStrings, pickLocale, setLocale, t, type StringKey } from './ui/i18n';
import { Intro } from './ui/intro';
import { LoadingScreen } from './ui/loading';
import { Menu } from './ui/menu';
import { PadEdgeReader } from './ui/nav';
import { PAD, PadReader, focusItem, padHas } from './ui/pad';
import { Prelude } from './ui/prelude';
import { Reader } from './ui/reader';
import { registerServiceWorker } from './ui/service-worker';
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

/** Which temple mechanism a 'lever' use is working, for Nora's animation (see NoraPose.use). */
function useKind(world: World): 'mirror' | 'slot' | null {
  const use = world.state.mechanisms.use;
  const p = world.state.player;
  if (!use || p.mode !== 'lever') return null;
  const m = world.state.mechanisms;
  if (m.mirrors.some((x) => x.id === use.id)) return 'mirror';
  if (m.slots.some((x) => x.id === use.id)) return 'slot';
  return null;
}

/** Whether Nora stands on a moving platform's deck (her planted feet ride with it). */
function riding(world: World): boolean {
  const p = world.state.player;
  if (p.mode !== 'ground') return false;
  for (const pl of world.state.mechanisms.platforms) {
    if (
      Math.abs(pl.pos.x - p.pos.x) <= 1.1 &&
      Math.abs(pl.pos.z - p.pos.z) <= 1.1 &&
      Math.abs(pl.pos.y - p.pos.y) < 0.1
    )
      return true;
  }
  return false;
}

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
  const hints = deviceHints();
  // The lowest tier the game picks by itself: computers stop at medium.
  const floor = autoFloor(hints);
  const settings: Settings = loadSettings(
    storage,
    defaultSettings(matchMedia('(prefers-reduced-motion: reduce)').matches),
    floor === 'medium',
  );
  setLocale(settings.language ?? pickLocale(navigator.languages));
  applyStaticStrings();
  document.body.classList.toggle('reduce-motion', settings.reducedMotion);
  document.documentElement.classList.toggle('reduce-motion', settings.reducedMotion);

  const loading = new LoadingScreen();
  loading.trackDownloads();

  const canvas = $<HTMLCanvasElement>('#game');
  const stats = $('#hud-stats');
  const startButton = $<HTMLButtonElement>('#start-button');

  // The chamber asked for in the URL (?level=<id>), or the first one if it is unknown or broken.
  const level = await loadPlayableLevel(levelFromQuery(location.search));
  const chamber = chamberOf(level.id);
  const progress = browserProgressStorage();
  markReached(progress, level.id);
  const playable = new Set(levelIds());
  // The title's kicker and the pause menu name the chamber being played.
  const kicker = document.querySelector<HTMLElement>('.title-block .kicker');
  if (kicker && chamber?.kicker) {
    kicker.dataset.i18n = chamber.kicker;
    kicker.textContent = t(chamber.kicker);
  }
  for (const el of document.querySelectorAll<HTMLElement>('.menu-kicker[data-i18n^="level."]')) {
    el.dataset.i18n = level.name;
    el.textContent = t(level.name as StringKey);
  }

  // Audio exists before the renderer loads: the first tap or key, even during the
  // splash and the story cards, unlocks it and brings in the title theme softly.
  // Until then loading stays silent (browsers allow no sound before a gesture).
  const audio = new AudioEngine();
  audio.setLevel(level.id);
  let phase: Phase = 'title';
  audio.setMusicPhase('title');
  const titleMusic = (): void => {
    if (phase !== 'title') return;
    void audio.unlock();
    audio.setMusicPhase('title');
  };
  window.addEventListener('pointerdown', titleMusic, { capture: true });
  window.addEventListener('keydown', titleMusic, { capture: true });
  // A tap on the first-paint splash, before this code loaded, already unlocked audio (index.html): start now.
  if (audio.gestureSeen) titleMusic();

  // The story cards over the loading reel (index.html): when they give way to the
  // title, the start button takes the focus if the tomb is ready.
  const prelude = new Prelude(() => {
    if (loading.isReady) startButton.focus({ preventScroll: true });
  });
  /** Loading is over: the button wakes, and the cards finish the one on screen. */
  const loadingDone = (): void => {
    loading.ready();
    prelude.ready();
    // Offline play and fast restarts, once the first room no longer needs the bandwidth.
    registerServiceWorker();
  };

  // Quality: the stored tier, or on first run the device heuristic until the benchmark decides.
  let tier: QualityTier = settings.quality ?? heuristicTier(hints);
  // Options → Renderer: WebGL 2 on request; otherwise WebGPU where the browser has it (three.js
  // falls back to WebGL 2 by itself when WebGPU is missing or fails to start).
  const renderer = new GameRenderer(canvas, QUALITY[tier], settings.renderer === 'webgl2');
  renderer.setReducedMotion(settings.reducedMotion);
  try {
    await renderer.init();
  } catch (err) {
    $('#fatal').hidden = false;
    throw err;
  }

  let world: World = createWorld(level, 1);
  renderer.setWorld(world);

  audio.setEmitters(
    level.entities
      .filter((e) => (e.type === 'brazier' && e.lit) || e.type === 'relic')
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

  const setPhase = (p: Phase): void => {
    phase = p;
    document.body.dataset.phase = p;
    document.body.classList.toggle('playing', p === 'play');
    // The music director follows the phase: title theme, intro, the tomb's silences, the end.
    audio.setMusicPhase(p);
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

  /**
   * The automatic resolution's pixel-ratio cap: the tier's, except on the
   * mobile tier, where the first-run benchmark measured what the phone holds
   * (while it measures, the tier's highest ratio).
   */
  const autoPixelRatio = (): number | null => {
    if (tier !== 'mobile') return null;
    if (benchmark) return QUALITY.mobile.pixelRatioCap;
    return settings.mobilePixelRatio ?? MOBILE_DEFAULT_PIXEL_RATIO;
  };
  const applyResolution = (): void => {
    renderer.setResolution(settings.resolution, autoPixelRatio());
    drs.reset(QUALITY[tier].minRenderScale);
    renderer.setRenderScale(1);
  };
  const applyImage = (): void => {
    renderer.setImageOptions({
      filmGrain: settings.filmGrain,
      sharpen: settings.sharpen,
      textureFiltering: settings.textureFiltering,
    });
  };
  /** The corner readout (backend, tier, frame rate, resolution) only when asked for in options. */
  const applyStats = (): void => {
    stats.hidden = !settings.showStats;
    if (!settings.showStats) stats.textContent = '';
  };
  const applyTier = (t: QualityTier): void => {
    tier = t;
    renderer.setQuality(QUALITY[t]);
    applyResolution();
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
        document.documentElement.classList.toggle('reduce-motion', settings.reducedMotion);
        break;
      case 'renderer':
        // The backend is chosen when the renderer is created: save and start again.
        saveSettings(storage, settings);
        location.reload();
        return;
      case 'resolution':
        applyResolution();
        menu.refresh();
        break;
      case 'filmGrain':
      case 'sharpen':
      case 'textureFiltering':
        applyImage();
        break;
      case 'showStats':
        applyStats();
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
    graphics: {
      activeBackend: () => renderer.backendName,
      autoGrain: () => renderer.quality.filmGrain && !settings.reducedMotion,
      autoSharpen: () => renderer.pixelRatio < (window.devicePixelRatio || 1) - 0.01,
    },
  });
  applyVolumes();
  applyCamera();
  applyResolution();
  applyImage();
  applyStats();

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
  for (const b of document.querySelectorAll<HTMLButtonElement>('#start button, #end button')) {
    b.addEventListener('pointerenter', () => audio.ui('hover'));
  }

  const start = (): void => {
    if (
      phase !== 'title' ||
      starting ||
      !loading.isReady ||
      prelude.running ||
      menu.isOpen ||
      chambers.isOpen
    )
      return;
    starting = true;
    // Audio and fullscreen must be requested inside the gesture itself.
    void audio.unlock();
    audio.ui('confirm');
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
      // Cards read over the loading reel are not shown again: the flythrough carries the rest.
      intro.start(
        [view, ...shots.slice(1)],
        (chamber?.intro ?? []).slice(prelude.seen),
        document.body.classList.contains('touch'),
        settings.reducedMotion,
      );
      // Two frames of the intro under the curtain, then lift it.
      requestAnimationFrame(() => requestAnimationFrame(() => curtain.classList.remove('in')));
    }, 480);
  };
  const title = new TitleScreen(
    start,
    (type, data) => cue(type, data),
    () => menu.isOpen || chambers.isOpen || !loading.isReady || prelude.running,
  );
  $('#start-chambers').addEventListener('click', () => {
    if (!menu.isOpen && !prelude.running) chambers.open(loadReached(progress), playable);
  });
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
    // A fresh world carries no torch: its crackle stops.
    audio.onEvent({ type: 'torch.state', tick: 0, lit: false, hand: false }, world.state.player.pos);
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
    // A fresh world carries no torch: its crackle stops.
    audio.onEvent({ type: 'torch.state', tick: 0, lit: false, hand: false }, world.state.player.pos);
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
  /**
   * Another chamber: the page loads again with its id, which releases every
   * GPU resource of this one (the WebGPU device goes with the page).
   */
  const goToLevel = (id: string): void => {
    if (id === level.id && phase === 'title') return;
    markReached(progress, id);
    audio.ui('confirm');
    curtain.classList.add('in');
    window.setTimeout(() => location.assign(levelUrl(location.href, id)), 480);
  };
  const chambers = new ChamberMap(goToLevel, level.id, (type) => cue(type));
  const endScreen = new EndScreen(restart, quitToTitle, cue, goToLevel);

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
    if (e.type === 'player.respawned') {
      // The checkpoint may bring back a torch in another state: the crackle follows it.
      const t = world.state.player.torch;
      audio.onEvent({ type: 'torch.state', tick: e.tick, lit: t.has && t.lit, hand: !t.stowed }, p);
    }
    hud.onEvent(e, world);
    renderer.combat.onEvent(e, world);
    renderer.onEvent(e);
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
      // The next chamber is reached: the map opens it, and the end screen offers it.
      const next = nextChamber(level.id)?.level;
      if (next && playable.has(next)) markReached(progress, next);
      endScreen.show(world, (id) => playable.has(id));
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
        const cx = Math.floor(p.pos.x / BLOCK);
        const cz = Math.floor(p.pos.z / BLOCK);
        const s = level.sector(cx, cz);
        lastMaterial = s?.mat ?? lastMaterial;
        // Wading: her feet splash under the live surface, and leave no prints.
        const surface = waterSurface(world, cx, cz);
        const wading = surface !== null && p.pos.y < surface - 0.03;
        const material = wading ? 'water' : lastMaterial;
        audio.onEvent({ type: 'footstep', tick: world.tick, material, run: running }, p.pos);
        if (!wading) fx.footstep(p.pos, p.yaw, lastMaterial, running);
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
        torch: torchInHand(p) ? 1 : 0,
        use: useKind(world),
        riding: riding(world),
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
    // First run (spec §11): measure the title scene for ~3 s at the guessed tier.
    // Phones too: they stay on the mobile tier, and the frames decide how
    // sharp it renders (its pixel ratio).
    const guess = heuristicTier(hints);
    benchmark = new TierBenchmark(guess);
    if (guess === 'mobile') applyResolution();
    loading.setStage('loading.calibrate', 0.9);
  } else {
    loadingDone();
  }

  const finishBenchmark = (b: TierBenchmark): void => {
    const chosen = b.result(floor) ?? heuristicTier(hints);
    settings.quality = chosen;
    settings.qualitySource = 'auto';
    if (b.measured === 'mobile') settings.mobilePixelRatio = b.pixelRatio() ?? MOBILE_DEFAULT_PIXEL_RATIO;
    saveSettings(storage, settings);
    if (chosen !== tier) applyTier(chosen);
    else applyResolution();
    menu.refresh();
    loadingDone();
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
      if (phase === 'title' && prelude.running) {
        if (pad.any) prelude.skip();
      } else if (phase === 'title' && chambers.isOpen) chambers.pad(pad);
      else if (phase === 'title') title.pad(pad);
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
    audio.setHealth(world.state.player.health / tuning.maxHealth);
    audio.setUnderwater(renderer.underwater);

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
    } else if (dynamicResolutionFor(settings.resolution)) {
      const change = drs.update(rawDt);
      if (change === 'down' || change === 'up') renderer.setRenderScale(drs.scale);
      else if (
        change === 'floor' &&
        settings.qualitySource === 'auto' &&
        tier !== floor &&
        tier !== 'mobile'
      ) {
        settings.quality = lowerTier(tier, floor);
        saveSettings(storage, settings);
        applyTier(settings.quality);
        menu.refresh();
      }
    }

    fpsFrames++;
    fpsTime += dt;
    if (fpsTime >= 0.5) {
      if (settings.showStats) {
        // Technical readout for the owner: backend, tier, frame rate, pixel ratio and scene scale.
        const scale = dynamicResolutionFor(settings.resolution) ? drs.scale : 1;
        stats.textContent = [
          renderer.backendName,
          tier,
          `${Math.round(fpsFrames / fpsTime)} fps`,
          `${renderer.pixelRatio.toFixed(2)}×`,
          `${Math.round(scale * 100)}%`,
        ].join(' · ');
      }
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
    /** The audio engine: `__nc.audio.debug()` shows the context state, voices, gains and the watchdog log. */
    audio,
    start,
    pause,
    resume,
    renderer,
    fx,
    menu,
    settings,
    drs,
    loading,
    prelude,
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
