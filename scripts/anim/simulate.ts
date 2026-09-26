/**
 * Prints how Nora's clip animator moves her feet at a given speed, for tuning:
 *   tsx scripts/anim/simulate.ts [speed=2.2] [seconds=3] [turnRate=0]
 */
import { LocomotionProbe, plantedSlide } from './locomotion-probe';

const speed = Number(process.argv[2] ?? 2.2);
const seconds = Number(process.argv[3] ?? 3);
const turn = Number(process.argv[4] ?? 0);
const samples = new LocomotionProbe().run({ speed: () => speed, yaw: (t) => turn * t, seconds });
const f = (v: number, w = 6): string => v.toFixed(3).padStart(w);
const deg = (r: number): string => ((r * 180) / Math.PI).toFixed(0).padStart(3);
for (let i = 0; i < samples.length; i += 3) {
  const s = samples[i];
  if (!s || s.t < seconds - 1.2) continue;
  const row = s.feet.map(
    (ft, k) =>
      `${k ? 'R' : 'L'} heel ${f(ft.heel.y)} ball ${f(ft.ball.y)} ankle y ${f(ft.ankle.y)} knee ${deg(ft.knee)}`,
  );
  console.log(`${s.t.toFixed(2)} hips ${f(s.hipsY)} | ${row.join(' | ')}`);
}
for (let i = 1; i < samples.length; i++) {
  const a = samples[i - 1];
  const b = samples[i];
  if (!a || !b || b.t < seconds - 1.2) continue;
  for (let s = 0; s < 2; s++)
    for (const k of ['heel', 'ball'] as const) {
      const pa = a.feet[s]?.[k];
      const pb = b.feet[s]?.[k];
      if (!pa || !pb || pa.y > 0.01 || pb.y > 0.01) continue;
      const v = Math.hypot(pb.x - pa.x, pb.z - pa.z) / (b.t - a.t);
      if (v > 0.3)
        console.log(`  slide ${b.t.toFixed(3)} ${s ? 'R' : 'L'} ${k} ${v.toFixed(2)} m/s y ${f(pb.y)}`);
    }
}
for (const s of samples)
  s.feet.forEach((ft, k) => {
    if (Math.min(ft.heel.y, ft.ball.y) < -0.004)
      console.log(
        `  below floor ${s.t.toFixed(3)} ${k ? 'R' : 'L'} heel ${f(ft.heel.y)} ball ${f(ft.ball.y)}`,
      );
  });
const hips = samples.filter((s) => s.t > 1).map((s) => s.hipsY);
console.log(
  `speed ${speed}: hips ${Math.min(...hips).toFixed(3)}..${Math.max(...hips).toFixed(3)}, ` +
    `planted slide max ${plantedSlide(samples, 1).toFixed(3)} m/s`,
);
