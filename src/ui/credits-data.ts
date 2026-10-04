/**
 * The credits' rows (spec §13 "Menús"), shared by the title's credits panel
 * and the roll after the campaign's end: a label and its lines, translated.
 */
import { audioCredits } from './build-info';
import { t, type StringKey } from './i18n';

/** Label and value keys, in order. */
const ROWS: [StringKey, StringKey][] = [
  ['credits.game.label', 'credits.game.value'],
  ['credits.engine.label', 'credits.engine.value'],
  ['credits.fonts.label', 'credits.fonts.value'],
  ['credits.textures.label', 'credits.textures.value'],
  ['credits.animation.label', 'credits.animation.value'],
  ['credits.art.label', 'credits.art.value'],
];

export function creditRows(): [string, readonly string[]][] {
  return [
    ...ROWS.map(([label, value]): [string, readonly string[]] => [t(label), [t(value)]]),
    [t('credits.audio.label'), audioCredits.length ? audioCredits : [t('credits.audio.fallback')]],
  ];
}
