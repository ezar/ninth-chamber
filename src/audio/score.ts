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
   * Dry, dusty, hushed: the Clay Archive draws on the quietest cues of the
   * first three chambers until it has its own (docs/changelog.md, 0.3.0).
   */
  clay_archive: {
    intro: 'antechamber.intro',
    explore: ['antechamber.explore.2', 'cisterns.explore.2'],
    tension: 'antechamber.tension',
    combat: 'sun_temple.combat',
    chase: 'chase',
    boss: 'boss',
    relic: 'antechamber.relic',
    fanfare: 'fanfare',
    stingers: { ...STINGERS, solved: 'sting.solved.2' },
  },
  /**
   * Heavy, metallic, hot: the Bronze Forge draws on the Temple of the Sun's
   * weightier cues until it has its own (docs/changelog.md, 0.5.0).
   */
  bronze_forge: {
    intro: 'sun_temple.intro',
    explore: ['sun_temple.explore.2', 'antechamber.explore.1'],
    tension: 'sun_temple.tension',
    combat: 'sun_temple.combat',
    chase: 'chase',
    boss: 'boss',
    relic: 'sun_temple.relic',
    fanfare: 'sun_temple.fanfare',
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
