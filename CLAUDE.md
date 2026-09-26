# The Ninth Chamber

Tomb-exploration game for the browser. The full spec is in docs/spec.md (written in Spanish): read it before any design change.

## Language

- Everything in the repo is in English: code, identifiers, comments, file and folder names, tests, commit messages, PRs and docs (except docs/spec.md, which is the owner's source document).
- Player-facing text never lives in code: it goes in i18n/*.json (en is the reference; es and ca follow) and is read through src/ui/i18n.ts.

## Rules

- TypeScript strict. No any except at library boundaries.
- src/sim does not import three or anything from the DOM. Everything in sim/ must run in Node.
- No Math.random or Date.now in sim/: use world.rng and the tick counter.
- No generic physics engines. Own grid collision.
- Gameplay constants only in src/sim/player/tuning.ts.
- The simulation emits events; audio, render and UI only listen.
- Levels in levels/*.level.json, validated with the schema in src/sim/grid/schema.ts.
- Do not use names, characters or assets from Tomb Raider.
- Visuals follow art/looks/*.json and the Claude Design concepts in docs/art/. After any visual change, regenerate the reference shots with pnpm shots and compare them with the concept.

## Workflow

- Before touching sim/: write or update the movement test in tests/.
- pnpm test and pnpm validate:levels must pass before a milestone is done.
- Each milestone ends with a demo on the preview URL and a note in docs/changelog.md.

## Commands

- pnpm dev, pnpm test, pnpm validate:levels, pnpm replay:update, pnpm shots, pnpm build
- Available since milestone 1: pnpm dev, pnpm test, pnpm lint, pnpm typecheck, pnpm format, pnpm build. validate:levels, replay:update and shots arrive with milestones 2 and V1.

## How the rules are enforced

- eslint.config.js forbids, in src/sim, importing three or presentation layers, Math.random, Date.now and DOM globals.
- tsconfig.sim.json compiles src/sim and the pure core (loop, rng, events, input-frame) without the DOM lib.
- tests/i18n.test.ts checks that every locale has the same keys as English.
