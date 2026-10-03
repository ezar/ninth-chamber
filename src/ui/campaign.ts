/**
 * The campaign's story data (spec §1: eight known chambers and a ninth nobody
 * has found; each relic reveals a clue towards it). Text lives in i18n; this
 * module only says which keys belong to which chamber, for the intro, the
 * level title, the end screen and a future campaign map.
 *
 * The clues: the Amber Heart's star map says where to look in the sky, the
 * Tide Glass says on which night (a new moon), the Sun Disc says which way to
 * walk (the sunset of the longest day). From the fourth on, the relics are
 * parts of the key: the Tablet of the Name gives the word that opens the
 * ninth. Every relic shows eight signs and the empty place of a ninth, like
 * the seal.
 */
import type { StringKey } from './i18n';

/** How the end screen draws a relic's clue: eight signs and a missing ninth. */
export type RelicFigure = 'stars' | 'moons' | 'rays' | 'signs' | 'segments' | 'notes';

export interface Relic {
  name: StringKey;
  /** One line: what the relic reveals towards the ninth chamber. */
  clue: StringKey;
  figure: RelicFigure;
  /** Accessible description of the figure. */
  figureLabel: StringKey;
  /** The relic moment on the end screen, in order. */
  moment: readonly [StringKey, StringKey, StringKey];
  /** End screen kicker, e.g. "Tomb of Qarrum · First chamber cleared". */
  cleared: StringKey;
}

export interface Chamber {
  /** Roman numeral on the map and in kickers. */
  numeral: string;
  /** Level id (levels/<id>.level.json) for chambers that can be played. */
  level?: string;
  name: StringKey;
  /** One-line description for the campaign map. */
  line: StringKey;
  /** Chambers with no level yet: sealed (IV–VIII) or not found (IX). */
  status?: 'sealed' | 'unknown';
  /** Kicker above the level title, e.g. "Tomb of Qarrum · First chamber". */
  kicker?: StringKey;
  /** One-sentence premise (level select, loading screen). */
  premise?: StringKey;
  /** Story cards of the intro, in order. */
  intro?: readonly StringKey[];
  relic?: Relic;
  /** End-screen line under the next chamber's name. */
  teaser?: StringKey;
  /** i18n prefixes of the chamber's journal notes (`<prefix>.meta|title|body`), in story order. */
  journal?: readonly string[];
}

