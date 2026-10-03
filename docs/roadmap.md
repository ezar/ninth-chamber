# Roadmap to 0.4.0

Agreed with the owner on 2026-10-03, after 0.3.0 passed its gate on the owner's iPhone (saves survive a reload, 30 fps or more, WebGPU works). The owner chose Phase 3 of the spec (§2, "Beta y publicación") over a new chamber: chamber VI, the Bronze Forge, waits. The owner left the open design decisions to Claude, following the spec; each one taken is listed below for review. All three releases were built on 2026-10-03; the gate's state is in the changelog under 0.4.0.

**Goal:** close Phase 3: accessibility (spec §13), Spanish, English and Catalan (§13, "Localización"), an installable PWA that plays offline (§14), and the Phase 3 gate: no known softlocks and an initial load under 4 s on 4G (§2).

## Decisions

| Topic             | Decision                                                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Content           | No new chamber. Chamber VI waits for 0.5.                                                                                                                                                                          |
| Catalan           | Yes (spec §18 left it open): a full `i18n/ca.json`, offered in Options and picked from the browser language.                                                                                                       |
| Hosting           | Stays on GitHub Pages (spec §18 left Vercel or Netlify open). It already deploys from `main`, serves over HTTPS and runs the service worker; moving brings nothing the game needs today.                           |
| Initial load      | "Initial load" is measured as the time until the title screen can be used, on an emulated 4G link (9 Mbps down, 150 ms RTT) with an empty cache. The first room may keep loading behind the title.                 |
| Softlocks         | Two layers: a static reachability check in the level validator (exit, secrets and checkpoints reachable from the start), and "Restart from checkpoint", which already exists, as the escape from any stuck puzzle. |
| Game speed        | 75 % slows the simulation's wall clock only. Ticks, timings and records stay the same, so the stats are not penalized (spec §13).                                                                                  |
| Adaptive AI hints | Not in 0.4. Pregenerated hints only, as in 0.2.6.                                                                                                                                                                  |

## 0.3.5 · Accessibility

1. **Subtitles** for every relevant sound, with the side they come from ("[Stone grinding, left]"), in three sizes. The option exists since 0.2.0 but does nothing yet.
2. **Visual trap warnings** next to the sound: a short directional mark on the HUD when a trap arms (darts, slabs, boulders, spikes).
3. **Hold or toggle** for Action and Walk.
4. **Game speed** at 75 %.
5. **High contrast** for grabbable edges.
6. **Colour-blind safe** health and poison bars (shape and pattern as well as colour).
7. **Touch buttons**: size and opacity in Options.

## 0.3.6 · Catalan and softlocks

1. **Catalan**: every key in `i18n/ca.json`, the language picker and the browser-language default.
2. **Reachability in the validator**: an over-approximating graph of where the controller can go (steps, grabs, drops, jumps, swimming, doors treated as openable). An exit, secret or checkpoint it cannot reach fails `pnpm validate:levels`. Checkpoints on deadly sectors or inside traps also fail (spec §16).
3. **Softlock audit** of the four chambers: every pushable block and one-way drop checked against the restart.
4. **WebGL warnings on the medium and high tiers** ("bindTexture: attempt to use a deleted object"), found while testing 0.3.5; the smoke test runs every tier once they are gone.

## 0.4.0 · Publication

1. **Load time**: `pnpm loadtime` measures the cold start on emulated 4G in Chromium and fails above 4 s; trim what the title screen waits for until it passes.
2. **Offline check**: a browser test that loads the game, goes offline, reloads and reaches the title and the first room.
3. **Update notice**: when a new version is waiting in the service worker, a quiet notice on the title and in the pause menu, never in the middle of play.
4. **Phase 3 gate** written up in the changelog, with what is the owner's to check (the name search and playtests with people, spec §16 and §18).

## How it will be built

- **Three small releases** (0.3.5, 0.3.6, 0.4.0), each a PR with its own changelog entry, merged when CI is green.
- **Commit often.** Container restarts and usage limits have cost work before.
