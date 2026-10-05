# Licence

**Status: decided by the owner on 2026-10-05 (0.9.14).** The code is open source under the MIT License, and the game's own assets stay closed. This settles the licence question of spec §18 ("Decisiones abiertas").

The full text is in [LICENSE](../LICENSE) at the root. In short:

| Part                  | Folders                                                                                                                                         | Terms                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Code                  | `src/`, `scripts/`, `tests/`, `index.html`, `.github/`, the configuration files                                                                 | MIT License                                                                 |
| The game's own assets | `levels/`, `i18n/`, `art/`, `docs/art/`, `docs/spec.md`, `public/` (except third-party files), the names, the characters, the logo and the seal | © 2026 César, all rights reserved                                           |
| Third-party work      | listed in [CREDITS.md](../CREDITS.md) and `public/audio/CREDITS.md`                                                                             | their own licences (CC0, CC BY 4.0, SIL OFL 1.1, MIT, Adobe's Mixamo terms) |

`package.json` says `"license": "SEE LICENSE IN LICENSE"`, because a single SPDX identifier would not describe the split.

## Where it shows

- The title screen's copyright line (`start.copyright` in `i18n/*.json`).
- The header of `CREDITS.md`, which the build also ships as `credits.txt`.

## Adding files

- New code (TypeScript, scripts, tests, styles) is MIT.
- New levels, texts, models, animation, textures or images made for the game are closed: put them in the folders listed above.
- A third-party file goes in `CREDITS.md` with its source and licence, and must allow redistribution in a web game.
