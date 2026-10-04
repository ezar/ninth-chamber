/**
 * The score: which cue plays in which music state, per chamber (spec §12
 * "Música"). Cue ids are the keys of `music` in samples.json, built by
 * scripts/audio/build_audio.py; docs/audio.md explains how to add one.
 *
 * Palettes are picked by level id, so a new level gets music by adding an
 * entry here (unknown levels use the Antechamber's).
 */

import manifest from './samples.json';

export type CueId = keyof typeof manifest.music;

export interface CueInfo {
  file: string;
  kind: 'stream' | 'loop' | 'sting';
  duration: number;
  /** Loops: tempo and length in bars of four beats (0: free time, no bar grid). */
  bpm?: number;
  bars?: number;
  /** Loops: loop length (s); decoders may pad the last frame. */
  length?: number;
  /** Decode rate for loops and stingers. */
  rate?: number;
}

const CUES = manifest.music as unknown as Record<CueId, CueInfo>;

export function cueInfo(id: string): CueInfo | undefined {
  return Object.prototype.hasOwnProperty.call(CUES, id) ? CUES[id as CueId] : undefined;
}

/** Procedural motifs the player synthesises (not files). */
export type Motif = 'motif.checkpoint' | 'motif.secret';

export interface Palette {
  /** Under the story cards. */
  intro: CueId;
  /** Played one at a time, in turn, with long silences between. */
  explore: readonly CueId[];
  /** Layered bed that intensifies: timed doors, cracking floors, trap zones, low health. */
  tension: CueId;
  /** While enemies hunt the player. */
  combat: CueId;
  chase: CueId;
  boss: CueId;
  /** The relic reveal. */
  relic: CueId;
  fanfare: CueId;
  stingers: {
    vista: CueId;
    journal: CueId;
    secret: CueId;
    solved: CueId;
    death: CueId;
  };
}

export const TITLE: CueId = 'title';

const STINGERS: Palette['stingers'] = {
  vista: 'sting.vista',
  journal: 'sting.journal',
  secret: 'sting.secret',
  solved: 'sting.solved',
  death: 'sting.death',
};

