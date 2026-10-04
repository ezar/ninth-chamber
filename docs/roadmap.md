# Roadmap to 1.0

Agreed with the owner on 2026-10-04, after 0.9.0: the campaign is complete (I to IX), and 1.0 is the release that can be put in front of people. The roadmap to 0.9.0 is closed; its record, with the owner's four decisions on chamber IX, is in the changelog (0.8.5 to 0.9.0).

**Status:** in progress (0.9.5).

## 0.9.5 · The Ninth Chamber in full, its own music, golden replays

1. **Chamber IX in full.** Spec §19 asks for 30 to 40 minutes and "traps that combine everything before". 0.9.0's echo rooms each hold one simple puzzle. Each echo room gains a second beat that mixes its chamber's mechanism with another one's, and the run in the conjunction's light gets traps of its own. The bot's walkthroughs, both endings, the three secrets and "every puzzle is needed" tests stay.
2. **Music of their own for chambers IV to IX.** Until now they borrow the cues of chambers I to III. Each gets its own intro, exploration and relic cues, and tension and combat beds where the mood differs. All tracks are CC-BY or CC0, built by `scripts/audio/build_audio.py` and credited in `public/audio/CREDITS.md`.
3. **Golden replays** (spec §16): the golden path of every chamber, recorded as input frames, is played back in CI, and the world's hash is compared every 60 ticks. If they differ, the test names the first tick that diverged. `pnpm replay:update` records them again after an intended change.

## 0.9.6 · Accessibility and the whole campaign

1. **Accessibility left from 0.3.5**: tutorial hints that can be turned off, and touch buttons that can be moved.
2. **The campaign, I to IX, as one**: softlocks, texts and their continuity, par times, and the download with nine chambers.

## 1.0 · Release

1.0 ships when the owner's part is done, or when the owner chooses to ship without it:

- playtests with five people (spec §16);
- the iPhone check: 30 fps or more, and a save that survives a reload;
- the name search (EUIPO, USPTO), and the final name;
- the licence (docs/license.md);
- the owner's models (docs/art/models-brief.md), or the decision to ship with the stand-ins;
- the open decisions of spec §18: adaptive hints, the touch joystick, the classic mode, right-click to shoot.

## How it will be built

- **Small releases**, each a PR with its own changelog entry, merged when CI is green.
- **Commit often.** Container restarts and usage limits have cost work before.
