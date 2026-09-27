# Performance

Targets (spec §3 and §14): 60 fps at medium on a laptop with integrated graphics, 30+ fps on an iPhone 12, the first playable room in under 8 s; under 150 draw calls and 300,000 triangles on mobile, 250 and 600,000 at medium, 400 and 1.5 million at high.

## How the numbers were taken

`pnpm bench` (`scripts/perf/bench.ts`) drives a production build in headless Chromium with Playwright. For each tier it:

1. loads the page with the tier stored in settings (no first-run calibration) and records the time until the title's start button is ready, and every resource's transfer size;
2. skips the prelude and the intro, then stands Nora at the centre of each of the ten rooms of The Antechamber and turns the camera towards every doorway to a neighbouring room (20 views). These are the views where room culling could pop, and `--shots <dir>` saves one screenshot per view;
3. per view, discards `--warm` frames and records `--frames` frames: CPU time of the frame callback (`performance.now()` around it), wall time since the previous frame, and `renderer.info.render.drawCalls` and `triangles` for the whole frame (scene, shadow maps and post passes);
4. samples every allocation along the route with the CDP heap sampling profiler (including objects already collected), and traces the main thread in the first room (`devtools.timeline`, `v8.gc`) for its breakdown and GC count;
5. reads `renderer.info.memory` (programs, textures and their GPU size estimate, geometries, buffers) and `Performance.getMetrics` (JS heap).

The machine that took these numbers has no GPU: Chromium runs WebGL 2 on SwiftShader, and other jobs shared its four cores. Wall time per frame (seconds there) and CPU time swing a lot between runs, so compare draw calls, triangles, memory and allocations first; timings only as a rough direction. On real hardware, fragment cost (lights per pixel, overdraw, post) dominates, which SwiftShader exaggerates.

## Before and after (mobile tier, 960 × 540, SwiftShader)

Baseline: integ-base at 9be3cbb (the merge before this work). After: this branch. Same route, 3 warm-up and 4 measured frames per view. Summary over the 20 views:

| Metric                                                                         |         Before |        After |        Change |
| ------------------------------------------------------------------------------ | -------------: | -----------: | ------------: |
| Draw calls (mean / max)                                                        |      226 / 418 |    160 / 274 |         -29 % |
| Triangles (mean / max)                                                         |    278k / 378k |  176k / 272k |         -37 % |
| CPU frame, median (ms)                                                         |           31.3 |         19.3 |         -38 % |
| CPU frame, worst view p90 (ms)                                                 |        11922.7 |       6042.7 |         -49 % |
| Programs                                                                       |             73 |          121 |          66 % |
| Textures (count / MB)                                                          |    111 / 424.1 |  109 / 418.8 |          -1 % |
| Geometries                                                                     |            363 |          334 |          -8 % |
| Vertex + index buffers (MB)                                                    |           10.9 |           10 |          -8 % |
| JS heap after route (MB)                                                       |           26.3 |         28.3 |           8 % |
| Allocation on the route (KB/frame)                                             |         2218.8 |       2454.1 |          11 % |
| GC in trace window (minor / major / ms)                                        | 10 / 0 / 12.34 | 8 / 0 / 3.38 |         -73 % |
| Steady allocation in play, entrance (KB/frame, 1 KB sampling)                  |            790 |          555 |         -30 % |
| Load to title ready (s, 5 s polling, two runs each on the same loaded machine) |     14.4, 25.4 |   13.5, 16.9 | no regression |

Per view (draw calls and triangles are for the whole frame: scene, shadow maps and post passes):

| View                      | Draw calls before | after | Triangles before | after |
| ------------------------- | ----------------: | ----: | ---------------: | ----: |
| entrance → brazier_hall   |               392 |   265 |             369k |  272k |
| brazier_hall → entrance   |               104 |    90 |             221k |  126k |
| brazier_hall → plate_hall |               306 |   238 |             311k |  251k |
| gallery → descent         |               361 |   116 |             348k |  147k |
| gallery → relic           |                94 |    91 |             210k |  105k |
| relic → gallery           |               418 |   154 |             378k |  155k |
| plate_hall → brazier_hall |               221 |   197 |             269k |  200k |
| plate_hall → hourglass    |               165 |   197 |             250k |  195k |
| plate_hall → well         |                75 |    82 |             208k |  115k |
| plate_hall → causeway     |               140 |   108 |             238k |  140k |
| hourglass → plate_hall    |               307 |   239 |             310k |  255k |
| hourglass → well          |               220 |   151 |             283k |  184k |
| well → plate_hall         |                85 |    86 |             209k |  130k |
| well → hourglass          |               242 |   103 |             277k |  117k |
| causeway → plate_hall     |               289 |   255 |             302k |  254k |
| causeway → scales         |               169 |   160 |             251k |  163k |
| scales → causeway         |               329 |   274 |             328k |  269k |
| scales → descent          |               146 |   146 |             236k |  147k |
| descent → gallery         |               123 |   121 |             224k |  126k |
| descent → scales          |               328 |   119 |             331k |  169k |