export const PALETTES: Record<string, Palette> = {
  /** Ancient, desert, solemn. */
  antechamber: {
    intro: 'antechamber.intro',
    explore: ['antechamber.explore.1', 'antechamber.explore.2'],
    tension: 'antechamber.tension',
    combat: 'antechamber.combat',
    chase: 'chase',
    boss: 'boss',
    relic: 'antechamber.relic',
    fanfare: 'fanfare',
    stingers: STINGERS,
  },
  /** Dark, watery, echoing. */
  cisterns: {
    intro: 'cisterns.intro',
    explore: ['cisterns.explore.1', 'cisterns.explore.2'],
    tension: 'cisterns.tension',
    combat: 'cisterns.combat',
    chase: 'chase',
    boss: 'boss',
    relic: 'cisterns.relic',
    fanfare: 'fanfare',
    stingers: { ...STINGERS, solved: 'sting.solved.2' },
  },
  /** Majestic, golden, with a boss. */
  sun_temple: {
    intro: 'sun_temple.intro',
    explore: ['sun_temple.explore.1', 'sun_temple.explore.2'],
    tension: 'sun_temple.tension',
    combat: 'sun_temple.combat',
    chase: 'chase',
    boss: 'boss',
    relic: 'sun_temple.relic',
    fanfare: 'sun_temple.fanfare',
    stingers: STINGERS,
  },
  /**
   * Dry, dusty, hushed: a library of clay tablets. Ambient drones and winds,
   * a plucked lute duet and languid strings; Arab-tinged plucked and bowed
   * strings when the clay guardian wakes, and a duduk theme over the
   * orchestra for the relic.
   */
  clay_archive: {
    intro: 'clay_archive.intro',
    explore: ['clay_archive.explore.1', 'clay_archive.explore.2'],
    tension: 'antechamber.tension',
    combat: 'clay_archive.combat',
    chase: 'chase',
    boss: 'boss',
    relic: 'clay_archive.relic',
    fanfare: 'fanfare',
    stingers: { ...STINGERS, solved: 'sting.solved.2' },
  },
  /**
   * Green, damp and alive: a buried forest. Boreal ambience, soil after rain,
   * harp and flute in an overgrown wood; strings and synths in the dark for
   * tension, and tribal percussion against the scorpions.
   */
  root_halls: {
    intro: 'root_halls.intro',
    explore: ['root_halls.explore.1', 'root_halls.explore.2'],
    tension: 'root_halls.tension',
    combat: 'root_halls.combat',
    chase: 'chase',
    boss: 'boss',
    relic: 'root_halls.relic',
    fanfare: 'fanfare',
    stingers: STINGERS,
  },
  /**
   * Heavy, metallic, hot: anvils, brass and choir, industrial percussion and
   * glitchy machines for the automatons, a steampunk organ-and-brass theme
   * for the relic. Bazûr fights to the shared boss loop.
   */
  bronze_forge: {
    intro: 'bronze_forge.intro',
    explore: ['bronze_forge.explore.1', 'bronze_forge.explore.2'],
    tension: 'bronze_forge.tension',
    combat: 'bronze_forge.combat',
    chase: 'chase',
    boss: 'boss',
    relic: 'bronze_forge.relic',
    fanfare: 'sun_temple.fanfare',
    stingers: STINGERS,
  },
  /**
   * Night and bronze, with a boss: the night sky, mysterious and majestic,
   * with a grand final chorus for the relic. It keeps the Temple of the Sun's
   * tension and combat; Anzur fights to the shared boss loop.
   */
  observatory: {
    intro: 'observatory.intro',
    explore: ['observatory.explore.1', 'observatory.explore.2'],
    tension: 'sun_temple.tension',
    combat: 'sun_temple.combat',
    chase: 'chase',
    boss: 'boss',
    relic: 'observatory.relic',
    fanfare: 'sun_temple.fanfare',
    stingers: STINGERS,
  },
  /**
   * Airy and high: a mountain pass, floating synths and strings, lilting
   * winds; an eerie flute over percussion for tension, and soaring vocals
   * toward the horizon for the relic. It keeps the Cisterns' combat.
   */
  wind_stair: {
    intro: 'wind_stair.intro',
    explore: ['wind_stair.explore.1', 'wind_stair.explore.2'],
    tension: 'wind_stair.tension',
    combat: 'cisterns.combat',
    chase: 'chase',
    boss: 'boss',
    relic: 'wind_stair.relic',
    fanfare: 'fanfare',
    stingers: { ...STINGERS, solved: 'sting.solved.2' },
  },
  /**
   * The finale, a walk back through every chamber: its own intro, two
   * exploration cues (ghosts and echoes of the past) and the seal (Light in
   * Dark Places). Between its own cues, exploration returns on purpose to one
   * cue from each earlier chamber in campaign order, and tension and combat
   * are the Antechamber's, where the campaign began.
   */
  ninth_chamber: {
    intro: 'ninth_chamber.intro',
    explore: [
      'ninth_chamber.explore.1',
      'antechamber.explore.1',
      'cisterns.explore.1',
      'sun_temple.explore.2',
      'clay_archive.explore.1',
      'ninth_chamber.explore.2',
      'root_halls.explore.1',
      'bronze_forge.explore.1',
      'wind_stair.explore.1',
      'observatory.explore.1',
    ],
    tension: 'antechamber.tension',
    combat: 'antechamber.combat',
    chase: 'chase',
    boss: 'boss',
    relic: 'ninth_chamber.relic',
    fanfare: 'fanfare',
    stingers: STINGERS,
  },
};

export function paletteFor(levelId: string): Palette {
  return PALETTES[levelId] ?? (PALETTES.antechamber as Palette);
}

/** Every cue a palette may need, for prefetching (the loops and stingers are decoded ahead). */
export function paletteCues(p: Palette): CueId[] {
  return [p.tension, p.combat, ...Object.values(p.stingers), p.chase, p.boss];
}
