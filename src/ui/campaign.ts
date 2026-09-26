/**
 * The campaign's story data (spec §1: eight known chambers and a ninth nobody
 * has found; each relic reveals a clue towards it). Text lives in i18n; this
 * module only says which keys belong to which chamber, for the intro, the
 * level title, the end screen and a future campaign map.
 *
 * The clues: the Amber Heart's star map says where to look in the sky, the
 * Tide Glass says on which night (a new moon), the Sun Disc says which way to
 * walk (the sunset of the longest day). Every relic shows eight signs and the
 * empty place of a ninth, like the seal.
 */
import type { StringKey } from './i18n';

/** How the end screen draws a relic's clue: eight signs and a missing ninth. */
export type RelicFigure = 'stars' | 'moons' | 'rays';

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
  { numeral: 'IV', name: 'chamber.4.name', line: 'chamber.4.line', status: 'sealed' },
  { numeral: 'V', name: 'chamber.5.name', line: 'chamber.5.line', status: 'sealed' },
  { numeral: 'VI', name: 'chamber.6.name', line: 'chamber.6.line', status: 'sealed' },
  { numeral: 'VII', name: 'chamber.7.name', line: 'chamber.7.line', status: 'sealed' },
  { numeral: 'VIII', name: 'chamber.8.name', line: 'chamber.8.line', status: 'sealed' },
  { numeral: 'IX', name: 'chamber.9.name', line: 'chamber.9.line', status: 'unknown' },
];

export const chamberOf = (levelId: string): Chamber | undefined => CHAMBERS.find((c) => c.level === levelId);

/** The chamber after a level's, in campaign order. */
export function nextChamber(levelId: string): Chamber | undefined {
  const i = CHAMBERS.findIndex((c) => c.level === levelId);
  return i < 0 ? undefined : CHAMBERS[i + 1];
}