What the numbers say:

- **Draw calls down 29 % on average and 34 % at the worst view; triangles down 37 %.** Views that look down a long line of rooms gain most (relic → gallery 418 → 154 calls, descent → scales 328 → 119). Views inside the big central halls (the entrance, the brazier hall, the hall of weights) keep more, because the rooms they see through their doorways are really visible. The mobile budget is 150 calls and 300,000 triangles: the mean is now at it (160 / 176k), every view is under the triangle budget, and the worst views are at 240 to 274 calls.
- **The worst frames halved** (p90 of the worst view 11.9 s → 6.0 s on SwiftShader). Those spikes are shader and pipeline compiles on first sight of a room's materials; the whole-level warm-up moves them behind the loading screen. The shadow-pass variants still compile on entering a room (see Left to do).
- **Main thread per frame down by half** in the trace window (animation frame 29.3 → 13.5 ms, GC 1.5 → 0.4 ms per frame, minor GCs 10 → 8), from culling fewer objects, no hidden rooms' particle updates and fewer lights to upload.
- **Programs went up (73 → 121)** because the warm-up now compiles every room's materials (and instanced variants for the dressing) up front, where the old route compiled them as it went. It is the cost that used to appear as hitches.
- **Texture memory is unchanged (about 420 MB)** and is the largest overrun of the mobile budget. It needs KTX2 (Left to do).
- **Point lights per pixel**: mobile 18 → 10 (6 fire lights + character fill + relic + 2 bounce), high 22 → 14. On a real GPU this is the biggest per-pixel saving; SwiftShader's wall time moved from 5.9 s to 3.4 s per frame on median, but the machine's load changed between runs, so treat it only as a direction.
- **Transfer** is unchanged for this route (about 24.3 MB: 14.8 MB of GLB, 8.6 MB of JPEG, 0.5 MB of scripts gzip). The script is now split: `three` 266 kB gzip (cacheable across deploys), game 181 kB, post nodes 44 kB (lazy). Repeat visits and the installed PWA start from the service worker's cache.

Screenshots of every view before and after were compared side by side: no missing geometry through doorways, no popping between views, and the same lighting (the bounce pool keeps the current room's bounce; the flames' flicker now shares opacity per layer, a change not visible at play distance).

## What changed

- **Room culling through portals** (`src/render/rooms.ts`, `src/render/room-culling.ts`). A portal is the opening where open sectors of two rooms touch (a box from the lower floor to the higher ceiling along the shared cell edges). Each frame a breadth-first walk from the camera's room (and Nora's, when different) crosses portals whose box is inside the view frustum, at most three deep (spec §14). Every room has a group; hidden rooms' groups are not drawn at all, in the main pass or in shadow maps. What follows its room: the level geometry (now merged per room and surface, one shared material per surface), braziers and flames, entities, crumbling tiles, spikes, the set dressing, sun shafts, their dust and sky, and jackals. Lights are never hidden (a different light count recompiles every material); their cost is bounded by pools instead. Objects are sorted by their bounds, so things added later (entity views, baked props) are sorted when they appear. The test is conservative (a portal behind a wall but inside the frustum still counts), so nothing visible through a doorway is dropped; `tests/rooms.test.ts` covers the graph and the walk.
- **Warm-up for every room**. The loading warm-up and the frame after the baked props arrive draw every room with frustum culling off, so the shaders of rooms not yet seen compile behind the loading screen instead of stalling on entering them.
- **Instanced set dressing** (`src/render/prop-models.ts`): the static dressing (rubble, pots, sand drifts, column bases and capitals, the altar) is one `InstancedMesh` per model part and room instead of a cloned hierarchy per piece. The 96 flame sprites share four materials instead of one each.
- **Fewer lights per pixel**: every point light is evaluated by every lit pixel of every material. The ten sun-bounce lights (one per sunlit room, only one ever lit) are now a pool of two that follows the current room with the same fade, so mobile goes from 18 point lights to 10 and high from 22 to 14.
- **Particles**: dust in rooms out of sight is not animated or uploaded, and dust and embers update only the tier's share that is drawn.
- **Loading**: three.js is its own chunk (`three-<hash>.js`, 266 kB gzip), whose name survives game deploys. Nora's model is preloaded from the HTML, in parallel with the scripts. The post-processing nodes stay a lazy chunk.
- **Service worker** (`scripts/vite-sw.ts`, registered by `src/ui/service-worker.ts` once loading is done). Generated per build; its version is a hash of the bundle file names (content-hashed) and every file in `public/`, and activation deletes older caches. Install precaches the engine and the first room (models, textures, animations, lightmap, icons, about 26 MB); music and sounds are cached when first used. Pages load network first, so a deploy is never hidden behind the cache; hashed bundles are cache first (a new build has new names, so they can never be stale); other files are served from the cache and refreshed behind it. A new worker waits for open tabs to close instead of taking over a running game, and `netlify.toml` serves `sw.js` with `no-cache`.

