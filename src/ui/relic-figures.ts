/**
 * The clue carved inside each relic, drawn for the end screen. Every figure
 * follows the seal: eight signs where the stone segments are, and an empty
 * place where the ninth should be (the ninth segment's angle, top left).
 * Classes are shared so the end screen's staged animation applies to all.
 */
import type { RelicFigure } from './campaign';

/** Centre angle (degrees) of seal segment i, clockwise from the top; 8 is the ninth. */
const angle = (i: number): number => -70 + i * 40;

const at = (deg: number, r: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [Number((r * Math.cos(a)).toFixed(1)), Number((r * Math.sin(a)).toFixed(1))];
};

const frame = (label: string, body: string): string =>
  `<svg viewBox="-130 -130 260 260" role="img" aria-label="${label.replace(/"/g, '&quot;')}">` +
  `<defs><radialGradient id="map-amber"><stop offset="0" stop-color="#f2a93b" stop-opacity="0.34"/>` +
  `<stop offset="0.7" stop-color="#e8a33d" stop-opacity="0.08"/><stop offset="1" stop-color="#e8a33d" stop-opacity="0"/>` +
  `</radialGradient></defs><circle class="map-halo" r="128" fill="url(#map-amber)"/>` +
  `<circle class="map-ring" r="112"/>${body}</svg>`;

/** The Amber Heart: eight stars joined in order, the ninth an empty ring. */
function stars(): string {
  const radii = [66, 84, 58, 78, 90, 62, 82, 72];
  const pts = radii.map((r, i) => at(angle(i), r));
  const ninth = at(angle(8), 76);
  const first = pts[0] ?? [0, 0];
  const last = pts[pts.length - 1] ?? [0, 0];
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
  const dots = pts
    .map(
      ([x, y], i) =>
        `<g class="map-star" style="--i:${i}"><circle class="glow" cx="${x}" cy="${y}" r="7"/>` +
        `<circle cx="${x}" cy="${y}" r="${i === 0 ? 3.4 : 2.6}"/></g>`,
    )
    .join('');
  return (
    `<path class="map-line" pathLength="1" d="${line}"/>` +
    `<path class="map-gap" d="M${last[0]} ${last[1]} L${ninth[0]} ${ninth[1]} L${first[0]} ${first[1]}"/>` +
    `${dots}<circle class="map-here" cx="${first[0]}" cy="${first[1]}" r="8"/>` +
    `<circle class="map-ninth" cx="${ninth[0]}" cy="${ninth[1]}" r="8"/>`
  );
}

/** The Tide Glass: eight faces of the moon on its path, the ninth (the new moon) dark. */
function moons(): string {
  const r = 8;
  const faces = Array.from({ length: 8 }, (_, i) => {
    const [x, y] = at(angle(i), 80);
    // Waxing to full and back: the shadow disc slides across the lit one.
    const lit = (1 - Math.cos(((i + 1) / 9) * 2 * Math.PI)) / 2;
    const dx = (2 * r * lit * (i < 4 ? -1 : 1)).toFixed(1);
    return (
      `<g class="map-star" style="--i:${i}"><circle class="glow" cx="${x}" cy="${y}" r="12"/>` +
      `<circle cx="${x}" cy="${y}" r="${r}"/>` +
      `<circle class="moon-shadow" cx="${x + Number(dx)}" cy="${y}" r="${r}"/></g>`
    );
  }).join('');
  const [nx, ny] = at(angle(8), 80);
  return (
    `<circle class="map-line" pathLength="1" r="80"/>${faces}` +
    `<circle class="map-ninth" cx="${nx}" cy="${ny}" r="${r + 1}"/>`
  );
}

/** The Sun Disc: eight cut rays and an uncut ninth, a line of light pointing the way. */
function rays(): string {
  const cut = Array.from({ length: 8 }, (_, i) => {
    const [x0, y0] = at(angle(i), 40);
    const [x1, y1] = at(angle(i), 94);
    return `<path class="map-line" pathLength="1" d="M${x0} ${y0} L${x1} ${y1}"/>`;
  }).join('');
  const [gx0, gy0] = at(angle(8), 40);
  const [gx1, gy1] = at(angle(8), 126);
  const [nx, ny] = at(angle(8), 104);
  return (
    `<g class="map-star" style="--i:0"><circle class="glow" r="36"/><circle class="sun-disc" r="28"/></g>` +
    `${cut}<path class="map-gap" d="M${gx0} ${gy0} L${gx1} ${gy1}"/>` +
    `<circle class="map-ninth" cx="${nx}" cy="${ny}" r="7"/>`
  );
}

export function relicFigureSvg(figure: RelicFigure, label: string): string {
  const body = figure === 'moons' ? moons() : figure === 'rays' ? rays() : stars();
  return frame(label, body);
}
