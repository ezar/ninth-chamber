# Roadmap to 0.3.0

Agreed with the owner on 2026-09-27, after 0.2.4. 0.2.5, 0.2.6 and 0.3.0 were built on 2026-10-03; the owner asked for the work to go ahead before outside feedback arrived. Two checks of the 0.3.0 gate are the owner's, on the iPhone (see below). Playtest feedback from people outside the project (spec §16, "Pruebas con personas") may still reorder or cut the items below. The design of chamber IV is in [spec §19](spec.md).

**Goal:** close Phase 2 of the spec (inventory, keys and relics, save, options, control remapping) and open the second half of the campaign with chamber IV, the Clay Archive.

## Decisions

| Topic            | Decision                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content          | Chamber IV only (the Clay Archive). Chamber VI waits.                                                                                                   |
| Pistol holsters  | Move from the thighs to the hips (spec §18 rules out thigh holsters as a likeness risk).                                                                |
| Saving           | Automatic only: a save at every checkpoint and when the page goes to the background, plus Continue on the title. No manual slots and no export for now. |
| Inventory        | A panel in the pause menu (keys, puzzle items, relics). Not the 3D ring from spec §9.                                                                   |
| Catalan          | Later (Phase 3). The game stays in English and Spanish.                                                                                                 |
| Hints            | Pregenerated only (three per puzzle, reviewed by hand, offline). No live AI hints.                                                                      |
| TypeScript 7     | Upgrade only if ESLint supports it and every check passes. Otherwise skip, with no partial changes.                                                     |
| Tester telemetry | Yes, first, in 0.2.5.                                                                                                                                   |

## 0.2.5 · Playtest tools and fixes

1. **Local playtest log**, exportable with one button and kept on the device (nothing is sent anywhere):
   - device, renderer and quality tier;
   - average and worst FPS;
   - deaths, time and hints per room;
   - where the player quit.
2. **Holsters on the hips.**
3. **Per-room light mask**, so fire lights without shadows no longer shine through walls into the next room.
4. **Dark scenes:** the Temple's boulder run and deep, unlit water on the mobile tier.
5. **WebGL warnings:** track down the "bindTexture: attempt to use a deleted object" and "texture format / sampler mismatch" warnings (present since before 0.2.0).
6. **KTX2 textures** (ETC1S albedo, UASTC normal and ARM) to bring texture memory under the 400 MB mobile budget (today about 420 MB).
7. **TypeScript 7,** if compatible.

## 0.2.6 · Phase 2 systems

1. **Saving** (spec §9):
   - Autosave at checkpoints and on `visibilitychange`, with Continue on the title screen.
   - IndexedDB, with a schema version and numbered migrations so updates never break a save.
2. **Inventory:**
   - a pause-menu panel with keys, puzzle items and relics, with names and descriptions in i18n;
   - item slots that consume their item.
3. **Control remapping** for keyboard and gamepad, in Options.
4. **Pregenerated hints:** `levels/<id>.hints.json`, three graded hints per puzzle, offered after three minutes without progress (spec §15, offline mode).

## 0.3.0 · Chamber IV, the Clay Archive

1. **The level,** as specified in spec §19:
   - ten rooms, three secrets, three journal notes;
   - glyph locks read from the notes;
   - dart traps;
   - Tamrit, the clay guardian that reforms and is beaten with water;
   - a baked lightmap, its own music palette and room looks;
   - a bot walkthrough, and "every puzzle is needed" tests.
2. **Tooling:**
   - `pnpm shots` for reference captures per room;
   - a browser smoke test in CI that loads each level and checks for console errors.
3. **Release gate** (the Phase 2 gate, spec §2):
   - all four chambers complete end to end with every secret, with the bot and all tests green;
   - saves survive a reload on a phone;
   - 30 fps or more on the owner's iPhone, read from the in-game performance readout.

## How it will be built

- **Three small releases** (0.2.5, 0.2.6, 0.3.0), each a PR with its own changelog entry.
- **Parallel agents** only for work that touches separate files.
- **Commit often.** Container restarts and usage limits have cost work before.

## Playtest questions (to send with the link)

These are for players, without guiding them while they play:

1. Where did you get stuck, and for how long?
2. Did any jump, grab or control feel unfair, especially on touch?
3. Did the camera get in the way in tight spaces?
4. What device did you play on, and was it smooth? If you can, turn on Options → Graphics → performance readout and note the FPS.
5. Did the sound cut out at any point?
6. What did you like most, what did you like least, and would you keep playing?
7. If you can, export the playtest log (Options → Playtest → Export playtest log) and send it with your answers. It stays on your device until you do.