## Left to do

- **Texture compression (KTX2)**. Texture memory is the largest budget overrun: about 424 MB estimated at the mobile tier (spec: 400 MB for everything), from the 2K scanned JPEG sets (colour, normal, ARM for five surfaces) and the prop and Nora GLBs' 1K WebP/PNG textures. The plan: encode albedo as ETC1S and normal/ARM as UASTC with full mip chains (`toktx` or `ktx2-encoder` in a build script; neither is available in this environment), load them with `KTX2Loader` and the Basis transcoder from `three/addons` (already in `node_modules/three/examples/jsm/libs/basis`), keep the JPEGs as the fallback, and re-pack the GLBs with `gltf-transform etc1s/uastc`. Expected: GPU texture memory down about 4 to 6 times, downloads down about half.
- **Shadow-pass warm-up**: materials are compiled for the main pass, but the first sun or point shadow render of a room's objects still compiles their depth variants on entering it. Rendering each shadow map once with culling off during warm-up would remove that.
- **Audio and menus as lazy chunks**: the game chunk (556 kB, 181 kB gzip) still holds the audio engine and every screen. The audio engine is created before the renderer so the first tap can start the title music; splitting it needs `main.ts` to await a dynamic import there.
- **Braziers**: 24 cloned brazier models (a few meshes each) remain separate draws; with culling only the visible rooms' ones draw, but they could also be instanced (their coals already share one animated material).
- **Nora's pistols and holsters** draw as about 22 small meshes; merging them per material would save draw calls in every view.
- **Adaptive quality** (`src/render/quality.ts`): dynamic resolution steps down after a second over 18 ms and first-run calibration now benchmarks phones too (Options → Graphics shows the live readout). With culling, fewer phones should need to drop scale; re-check the thresholds on an iPhone 12 with the readout.

## How to profile

- **Benchmark**: `pnpm build && pnpm preview --port 5334`, then `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm bench --url http://localhost:5334/ --tiers mobile,medium,high --out bench.json --shots shots/`. `--warm` and `--frames` set frames per view. With SwiftShader a tier takes 10 to 30 minutes; on a machine with a GPU, drop the SwiftShader flags from `runTier()` for real timings.
- **In the game**: Options → Graphics shows the live frame time readout. `window.__nc` exposes `renderer` (`renderer.renderer.info` has draw calls, triangles and memory), `renderer.culling` (`.rooms` is the set drawn this frame; `.setEnabled(false)` draws everything, to compare), `drs`, `setQuality(tier)`, `world` and `camera`.
- **Chrome DevTools**: the Performance panel with "Screenshots" off and CPU throttling at 4× approximates a phone's main thread; look for `FireAnimationFrame` length, `MinorGC` frequency and long `Compile`/`build` stacks (node material compilation) when entering a room. The Memory panel's allocation sampling over a walk through two rooms shows per-frame garbage.
- **Phones**: Safari's Web Inspector (iPhone over USB) Timelines → Rendering Frames and JavaScript Allocations; Chrome Android via `chrome://inspect`. Use the in-game readout with the tier forced from the console (`__nc.setQuality('mobile')`).