export const CHAMBERS: readonly Chamber[] = [
  {
    numeral: 'I',
    level: 'antechamber',
    name: 'level.antechamber',
    line: 'chamber.1.line',
    kicker: 'start.kicker',
    premise: 'premise.antechamber',
    intro: ['intro.antechamber.1', 'intro.antechamber.2', 'intro.antechamber.3', 'intro.antechamber.4'],
    relic: {
      name: 'relic.antechamber.name',
      clue: 'relic.antechamber.clue',
      figure: 'stars',
      figureLabel: 'end.antechamber.figure',
      moment: ['end.antechamber.1', 'end.antechamber.2', 'end.antechamber.3'],
      cleared: 'end.antechamber.kicker',
    },
    teaser: 'teaser.antechamber',
    journal: [
      'journal.antechamber.1',
      'journal.antechamber.2',
      'journal.antechamber.3',
      'journal.antechamber.4',
    ],
  },
  {
    numeral: 'II',
    level: 'cisterns',
    name: 'level.cisterns',
    line: 'chamber.2.line',
    kicker: 'kicker.cisterns',
    premise: 'premise.cisterns',
    intro: ['intro.cisterns.1', 'intro.cisterns.2', 'intro.cisterns.3'],
    relic: {
      name: 'relic.cisterns.name',
      clue: 'relic.cisterns.clue',
      figure: 'moons',
      figureLabel: 'end.cisterns.figure',
      moment: ['end.cisterns.1', 'end.cisterns.2', 'end.cisterns.3'],
      cleared: 'end.cisterns.kicker',
    },
    teaser: 'teaser.cisterns',
    journal: ['journal.cisterns.1', 'journal.cisterns.2', 'journal.cisterns.3'],
  },
  {
    numeral: 'III',
    level: 'sun_temple',
    name: 'level.sun_temple',
    line: 'chamber.3.line',
    kicker: 'kicker.sun_temple',
    premise: 'premise.sun_temple',
    intro: ['intro.sun_temple.1', 'intro.sun_temple.2', 'intro.sun_temple.3'],
    relic: {
      name: 'relic.sun_temple.name',
      clue: 'relic.sun_temple.clue',
      figure: 'rays',
      figureLabel: 'end.sun_temple.figure',
      moment: ['end.sun_temple.1', 'end.sun_temple.2', 'end.sun_temple.3'],
      cleared: 'end.sun_temple.kicker',
    },
    teaser: 'teaser.sun_temple',
    journal: ['journal.sun_temple.1', 'journal.sun_temple.2', 'journal.sun_temple.3'],
  },
  {
    numeral: 'IV',
    level: 'clay_archive',
    name: 'level.clay_archive',
    line: 'chamber.4.line',
    kicker: 'kicker.clay_archive',
    premise: 'premise.clay_archive',
    intro: ['intro.clay_archive.1', 'intro.clay_archive.2', 'intro.clay_archive.3'],
    relic: {
      name: 'relic.clay_archive.name',
      clue: 'relic.clay_archive.clue',
      figure: 'signs',
      figureLabel: 'end.clay_archive.figure',
      moment: ['end.clay_archive.1', 'end.clay_archive.2', 'end.clay_archive.3'],
      cleared: 'end.clay_archive.kicker',
    },
    teaser: 'teaser.clay_archive',
    journal: ['journal.clay_archive.1', 'journal.clay_archive.2', 'journal.clay_archive.3'],
  },
  { numeral: 'V', name: 'chamber.5.name', line: 'chamber.5.line', status: 'sealed' },
  {
    numeral: 'VI',
    level: 'bronze_forge',
    name: 'chamber.6.name',
    line: 'chamber.6.line',
    kicker: 'kicker.bronze_forge',
    premise: 'premise.bronze_forge',
    intro: ['intro.bronze_forge.1', 'intro.bronze_forge.2', 'intro.bronze_forge.3'],
    relic: {
      name: 'relic.bronze_forge.name',
      clue: 'relic.bronze_forge.clue',
      figure: 'segments',
      figureLabel: 'end.bronze_forge.figure',
      moment: ['end.bronze_forge.1', 'end.bronze_forge.2', 'end.bronze_forge.3'],
      cleared: 'end.bronze_forge.kicker',
    },
    teaser: 'teaser.bronze_forge',
    journal: ['journal.bronze_forge.1', 'journal.bronze_forge.2', 'journal.bronze_forge.3'],
  },
  {
    numeral: 'VII',
    level: 'wind_stair',
    name: 'chamber.7.name',
    line: 'chamber.7.line',
    kicker: 'kicker.wind_stair',
    premise: 'premise.wind_stair',
    intro: ['intro.wind_stair.1', 'intro.wind_stair.2', 'intro.wind_stair.3'],
    relic: {
      name: 'relic.wind_stair.name',
      clue: 'relic.wind_stair.clue',
      figure: 'notes',
      figureLabel: 'end.wind_stair.figure',
      moment: ['end.wind_stair.1', 'end.wind_stair.2', 'end.wind_stair.3'],
      cleared: 'end.wind_stair.kicker',
    },
    teaser: 'teaser.wind_stair',
    journal: ['journal.wind_stair.1', 'journal.wind_stair.2', 'journal.wind_stair.3'],
  },
  { numeral: 'VIII', name: 'chamber.8.name', line: 'chamber.8.line', status: 'sealed' },
  { numeral: 'IX', name: 'chamber.9.name', line: 'chamber.9.line', status: 'unknown' },
];

export const chamberOf = (levelId: string): Chamber | undefined => CHAMBERS.find((c) => c.level === levelId);

/**
 * The chamber after a level's, in campaign order: the next one that can be
 * played, skipping chambers not built yet (the Forge, VI, opens after the
 * Archive, IV, until the Root Halls, V, exist; the Wind Stair, VII, follows
 * the Forge); with none left, the next sealed one, for the end screen's teaser.
 */
export function nextChamber(levelId: string): Chamber | undefined {
  const i = CHAMBERS.findIndex((c) => c.level === levelId);
  if (i < 0) return undefined;
  return CHAMBERS.slice(i + 1).find((c) => c.level) ?? CHAMBERS[i + 1];
}
