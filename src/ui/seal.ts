/**
 * The nine-segment seal (identity artboard f): a ring of nine segments, eight
 * cut in stone and the ninth only an outline, lit amber. Drawn as inline SVG
 * for the title lockup, the end-of-level rank and the favicon.
 */

const R_OUT = 100;
const R_IN = 70;
/** Half the gap between segments, in degrees. */
const GAP = 2;

const point = (r: number, deg: number): string => {
  const a = (deg * Math.PI) / 180;
  return `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`;
};

/** Segment i (0–8) clockwise from the top; segment 8 is the ninth, just left of the top. */
export function segmentPath(i: number): string {
  const a0 = -90 + i * 40 + GAP;
  const a1 = -90 + (i + 1) * 40 - GAP;
  return (
    `M${point(R_OUT, a0)} A${R_OUT} ${R_OUT} 0 0 1 ${point(R_OUT, a1)} ` +
    `L${point(R_IN, a1)} A${R_IN} ${R_IN} 0 0 0 ${point(R_IN, a0)} Z`
  );
}

export interface SealOptions {
  /** Stone segments drawn solid (0–8); the rest are dim outlines. */
  lit?: number;
  /** The ninth segment: an amber outline (the default) or filled amber. */
  ninth?: 'outline' | 'filled';
  /** Accessible label; decorative (aria-hidden) when omitted. */
  label?: string;
  className?: string;
}

export function sealSvg(opts: SealOptions = {}): string {
  const lit = opts.lit ?? 8;
  const segments = Array.from({ length: 8 }, (_, i) =>
    i < lit
      ? `<path class="seal-stone" d="${segmentPath(i)}"/>`
      : `<path class="seal-dim" d="${segmentPath(i)}"/>`,
  ).join('');
  const ninth = `<path class="seal-ninth${opts.ninth === 'filled' ? ' filled' : ''}" d="${segmentPath(8)}"/>`;
  const a11y = opts.label
    ? `role="img" aria-label="${opts.label.replace(/"/g, '&quot;')}"`
    : 'aria-hidden="true"';
  return (
    `<svg class="seal-svg ${opts.className ?? ''}" viewBox="-110 -110 220 220" ${a11y}>` +
    `${segments}${ninth}<circle class="seal-ring" r="22"/><circle class="seal-core" r="8"/></svg>`
  );
}
