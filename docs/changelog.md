# Changelog

## Version 0.9.15 (2026-10-05): Licence fixes

- **Every image, screenshot, model, animation, audio or video file in the repository is closed, wherever it is.** Before, a file outside the listed asset folders fell under the MIT part.
- **`bind-capture.png` removed.** It was a stray Options screenshot at the root, committed by mistake in 0.2.6 and used nowhere.
- **The README** says the licence: MIT for the code, the game's own assets closed. Before, it still called the licence an open decision.

## Version 0.9.14 (2026-10-05): The licence

The owner chose the licence (spec §18): **the code is open source under the MIT License, and the game's own assets stay closed.**

- **`LICENSE`** at the root:
  - MIT for the code: `src/`, `scripts/`, `tests/`, `index.html`, `.github/` and the configuration files;
  - all rights reserved for the game's own assets: levels, texts in every language, art, models, animation, lightmaps, icons, the names, the characters, the logo and the seal.
  - Third-party work keeps its own licence, as listed in `CREDITS.md`.
- **`package.json`**: `"license": "SEE LICENSE IN LICENSE"`.
- **Where it shows**: the title screen's copyright line (in English, Spanish and Catalan) and the header of `CREDITS.md` say so.
- **`docs/license.md`** gives the split in a table and what to do with new files.

## Version 0.9.13 (2026-10-05): Classic mode fixes

- **No auto-grab of ropes and climbable walls in classic mode.** Action must be held for them too, as for ledges. One rule now decides all three grabs (`reachesForHold`).
- **The Classic mode row appears as soon as the campaign is finished.** Before, it showed only after a reload. The row is always built, and shown each time the menu opens once an ending has been reached.
- **Tests**: tests/classic-mode.test.ts (ropes and walls, with and without assists). The menu row was checked in the browser, ending a chamber without a reload.

## Version 0.9.12 (2026-10-05): The owner's decisions, and classic mode

The open decisions of spec §18, settled by the owner:

- **Hints: pregenerated only.** No adaptive hints and no calls to an API. Nora's ideas stay the ones written per puzzle.
- **Touch joystick: floating.** It appears where the left thumb lands, as it has since 0.1.
- **Shooting on a computer: right-click as well as F**, as built.
- **Classic mode: unlocked by finishing the campaign.**

Classic mode (spec §5 "Esquemas de control" and "Ayudas"):

- **Unlocking it.** The first ending of the campaign, either one, unlocks it. The end screen says so, and Options → Accessibility gains a _Classic mode_ row. Until then the game plays assisted whatever the setting says.
- **Tank controls.** Up runs the way Nora faces, down steps back without turning round, and the sides turn her on the spot, also when swimming. Hanging, on a wall and in the air, the sides move her left and right of her own facing. The camera keeps behind her, unless the player is looking round.
- **No assists.** There is no coyote time after running off an edge and no jump buffer before landing. Action must be held to grab a ledge.
- **In the simulation** it is `world.classic`, set by the game from the option. It is not part of the state, so saves and golden replays are the same either way.
- **Tests**: tests/classic-mode.test.ts (tank controls, each assist on by default and off in classic mode) and tests/camera-framing.test.ts (the camera behind her).

## Version 0.9.11 (2026-10-05): A missing wall clip

- **A climbing direction whose clip did not load fades to the idle.** A missing loop no longer takes weight from the idle, which had left the previous direction's clip frozen at full strength until it popped to the idle.
- **Tests**: tests/anim.test.ts.

## Version 0.9.10 (2026-10-05): Wall clip fixes

- **Taking hold of a wall no longer starts a climb.** The root moves onto the face on the frame she takes hold (up 0.15 m from the ground, down from a ledge). That move no longer counts as climbing speed, so she holds still in the idle.
- **A change of direction on the wall cross-fades.** Each climbing loop has its own weight: the new direction fades in while the old one fades out. Going from up to sideways no longer swaps one clip for another in a frame.
- **Tests**: tests/anim.test.ts.

## Version 0.9.9 (2026-10-05): Nora climbs with her own clips

- **Climbing walls of roots with Mixamo clips** made on Nora's mesh. They replace the procedural pose, which stays as the fallback:
  - _still on the face_: Hanging Idle 1;
  - _up and down_: Climbing Up Wall and Climbing Down Wall;
  - _left and right_: Left Shimmy and Right Shimmy.
  - Each move blends in from the idle as she starts. Its cadence follows her speed along the face.
- **The clip baker** (`pnpm anim:build`) gains two options for wall clips:
  - `climb` takes out the travel up, down or along the face, and measures the clip's speed along it;
  - `anchor: "wall"` puts the hands on the face where the climbing pose holds it, and raises a clip until no foot is below the floor.
- **Not used**: Jump Backward. Off a wall, Nora turns round in the air to catch what is behind her, and that clip ends facing the wall. The jump keeps the standing jump clip.

## Version 0.9.8 (2026-10-04): Touch layout fixes, again

- **A button that was hidden is clamped when it shows again.** This covers the note reader closing after a rotation, the torch button once the torch is found, and the start of play. Each button is watched for its size, which changes when it shows.
- **The editor drags from where a button is drawn.** A saved offset clamped to a smaller screen no longer jumps back off screen at the first drag. Only the buttons moved are saved with their new place.
- Reading a drawn offset back accepts the browser's short form ("-742px" for "-742px 0px"), which a browser check found.
- **Tests**: tests/touch-layout.test.ts.

## Version 0.9.7 (2026-10-04): Touch layout fixes

- **Moved touch buttons stay on screen.** A saved layout is drawn only as far as the screen allows. It is checked again when the game starts, on every resize and rotation, and after the button size changes. The saved layout itself is not changed, so turning the phone back restores it.
- **Escape closes only the touch editor.** It no longer also backs out of Options. While the editor is open, no key reaches the menu or the game.
- **Tests**: tests/touch-layout.test.ts.

## Version 0.9.6 (2026-10-04): Accessibility and the whole campaign

The second release on the way to 1.0 (docs/roadmap.md).

- **Tutorial hints** (Options → Accessibility): they can be turned off.
  - Off hides the tips on how to play and the "Nora has an idea" prompt.
  - Her remarks about each chamber, story and puzzles, always show.
  - The ideas stay in the pause menu.
- **Touch buttons that can be moved** (Options → Accessibility → Arrange touch buttons):
  - The buttons show over a veil. Each one is dragged where the thumbs want it, and kept on screen.
  - Reset puts them all back, and Done keeps the layout.
  - Each button keeps an offset from its own place, so the size and opacity options still apply.
- **The campaign, I to IX, as one**:
  - _The timed run in chamber IX could trap a player._ After a fall Nora went back to the hall of mirrors with one minute, and had to solve it again and cross two more rooms before the next checkpoint. The bot needs 58 seconds for that stretch.
    - Every room of the run now starts with a checkpoint, and she gets at least two minutes back after a fall.
    - A test checks that the longest stretch, at a third of the bot's pace, fits in that time.
  - _Softlocks_: every pushable block in the nine chambers has a reset lever or was audited in 0.3.6. Chamber IX's sand room gains its lever.
  - _Texts_: each chamber's last line and the next one's first were read in a row. The Forge's last line said "the way down", but the stair goes up. It now reads "The way on is open", and Spanish and Catalan were already right.
  - _Par times_: chambers IV to IX use the lower bound of the spec's durations. Chamber IX's par time is now 30 minutes, up from 25.
  - _Download_: the game is 86 MB in all, and 45 MB of it is music. Only the engine and the first room are precached. Each chamber then loads its own lightmap (about 1.3 MB), and its music streams as it first plays.
- **Tests**: tutorial hints and the touch layout in tests/settings.test.ts, and the timed run's checkpoints in tests/ninth-chamber.test.ts.

## Version 0.9.5 (2026-10-04): The Ninth Chamber in full, its own music, golden replays

The first release on the way to 1.0 (docs/roadmap.md, rewritten for 1.0).

- **The Ninth Chamber in full** (spec §19 asks for traps that combine everything before). Each echo room gains a second beat that mixes mechanisms:
  - _the dome_: the ring on its mark and a block pushed onto the new moon; the door wants both;
  - _the wind_: above the updraught, a bridge one block wide over a pit, with gusts from the side (a fall costs a climb, not a life);
  - _the bronze_: past the cast bridge, a band of floor that burns in turns;
  - _the roots_: scorpions at the foot of the wall;
  - _the glyphs_: two locks, the eye and the star;
  - _the mirrors_: two mirrors, the high one sending the light on to the door;
  - _the blades_: a twelfth room in the run under the conjunction's light, with two blades swinging in turn.
  - Nora's remarks and the hints follow, in English, Spanish and Catalan; the lightmap is baked again.
- **Music of their own for chambers IV to IX**: 30 new cues, by Scott Buckley and Kevin MacLeod (CC-BY 4.0), credited in `public/audio/CREDITS.md` and the in-game credits.
  - Each chamber has its own intro, two exploration cues and a relic cue. For the Ninth Chamber, the relic cue is the seal.
  - New tension or combat beds where the borrowed ones did not fit: the Archive's combat, the Root Halls' and the Forge's tension and combat, and the Wind Stair's tension (a flute).
  - The Ninth Chamber's exploration returns to one cue from each earlier chamber, in campaign order, between its own two.
  - About 28 MB more music, cached as it is first played and never precached (the service worker's precache is unchanged).
- **Golden replays** (spec §16):
  - Each chamber's golden path is recorded as the bot's input frames in `tests/replays/<level>.replay.json.gz`, with the world's hash every 60 ticks.
  - `tests/golden-replays.test.ts` plays every replay back on a fresh world. A difference names the first stretch of 60 ticks that diverged.
  - `pnpm replay:update` records them again after an intended change. It refuses a walkthrough that changes the world by any means other than input.
- **Reachability check fix**: a running jump no longer passes through a step taller than a grab. The comment promised it, but only the ceiling was checked. The wind room's step showed it, and tests/reach.test.ts now covers it.
- **Fixes from review of 0.8.5 and 0.8.6**:
  - _Continue_ resumes the conjunction timer with the time saved. Before, it gave back the minute meant for falls.
  - Quitting to the title hides the countdown.
  - The credits honour the game's own Reduced motion option, not only the system's.
  - As a still list, the credits scroll by touch, keys and the d-pad. A tap, another key or a button closes them.
  - Chamber IX's statues and seal are culled room by room, like the rest of the set dressing.
- **Tests**: four new cases in tests/ninth-chamber.test.ts, one in tests/reach.test.ts, and the golden replays.

## Version 0.9.0 (2026-10-04): Chamber IX, the Ninth Chamber

The last of the three releases on the way to 0.9.0 (docs/roadmap.md): the campaign is complete, I to IX.

- **The Ninth Chamber** (`levels/ninth_chamber.level.json`, spec §19): eleven rooms, walked back through every chamber in reverse order.
  - _The crack of the ray_: the five middle relics open the way, each through its own chamber's mechanism. The name is written with light (a mirror onto a disc), the bronze segment is cast in its mould, the shell's note is a flute, and the astrolabe's moment is a ring set to its mark. Then the seed parts the roots.
  - _The antechamber of the eight_: the eight keepers in stone with their relics, and the empty pedestal. The promise Elena read, and her 1956 letter.
  - _Eight echo rooms_, VIII to I, each in its chamber's palette and with its mechanism: the dome's ring, the wind's updraught, a bronze bridge, a wall of roots and a tangle, painted slabs and a glyph lock, a mirror, a flooding hall, and sand with a block, a plate, jackals and a floor that gives way.
  - _The conjunction's light_: the timer starts in the hall of mirrors (four minutes, one more at the sand's checkpoint) and stops at the seal, with a checkpoint every two rooms.
  - _The seal_: Action at the ninth segment carves Nora's name (the keeper's ending). The way back up into the open opens as she comes in, and walking out leaves the segment bare (the grandmother's ending).
  - Three secrets, the last of the game, one in each echo room of chambers III, II and I. Two notes; Nora writes the third at the end.
  - Room looks, a baked lightmap, a music palette drawn from every chamber, Nora's remarks and the hints, in English, Spanish and Catalan.
- **Campaign**: chamber IX is playable once the eighth is cleared.
- **Level validator**: a level that ends with a choice needs no relic.
- **Tests**: tests/ninth-chamber.test.ts (9): the bot plays to each ending with every secret and no deaths; the five keys, the updraught, the bronze bridge, the flood and the plate are each needed; and the timer sends her back to its checkpoint with time to finish.

## Version 0.8.6 (2026-10-04): The finale

The second of three releases on the way to 0.9.0.

- **The two endings on the end screen**:
  - The Ninth Chamber's end screen tells the ending reached instead of a relic.
  - _The Ninth Keeper_: the seal drawn whole, with the ninth segment carved.
  - _The Bare Segment_: the seal drawn with the ninth segment still bare.
  - Each ending has its three lines and the note Nora writes at the end. The bare segment carries Elena's signature, "E. V. — 1956", beside Nora's.
- **The credits roll**: a Credits button on the campaign's last end screen. The roll lists the eight keepers and the credits, says thank you, and ends on the ending's signatures. It plays to the title's theme, any key closes it, and with reduced motion it is a still list.
- **The monuments of chamber IX**, as procedural stand-ins until the owner's models arrive:
  - `statue`: one of the eight keepers in stone, holding its chamber's relic in that chamber's light, or the empty ninth pedestal. Its cell is solid.
  - `seal`: the great seal of the nine on a wall. Its ninth segment is an outline that fills with amber light once its lever is used.
  - A lever can name what Action does there (`prompt`): at the seal, "Write your name in the ninth segment".
  - The validator checks the seal's wall and lever and the prompt's text.
- **Campaign**: chamber IX has its entry (intro, notes, endings). It shows as coming until its level arrives in 0.9.0.
- **Texts** in English, Spanish and Catalan:
  - the promise on the empty pedestal;
  - Elena's 1956 letter;
  - both endings, and Nora's two notes;
  - the chamber's intro.
- **Tests**: a new case in tests/campaign.test.ts for the two endings.

## Version 0.8.5 (2026-10-04): The conjunction timer and the endings

The first of three releases on the way to 0.9.0 (docs/roadmap.md), chamber IX. The owner chose two endings, a real but generous timer, Elena's 1956 letter shown, and the names as final.

- **The conjunction timer**: rules start, extend and stop a countdown (`timer.start 90s`, `timer.add 20s`, `timer.stop`).
  - The HUD shows it at the top centre, and it turns to ember with a rising tone and a caption in the last ten seconds.
  - When it runs out Nora falls ("The light of the conjunction faded"). She goes back to the last checkpoint with the time she had there, and never less than a minute.
  - Save migration 007 (schema 8).
- **Endings**: `level.end keeper` or `level.end blank` says which ending was reached. The validator knows the endings, and the campaign's progress remembers each one reached.
- **Tests**: tests/conjunction-timer.test.ts (8) and a new case in tests/progress.test.ts.

## Version 0.8.1 (2026-10-04): Level validator fix

- The level validator now rejects a tangle whose top is above the ceiling of a cell it covers. Up to the ceiling is still allowed, for full-height barriers. Above it, the roots would go through the rock and the cell could never be crossed.

## Version 0.8.0 (2026-10-04): Chamber V, the Root Halls

The last of the three releases on the way to 0.8.0 (docs/roadmap.md): chamber V opens, and the campaign now runs I to VIII in order.

- **The Root Halls** (`levels/root_halls.level.json`, spec §19): ten rooms under the sunken forest.
  1. The rift: the way in, split by a giant root. A torch still burns there, and the first note waits.
  2. The first wall: a safe 5 m wall of roots that teaches climbing.
  3. The gallery of tangles: the torch against the roots for the first time. A mat of roots over a hole in the floor opens only when the torch is held over it (jade idol).
  4. The scorpions' nest: a pack in the dark, and a strip of root floor that gives way.
  5. The pool of roots: a dive under a wall of rock, between drowned roots. Beyond a drowned tunnel lies a chamber under the pool with air in it (gold idol). The water puts the torch out, so there is a brazier on the far bank.
  6. The split hall: half of it sank. A pillar of roots is the only way up the step, and the torch in hand takes it away. A tangle closes the way out above.
  7. The root bridge: a root squeezed against the rock over a chasm of thorns. Nora crosses along its face.
  8. The forest vault: green light through the cracks, two scorpions and the second note. Behind a curtain of roots, a face climbs to a niche (stone idol).
  9. Erreth's trunk: a 16 m climb up the petrified tree. Three layers of roots close below her on a timer, never onto her.
  10. The heart of the tree: the Stone Seed and the last note.
- **Campaign**:
  - Chamber V gets its entry, with the seed figure and a music palette.
  - Players who already reached a later chamber find V open.
  - Three of the owner's texts change now that V sits between IV and VI: the Archive's teaser, the first line of the Forge's intro, and the Forge's last line, which now names the way through.
- **Looks and light**: ten looks in moss green and amber, with filtered daylight and damp, and a baked lightmap. The stone keeps the shared texture: its green comes from the light until the root kit and a mossy stone arrive. A brazier in the scorpions' nest keeps it readable.
- **Reference shots**: `pnpm shots` no longer stands Nora on a deadly floor, which killed her in the bridge's chasm and spoiled the shots after it.
- **Tangles** can start sealed or parted (`hold`), so rules can hold them until the right moment.
- **Tests**:
  - tests/root-halls.test.ts: the bot plays the whole chamber with every secret and no deaths, and four checks that each puzzle is needed and has no dead end.
  - New bot helpers for climbing.
- **Found and fixed while building it**:
  - The exits of rooms with a raised floor were at the lower height.
  - The root bridge had no way off at the far end.
  - The gold idol first sat under water, where nothing can be picked up.
  - The pool named a reverb preset the audio does not have, which broke the page (caught by `pnpm smoke`). The level schema now accepts only the presets the audio has.

## Version 0.7.6 (2026-10-04): Tangles, scorpions and root floors

The second of three releases on the way to 0.8.0 (docs/roadmap.md).

- **Tangles of roots** (`src/sim/mechanisms/tangles.ts`, entity `tangle`: cells, a top in clicks, grown or not at the start).
  - Grown, a tangle fills its cells up to its top. It is solid, and climbable on every side.
  - A lit torch in Nora's hand within 2.2 m makes it shrink back in 0.8 s. That opens the way and takes its handholds away: if she is climbing it, she falls.
  - With the torch out or away it waits 2.5 s, then grows back over 6 s. It never grows back onto Nora or onto a living enemy.
  - Rules: `<id>.seal` makes it grow whatever the torch, `<id>.part` keeps it open, and `<id>.free` hands it back to the torch. It emits the signal `<id>.open`.
  - A tangle can also fill a hole in the floor: held over it, the torch opens it.
- **Scorpions**: a new enemy type, `scorpion`. They are small, quick and hunt in packs. Their sting does little damage but poisons, like the darts. A pistol hit or two kills one.
- **Root floors and thorns**:
  - A crumbling floor with the `wood` material is a mat of woven roots that creaks under her, instead of the stone cracking.
  - A deadly pit floored with `wood` grows thorns instead of spikes.
- **Seeing and hearing it**:
  - tangles grow from the rock around them and shrink back into it, or rise from the floor when they stand free;
  - a stand-in scorpion model with legs, pincers and a stinging tail;
  - root creaks, a scorpion's chitter and sting;
  - captions in English, Spanish and Catalan.
- **Saves**: migration 006 adds the tangles to older saves (schema 7).
- **Level tools**: the reachability check counts tangles as both open and grown. The validator rejects a tangle that grows into rock or never rises above the floor.
- **Tests**: tests/tangles.test.ts (12) and tests/scorpions.test.ts (5).

## Version 0.7.5 (2026-10-04): Wall climbing

The first of three releases on the way to 0.8.0 (docs/roadmap.md), chamber V, the Root Halls.

- **Climbing walls** (spec §5 "Escalar paredes"). The sector flag `climb<D>` marks the face of that sector that looks towards D as climbable.
  - Nora gets on a face with Action, catches one from a jump, or steps onto one from the ledge above it by pulling back while hanging.
  - On the face she climbs up, down and sideways, as long as the face goes on.
  - At the top she hangs from the edge and climbs up as from any ledge. At the bottom she steps off onto the floor.
  - A jump takes her back off the face and turns her round. Action lets go.
  - The torch goes on her belt while she climbs. Birds and tearing gusts knock her off, as from a ledge.
- **Seeing it**: pale roots on every climbable face, a climbing pose built from the hanging one, the grab sound and a "Climb" prompt. Both are stand-ins until the root kit and the Mixamo climbing clips arrive (docs/art/models-brief.md).
- **Reachability**: the level validator climbs a face to its top, however tall, and along it while it goes on.
- **Tests**: tests/wall-climb.test.ts (14 movement tests) and two new cases in tests/reach.test.ts.

## Version 0.7.1 (2026-10-04): Observatory fix

- Anzur's phase-2 slams no longer break the floor under the oculus while it is still dark. Before, he could destroy the pool before the three rings lit it, and so take away the only way to stop him.

## Version 0.7.0 (2026-10-03): Chamber VIII, the Observatory

The last of the three releases on the way to 0.7.0 (docs/roadmap.md): chamber VIII opens.

- **The Observatory** (`levels/observatory.level.json`, spec §19): ten rooms at the summit, at night.
  1. The outer terrace: wind off the summit, jackals, the first note. A ledge on the dome's outer face is reached on an updraught.
  2. The gallery of instruments: three glyph locks spell the keeper's name (the eye, the star, the mountain).
  3. The first ring teaches turning. One position off its start, a constellation on the wrong star opens a niche.
  4. The hall of moons: a block onto the new moon.
  5. The hall of the horizon: the last ray of a solstice sunset through a slit, and a mirror to turn it onto the sun disc.
  6. The dome stairs: a jackal and three tiers to climb.
  7. Under the dome: the view up into it, and the second note.
  8. The battle and the alignment: Anzur rises.
     - Levers on the raised rim, out of his reach, turn the three rings. The first two set cost him a phase each.
     - In phase 2 his slams break the floor, and his empty seat opens.
     - All three set let the oculus light fall, and only that light stops him. The dais beyond the light can only be reached through it on foot; Nora drops onto it from the ledge behind.
  9. The oculus: up to the opening, under the whole night sky.
  10. The chamber of the astrolabe: the relic and the last note.

  It also has:
  - three secrets: on the dome's outer ledge, in the niche of the wrong star, and in Anzur's empty seat during phase 2;
  - three journal notes (the one who watches, three things, the ninth is not a tomb);
  - Nora's ideas for five puzzles;
  - ten night looks with the starfield, and a baked lightmap;
  - a music palette drawn from the Temple's majestic cues;
  - the campaign entry, and the end screen's figure: three rings turned to the ninth place.

- **Campaign order**: the Wind Stair now leads to the Observatory, and the Observatory to the ninth chamber.
- **Models**: Anzur, a dome ring, the oculus and the astrolabe are listed in docs/art/models-brief.md.
- **Verification**:
  - `tests/observatory.test.ts`: the bot plays the whole chamber, the boss fight included, with all three secrets and no deaths.
  - Eight "every puzzle is needed" checks.
  - `pnpm smoke` passes on the new level.
  - Reference shots on the high and mobile tiers. They led to brighter night looks.

## Version 0.6.6 (2026-10-03): Anzur

The second of three releases on the way to 0.7.0, chamber VIII, the Observatory (docs/roadmap.md).

- **Anzur, the giant** (guardian kind `giant`, spec §19): the largest of the eight keepers, built on the guardian's code. It stands nearly twice their height, slower, with its own tuning.
  - Rules advance its three phases (`<id>.advance`): the level ties them to the dome's rings. It reels at each change, then comes on harder. It emits `<id>.phase2` and `<id>.phase3`.
  - **Phase 1**: a wide sweep, more than 4 m round it.
  - **Phase 2**: its slams break the floor a stride ahead of it. Those cells crack and fall after the usual warning, leaving pits. Only floor at its own level breaks (a ledge above it holds), and never under itself or in the oculus light. It strides over the holes it opens.
  - **Phase 3**: only the oculus light falling on it stops it (`guardian.lit`, then defeated).
  - It never falls into a pit, and a fall onto its back does nothing.
- **Look and sound**: the guardian's figure scaled up, in night-grey stone with a pale gaze and core. Its wind-up ring and shockwave span the wider sweep. A phase change shakes the hall, and the moonlight freezing it rings out, with subtitles.
- **Verification**: `tests/anzur.test.ts`: waking and the sweep, the phases and their cap, a whole floor in phase 1, broken floor in phase 2 but never in the light or on a ledge above it, striding over its own holes, no falls, defeat only in phase 3 and only in the light, and the shrugged blow from above.

## Version 0.6.5 (2026-10-03): Rings, the oculus and the night sky

The first of three releases on the way to 0.7.0, chamber VIII, the Observatory (docs/roadmap.md).

- **Dome rings** (`src/sim/mechanisms/rings.ts`, spec §19): a ring carries the sky's stars, the moon's phases or the horizon's sun.
  - It has nine positions, and rules turn it one position on (`<id>.turn`) or back (`<id>.back`); the rim levers are ordinary spring levers.
  - It is aligned at its target, which is the ninth place, where the seal lacks its segment. It emits `<id>.set` and `<id>.at<N>` for its position, so a wrong position can open something too.
- **The oculus**: a pool of light on the floor under the dome, switched by rules (`<id>.on`, `off`, `toggle`). It emits `<id>.on`, and the simulation can ask whether a cell lies in its light.
- **Look and sound**: stand-ins for the three bronze rings, which turn smoothly to their positions, and a gold notch at the ninth place. The oculus has a moonlight shaft, a pool and a light. Night looks (`"stars": true`) draw a starfield beyond the openings, with the Amber Heart's eight stars as a constellation near the zenith. The rings grind and chime when one settles, and the oculus opens with a rumble and a chime, with subtitles.
- **Level tools**: validation of each ring's start and target, and of the oculus's room and floor.
- **Saves**: schema 6 (a migration adds the ring and oculus lists).
- **Verification**: `tests/rings.test.ts`: turning and wrapping, alignment and position signals, the turn event, the oculus opening once all three are aligned, a wrong-position rule, validation and the save migration.

## Version 0.6.0 (2026-10-03): Chamber VII, the Wind Stair

The last of the three releases on the way to 0.6.0 (docs/roadmap.md): chamber VII opens.

- **The Wind Stair** (`levels/wind_stair.level.json`, spec §19): ten rooms up a shaft through the whole mountain, from the forge to the summit, sixty metres of climbing.
  1. The shaft's foot, with the first note and a pack of flares. The first gust is an updraught that lifts a jump to the ledge above, and there is nothing to fall to.
  2. The first flute's ledges: a following gust carries a running jump over the cut. The cut is deep but not deadly, and steps lead back out.
  3. The counterweights: two platforms rise and fall in turn, up to the next ledge.
  4. The flute levers: a steady head gust stops the jump across a deadly cut. One lever closes its flute, another opens the flute that blows behind Nora.
  5. The nest: rock birds dive at Nora while she climbs the ledges.
  6. The hanging traverse: a ledge along the wall over the chasm, too low to climb onto. Tearing gusts pull at her while she hangs, with a sheltered spot in the middle.
  7. The rope: pulling it calls a counterweight down, and it rises again with Nora on it.
  8. The great flute: the whole shaft in view and the loudest song. Updraughts carry her up three tiers, with the camera looking up the shaft.
  9. The storm: gusts come thick and fast. She jumps a cut on a following gust, then climbs up into the open.
  10. The summit: the Wind Shell, the last note, and for the first time the open sky.

  It also has:
  - three secrets: a niche only a gust from the west reaches, a niche behind a flute that opens when that flute is closed, and a bird's nest with an idol at the top of the great flute;
  - three journal notes (the mountain breathes, Suhal, the note);
  - Nora's ideas for nine puzzles;
  - ten room looks, from cold blue-grey stone at the foot to warm light at the summit, and a baked lightmap;
  - a music palette drawn from the Cisterns' open, echoing cues until it has its own;
  - the campaign entry, and the end screen's figure: eight notes around the shell's lip.

- **Campaign order**: the Forge now leads to the Wind Stair.
- **Bot moves** for the walkthrough tests: hanging from a ledge, shimmying, climbing up from a hang, pulling a rope, and fighting a single enemy by its id.
- **Models**: the bird, the flute mouth, the rope, the counterweight and the shell are listed in docs/art/models-brief.md. Until they arrive, the game draws stand-ins.
- **Verification**:
  - `tests/wind-stair.test.ts`: the bot plays the whole chamber with all three secrets and no deaths.
  - Eleven "every puzzle is needed" checks.
  - `pnpm smoke` passes on the new level.
  - Reference shots on the high and mobile tiers.

## Version 0.5.6 (2026-10-03): Ropes, rock birds and the shaft's camera

The second of three releases on the way to 0.6.0, chamber VII, the Wind Stair (docs/roadmap.md).

- **Hanging ropes** (spec §8, "Cuerda para tirar"): a rope hangs from the ceiling over a cell. Nora jumps into it with Action held (or with auto-grab after a jump), pulls it halfway through the hang, and lets go. It works like a lever (`<id>.pulled`), and a spring rope rises again to be pulled once more. Action lets go early. A prompt points it out.
- **Rock birds** (enemy type `bird`, the new `flyer` behaviour, spec §19): they perch on their nest until they see Nora, then screech as they rise and dive at her chest.
  - Instead of biting, they shove her: a little damage and a push along the dive. The push can knock her off a ledge or a rope.
  - After a shove they climb away and dive again.
  - Two pistol hits bring one down, and it tumbles to the floor.
  - Flight is free in three dimensions and keeps clear of walls, floors and ceilings.
- **The shaft's camera**: a room can set a preferred pitch, looking up or down the shaft (and the player may then look further up than usual), a distance, and a fixed shot the camera eases into and out of while still watching her. The validator checks that each shot stands in open air in its room.
- **Look and sound**: stand-ins for the rope (a braided cord with a knot, which drops a little when pulled) and the birds (folded on the nest, quick wingbeats on the dive, a glide while climbing away). Screeches, wingbeats and the shove, with subtitles.
- **Verification**: `tests/rope.test.ts`, `tests/birds.test.ts` and `tests/camera-framing.test.ts`. They cover grabbing, the pull, reach, spring ropes and letting go early; the birds' sight, shove, return, a ledge knock-off, death, staying in the room and going home; and pitch, look-up, distance, the fixed shot and parsing.

## Version 0.5.5 (2026-10-03): Wind

The first of three releases on the way to 0.6.0, chamber VII, the Wind Stair (docs/roadmap.md).

- **Wind zones** (`src/sim/mechanisms/wind.ts`, spec §19): a rectangle of cells where the wind blows one way (north, east, south, west or up), on a fixed cycle with a warning, or steadily.
  - A horizontal gust carries Nora at 3 m/s in the air. That lengthens a running jump by about a block, and a head gust shortens it by as much.
  - On the ground it pushes at a third of that speed. She can always walk against it, and it never pushes her off an edge.
  - An updraught takes half of gravity away: she jumps higher and falls slower, but the height fallen still hurts.
  - A zone may `tear`: hanging Nora is torn off the ledge once a gust has blown on her for 0.6 s, so she waits for the lull.
  - Rules turn zones `on`, `off` or `toggle` them (the flute levers), and each zone emits `<id>.gust`.
- **Look and sound**: dust streaks and leaves blown along each zone while it gusts, and a faint stir while the flutes warn. Synthesised stone flutes rise towards their note before each gust and sing while it blows, higher up the shaft. Subtitles for the flutes, the gust and being torn off a ledge.
- **Level tools**: the reachability check counts the longer jumps in wind and the higher reach in updraughts. The validator checks each zone's room, cycle and strength.
- **Saves**: schema 5 (a migration adds the wind list).
- **Verification**: `tests/wind.test.ts`.
  - With a following gust, a running jump clears 3 blocks; without one it does not, and a head gust stops it clearing 2.
  - An updraught reaches a 4.5 m ledge.
  - The ground push stops at the edge.
  - Tearing gusts tear her off, and lulls and short gusts do not.
  - The gust cycle, the rule actions, replays and the save migration.

## Version 0.5.1 (2026-10-03): Ask Nora

- **Pause → Ask Nora** showed at all times and did nothing when she had no idea yet. The menu items' `display: block` overrode the `hidden` attribute. Now a global rule makes `hidden` always hide. That also fixes "Another idea", which showed after the third hint.
- **Browser smoke test**: the pause menu of a fresh chamber must not offer to ask Nora. Without the fix it fails.

## Version 0.5.0 (2026-10-03): Chamber VI, the Bronze Forge

The last of the three releases on the way to 0.5.0 (docs/roadmap.md): chamber VI opens.

- **The Bronze Forge** (`levels/bronze_forge.level.json`, spec §19): ten rooms deep under the mountain, where the builders cast the seals of the nine chambers.
  1. The gallery of cold moulds, with the first note and a pack of flares.
  2. The first pour: safe, nothing to fall to. A lever tips a crucible, and the bronze cools into a bridge over the cut.
  3. The bellows: pushed onto the plate before the cold forge, they wake it, and its heat opens the door. A second cold forge lights only with a flare.
  4. The main channel: three sluices over two bottomless cuts. Two pour the way across, and the third pours a bridge to a hidden ledge.
  5. The automaton workshop: taking the founder's key wakes the automaton in its alcove.
  6. The quench pit: up on the ledge, out of its reach, the sluice floods the room and quenches it.
  7. The furnaces: open heat, fire jets across the room, and shade under the hoods to wait in.
  8. The bronze bridge: a crucible pours across the chasm every twelve seconds. Cross while the bridge is dark.
  9. The casting hall: Bazûr. From the ledge, pour the gutter onto it while it pounds the wall below, twice. In its second phase the side crucibles pour on their own.
  10. The mould of the seal: the founder's key opens the crucible, and Nora casts the Ninth Segment herself.

  It also has:
  - three secrets: in the mould behind the flare-lit forge, on the ledge only the third bridge reaches, and at the top of the old vent above the furnaces;
  - three journal notes (the nine seals, the one who still works, the ninth that was never cast);
  - Nora's ideas for eight puzzles;
  - ten room looks in black and bronze, and a baked lightmap;
  - a music palette drawn from the Temple of the Sun's weightier cues until it has its own;
  - the campaign entry, and the end screen's figure: the seal's ring with the ninth segment cast.

- **Campaign order**: the chambers keep their story order, but the next chamber is now the next one that can be played. The Clay Archive leads to the Forge until the Root Halls (V) are built. The Archive's closing line now points below, to the forge.
- **Engine, for the Forge**: rules can wake an enemy with `<enemy>.alert` (the automaton, when the key is taken).
- **Verification**:
  - `tests/bronze-forge.test.ts`: the bot plays the whole chamber with all three secrets and no deaths.
  - "Every puzzle is needed" tests: the cut before the pour, the bellows door, the quench door, the casting hall door and the mould gate.
  - The level validator's reachability check, the smoke test, and reference shots per room on the high and mobile tiers.
- **Models**: docs/art/models-brief.md lists the Forge's models for the owner (Bazûr, the automaton, the crucible, the bellows, the forge, the mould and the segment). Until they arrive, the stand-ins built in code are used.

## Version 0.4.6 (2026-10-03): Automatons and Bazûr

The second of the three releases on the way to 0.5.0 (docs/roadmap.md): the Bronze Forge's foes (spec §19). Like 0.4.5, no chamber uses them yet.

- **Bronze automatons** (enemy type `automaton`):
  - Slow and heavy, with a mallet blow that hurts.
  - Plated: only a twentieth of each hit gets through, so pistols need about thirty seconds of steady fire.
  - Ended for good by quench water (a metre or more over its floor) or by molten bronze poured over it.
  - Rules can wake one with `<enemy>.alert`: in the Forge, taking the founder's key wakes the automaton in its alcove.
  - A procedural view (`src/render/automaton.ts`): cast plates, a furnace glow behind the slits of its face and chest, and a stiff walk. Quenched, its glow dies and it keels over; melted, it sinks into the bronze.
  - Sounds and subtitles: clanking into motion, bullets ringing off its plates, steam, the melt.
- **Bazûr** (the guardian's `bronze` kind):
  - Molten bronze poured over it costs it a phase. The same pour counts once: it must stand clear of hot bronze for a second before another pour can.
  - A blow from above to its core still works, and two blows defeat it. The signal `<id>.burned` lets rules react.
  - Drawn as darkened cast bronze instead of carved stone, until the owner's model.
- **Saves**: schema 4. Guardians saved before are stone.

## Version 0.4.5 (2026-10-03): Bronze

The first of the three releases on the way to 0.5.0 (docs/roadmap.md): the mechanisms of chamber VI, the Bronze Forge (spec §19). No chamber uses them yet; the Forge itself arrives in 0.5.0.

- **Pours** (`src/sim/mechanisms/bronze.ts`, the `pour` entity):
  - Molten bronze runs from a crucible along a trench, one cell after another (2.5 cells a second).
  - It kills whatever stands in it while it glows, and four seconds after the trench is full it cools into solid bronze at the trench's lip: a bridge.
  - `<id>.pour` runs it. Which trench gets the bronze is decided by rules, so a sluice is a lever.
  - A repeating pour (`period`) rumbles, runs again, and covers its own bridge with fresh bronze: cross it while it is dark.
  - Signals `<id>.molten`, `<id>.solid` and `<id>.cast`.
- **Heat zones** (the `heat` entity):
  - They drain three points of health a second in the open, so a full bar lasts about half a minute.
  - Sectors flagged `shade` (along the walls) and water are safe, and `<id>.off` puts a furnace out.
  - The edges of the screen breathe orange while she burns.
- **Bellows and forges**: a block with `"look": "bellows"` is drawn as bellows. Pushed onto a plate, a rule (`<brazier>.light`, new) wakes a cold forge, and a lit forge opens its doors by rule.
- **Render** (`src/render/forge.ts`):
  - The bronze rises along the trench, glowing orange under a cracked skin, and darkens as it cools.
  - The crucible, tipped over the trench's first cell, pours a stream while it runs.
  - The bellows have boards, leather pleats and a bronze nozzle. They are stand-ins, like the rest, until the owner's models.
- **Sound and subtitles**: the crucible's rumble (with a trap arrow), the pour, the hiss of cooling bronze, and the furnaces' roar.
- **Saves**: schema 3. Saves from 0.4 load with no pours and no heat.
- **Level validator**: the reachability check counts the bridge a pour cools into.

## Version 0.4.0 (2026-10-03): Publication

The last of the three releases on the way to 0.4.0 (docs/roadmap.md). It closes Phase 3 of the spec (§2, "Beta y publicación") on everything that can be measured from here.

- **The title answers before the tomb has loaded.** "Enter the tomb" and "Continue" work from the moment the game's script runs. Pressed early, they take the gesture (sound, fullscreen on phones), say "Opening the tomb…", and the game starts by itself once the first room is ready. Until then the other choices (Chambers, Options, Credits) stay hidden, because they arrive with the rest of the game.
- **`pnpm loadtime`** (`scripts/perf/loadtime.ts`) serves the build the way GitHub Pages does (gzip for text) and opens it with an empty cache on an emulated 4G link (9 Mbps, 150 ms). On this container, headless Chromium with software WebGL:
  - first paint (the splash and the story): 0.45 s;
  - title usable: 1.7 s, after 0.7 MB (the budget is 4 s; CI fails above it);
  - tomb ready: about 24 s, after 17 MB. About 16 s of that is the download; the rest is shader compilation on the CPU, which a real GPU does much faster. On a first visit the story prelude plays over that time.
- **`pnpm offline`** (`scripts/browser/offline.ts`): loads the game, waits for the service worker to take control, cuts the network, reloads, and reaches the title and the first room with no errors. CI runs it.
- **Update notice** (`src/ui/service-worker.ts`): when a new version has installed behind a running game, a quiet notice offers it on the title and in the pause menu, never over play. Updating saves the game, lets the new version take over and reloads into it. The worker still never takes over by itself.

**Phase 3 gate** (spec §2):

| Item                               | State                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Accessibility (§13)                | Done in 0.3.5. Not done: tutorial hints that can be turned off, and movable touch buttons (size and opacity are in).     |
| Spanish, English and Catalan       | Done in 0.3.6.                                                                                                           |
| Installable PWA that plays offline | Done (manifest, service worker, `pnpm offline`).                                                                         |
| Published from the repo            | GitHub Pages, deployed from `main` on every merge (the hosting choice is in docs/roadmap.md).                            |
| No known softlocks                 | The validator's reachability check and the block audit (0.3.6), plus "Restart from checkpoint". None known.              |
| Initial load under 4 s on 4G       | The title answers at 1.7 s (`pnpm loadtime`, in CI).                                                                     |
| Animation and lighting polish      | Ongoing with the owner's models (docs/art/models-brief.md).                                                              |
| Playtests with five people (§16)   | The owner's, with the questions and the playtest log in docs/roadmap.md.                                                 |
| Name search (§18)                  | The owner's: EUIPO and USPTO. A web search on 2026-10-03 found no game with this name; the closest is "The 9th Charnel". |

## Version 0.3.6 (2026-10-03): Catalan and softlocks

The second of the three releases on the way to 0.4.0 (docs/roadmap.md).

- **Catalan** (`i18n/ca.json`): every string in the game, the journal included, in central Catalan. It is offered in Options → Language and picked automatically for browsers set to Catalan. The page's built-in texts (the splash, the story prelude, the loading line) come in all three languages.
- **Reachability in the level validator** (`src/sim/grid/reach.ts`, spec §16): a graph of every cell the controller could possibly reach from the start. It counts steps, grabs up to the highest a jump reaches (3.7 m), drops, running jumps over gaps of up to two cells, swimming at the highest water level, doors as open, moving platforms at every height on their path, and a pushable block in any cell of its room.
  - `pnpm validate:levels` now fails when a relic, secret, note, checkpoint zone or exit zone lies outside that graph, or when a checkpoint zone covers a deadly sector, a dart slab or a boulder's path.
  - Unreachable levers, medkits, items and torches are warnings.
  - All four chambers pass, and `tests/reach.test.ts` checks each rule: a sealed room fails, a 3.5 m climb passes and a 4 m one does not, a block turns an impossible climb into a step, and a flooded pit can be swum.
- **Softlock audit**: every pushable block in the four chambers (nine blocks, the Clay Archive's shelves included) was pushed and pulled through every position the real simulation allows. Only one position is a dead end: the causeway block once it drops into its notch in the Antechamber, which is the puzzle's solution. The two blocks of the scales puzzle keep their reset lever. "Restart from checkpoint" stays the escape from anything else.
- **WebGL warnings fixed on the medium and high tiers**: the fire lights' cube shadow maps, and the sun's map in rooms where it starts dark, were first drawn in a frame whose materials had already sampled them ("bindTexture: attempt to use a deleted object", "texture format and sampler type mismatch"). Each is now drawn once at the start. All four chambers are clean on the mobile, medium and high tiers, and CI runs the smoke test on medium as well as mobile.
- **Title screen layout**: the footer is part of the page flow, so the keys help no longer overlaps the copyright line. That overlap showed in Spanish at 1280×720 and in Catalan at smaller sizes. Short desktop windows get a smaller seal and title.

## Version 0.3.5 (2026-10-03): Accessibility

The first of the three releases on the way to 0.4.0 (docs/roadmap.md), Phase 3 of the spec: what spec §13 asks of accessibility.

- **Subtitles** (`src/ui/captions.ts`, `src/ui/caption-view.ts`): every sound that tells the player something gets a caption, with the side it comes from relative to the camera ("[Click in the wall, right]").
  - Covered: traps, doors, blocks, water, moving stone, the guardian, jackals and Tamrit, and the torch and flares going out.
  - Small, medium or large; sounds out of earshot are not captioned, and a repeating sound (a swinging blade, a ticking door) does not flood the screen.
  - The option has existed since 0.2.0 and did nothing until now.
- **Trap warnings**: when a trap arms (darts, a cracking floor, a boulder, a fire jet, a closing trapdoor, the guardian rearing up), an arrow at the edge of the screen points at it. On by default.
- **Hold or toggle** for Action and Walk (`InputFramer.setToggles`): in toggle mode one press latches the button and the next lets go. The touch Walk button was already a toggle and stays one.
- **Game speed 75 %**: play runs on a slower clock. Ticks are unchanged, so times, ranks and records are not affected (spec §13).
- **High contrast** (`src/sim/grid/edges.ts`, `src/render/grab-edges.ts`): a bright strip along every lip Nora can grab, computed with the same rules as the controller's grab and checked against it in `tests/accessibility.test.ts`.
- **Poison on the health bar**: the bar stays up and turns green while poison drains it. Before, poison showed nowhere.
- **Colour-blind safe bars**: health in blue, low health in white, poison in orange with stripes.
- **Touch buttons**: size (80 to 140 %) and opacity (30 to 100 %), positions scaled with the size so the buttons never overlap.

Known: on the medium and high tiers, Chromium still logs "bindTexture: attempt to use a deleted object" (present before this release; the mobile tier was fixed in 0.3.0). It is on the list for 0.3.6.

## Version 0.3.0 (2026-10-03): Chamber IV, the Clay Archive

The third and last release on the way to 0.3.0 (docs/roadmap.md): the second half of the campaign opens.

- **The Clay Archive** (`levels/clay_archive.level.json`, spec §19): ten rooms under the Temple of the Sun.
  1. The shaft down from the temple.
  2. The reading room, with its first glyph lock.
  3. The stacks, with shelves that push and pull like blocks.
  4. The dark gallery, with darts.
  5. The kiln, with a plate and two cylinders.
  6. The sunlit scriptorium.
  7. The index.
  8. The canal, with the sluice.
  9. Tamrit's hall.
  10. The Hall of the Name, with three cylinders and the Tablet of the Name.

  It also has:
  - three secrets (behind a shelf, on a ledge above the scriptorium, and in a niche that floods);
  - three journal notes whose words are the locks' sequences, which chain the first three relics into the last lock;
  - ten room looks and a baked lightmap;
  - Nora's ideas for seven puzzles;
  - the campaign entry and the end screen's sign figure.

- **Glyph locks** (`src/sim/mechanisms/archive.ts`):
  - Each is a six-faced stone cylinder that turns one face per Action, from the side it is read from.
  - The glyphs have their own shapes and colours (sun, water, reed, eye, star, mountain), so they read on a phone and with colour blindness.
- **Dart traps:**
  - A painted slab clicks, and a moment later a volley crosses the corridor: running over it is safe, lingering is not.
  - Darts poison mildly; the poison drains health down to a floor and a medkit cures it.
- **Tamrit, the clay scribe:**
  - A new enemy type, slow and relentless. Shot to pieces, it slumps into a heap and rises again.
  - Only water a metre deep dissolves it: the lever on the ledge floods its hall from the canal's sluice.
- **Stand-ins until the owner's models** (`docs/art/models-brief.md`): Tamrit's body, the cylinders, the dart niches, shelves of tablets, rows of tablets along the walls (one instanced mesh) and the Tablet of the Name, all built in code.
- **Music:** the Archive uses the quietest cues of the first three chambers until it has its own tracks.
- **Saves:** schema 2 (migration 001) adds the new mechanisms and poison; 0.2.6 saves load.
- **Tooling:**
  - `pnpm smoke` loads every built level in headless Chromium, visits each room and fails on any console error. CI runs it.
  - `pnpm shots` captures each room at each tier (into `shots/`, not committed).
- **The old WebGL warnings are fixed.** The smoke test reproduced them in the Cisterns on the mobile tier: "bindTexture: attempt to use a deleted object" and "texture format / sampler mismatch". The static sun shadow map was never drawn while the sun was dark, so materials sampled a shadow texture that did not exist yet. It is now drawn once at the start.
- **Release gate:**
  - All four chambers are played end to end by the bot with every secret and no deaths, and the tests prove that each lock, the plate and the flood are needed.
  - Still to check on the owner's iPhone: a save that survives a reload, and 30 fps or more (Options → Graphics → performance readout).

## Version 0.2.6 (2026-10-03): saving, inventory, remapping and Nora's ideas

The second of the three releases on the way to 0.3.0 (docs/roadmap.md), closing the Phase 2 systems of spec §9.

- **Saving** (`src/sim/save`, `src/ui/save-store.ts`): one automatic save in IndexedDB.
  - It is written at every checkpoint, when the page goes to the background or is closed, and when quitting to the title. It resumes from where Nora stands when that is safe (standing, nothing chasing her, no mechanism in use), otherwise from the last checkpoint, which deaths still go back to.
  - **Continue** on the title resumes it. A save of another chamber loads that chamber and goes straight into play. After a chamber is finished, Continue starts the next one.
  - Saves carry a schema number, with numbered migrations in `src/sim/save/migrations`. A save whose chamber has changed too much (its actors no longer match) is dropped rather than loaded wrong.
- **Inventory** (Pause → Inventory, `src/ui/inventory.ts`):
  - medkits and flares with counts, the torch and puzzle items;
  - the relics of the chambers already finished;
  - the idols found in this chamber.

  Each has a name and a description in i18n.

- **Control remapping** (Options → Keyboard and Gamepad, `src/core/bindings.ts`):
  - Every game action can be bound to another key or button. A control another action uses swaps with it, and a row restores the defaults.
  - Movement, Escape and Start stay fixed.
  - The Action prompt and the note reader show the bound control.
  - The flare, which had no gamepad button (the d-pad's up is the torch), gets the d-pad's left.
- **Nora's ideas** (spec §15, offline mode; `src/sim/hints`, `levels/<id>.hints.json`):
  - Three graded hints per puzzle (observation, direction, solution) for 16 puzzles across the three chambers. Each is in Nora's voice, at most 25 words, in English and Spanish, written for review by the owner.
  - After three minutes in a room without progress, "Nora has an idea" appears; **Ask Nora** in the pause menu gives one level at a time.
  - `pnpm validate:levels` checks the hint files: rooms, signals and i18n keys.
  - The playtest log counts the ideas asked for per room.

## Version 0.2.5 (2026-10-03): playtest tools and fixes

The first of the three releases on the way to 0.3.0 (docs/roadmap.md).

- **Playtest log** (`src/ui/playtest.ts`, Options → Playtest): each session is kept on the device (nothing is sent anywhere) with the device, renderer and quality tier, average and worst frame rate, time, deaths and hints per room, the room the player stopped in, whether the chamber was finished, and the script errors and renderer warnings seen. **Export playtest log** hands the file to the share sheet on phones or downloads it elsewhere; **Delete playtest log** asks for a second press.
- **Fire light stops at walls** (`src/render/light-mask.ts`): the fire pool's plain lights cast no shadows, so a brazier next to a wall lit the room behind it. Each brazier now gets a top-down mask of the grid around it, worked out once per level with 2D rays (half-metre texels, five points across the flame for soft edges). The light is multiplied by it at every lit point. Light still spills through doorways, but stops at walls.
- **Dark scenes:**
  - The Temple's boulder run is brighter (ambient, bake and exposure), and a new look field, `fill`, triples the soft light that follows Nora there, so she and the steps read during the chase.
  - Under water the fill grows threefold everywhere, and the drowned tunnels' water fog is lighter, so they are not swum blind.
  - The fill sits closer to her centre, so a two-metre corridor no longer shows a hot spot on the wall.
- **KTX2 textures** (`scripts/textures/ktx2.ts`, `pnpm textures:ktx2`):
  - Level surfaces, prop models and Nora are compressed with Basis Universal and stay compressed on the GPU (ASTC, BC or ETC2):
    - colour maps: sRGB ETC1S;
    - normal maps: ETC1S in normal-map mode (Nora's in UASTC);
    - data maps: linear ETC1S.
  - On the mobile tier in the Cisterns, GPU memory goes from about 412 MB to 82 MB, well inside the 400 MB budget.
  - The download shrinks too: models from 15 to 11 MB, surface textures from 8.5 to 3.1 MB.
  - The scans move to `art/textures`, with their albedo softening baked into the KTX2 files, and the transcoder is precached for offline play.
  - The crumbling tiles multiply a crack mask over the floor, since a compressed texture cannot be painted on.
- **WebGL warnings:** the "bindTexture: attempt to use a deleted object" and "texture format / sampler mismatch" warnings did not appear in automated WebGL 2 walks of all three chambers, covering:
  - tier, resolution, filtering and window size changes;
  - quitting, restarting and dying.

  The browser's own WebGL warnings never reach the page, so if a tester sees them, a note of what they were doing is the way to find them. Script errors and three.js warnings now go into the playtest log.

- **TypeScript 7:** 7.0.2 is out, but typescript-eslint supports TypeScript only below 6.1, so the project stays on 5.9 for now.
- **Not in this release:** the holsters on the hips need a new `nora.glb` from the owner. What each model needs is in `docs/art/models-brief.md`, along with the models for Chamber IV.

## 0.2.4 follow-up (2026-09-27): computers no longer end up on the mobile tier

The owner's PC was on the mobile tier without anyone choosing it. The first-run benchmark could drop two tiers at once from a slow start (shaders still compiling), and dynamic resolution at its floor lowered the tier again; both were saved for good.

- **The benchmark drops one tier at most** and measures only after a 2 s warm-up of real frames (stalls over 0.25 s never count as warm-up, and a throttled tab still gives up).
- **Computers stop at medium**: neither the benchmark nor dynamic resolution takes a desktop below medium by itself (`autoFloor` in `src/render/quality.ts`). Phones and touch-only screens can still go to mobile, and anyone can pick mobile in Options.
- **Settings layout 3**: a computer that an older build lowered to mobile automatically is measured again on the next start. A tier chosen by hand is kept.

## 0.2.4 follow-up (2026-09-27): no request for a missing jackal model

- The renderer asked for `models/jackal.glb`, which was never added, and the console showed a 404 on every start. Nothing loads it now; the jackals were already built in code as the fallback. Version unchanged: the title shows the new commit.

## Version 0.2.4 (2026-09-27): no white flash between chambers, and a secret in the seal

- **Moving to another chamber** loads the page again, and for a moment the browser showed a blank white page before the stylesheet arrived. The page is now dark from its first byte (an inline style in `index.html`), and browsers that support cross-document view transitions crossfade from one chamber to the next.
- **The title seal hides an easter egg** (`src/ui/seal-egg.ts`): each tap (or Enter) lights the next carved segment with a rising pentatonic note and turns the ring a little; the ninth tap fills the missing segment, the ring opens and glows with the relic's shimmer and the secret chord, and a line appears under it. It closes by itself after a few seconds, and taps far apart start over.

## Version 0.2.3 (2026-09-27): wading and walking into the water

- The simulation only reported falls into water, so walking in or out by the steps and wading through the shallows showed and sounded nothing. The water effects now read Nora's feet against the live surface (`src/render/water-fx.ts`): stepping in or out splashes a little, every stride leaves a soft ring behind her and kicks droplets ahead, and standing in the water makes a faint ring now and then.
- Wading footsteps use the water step sound, and leave no sand prints under the water (`src/main.ts`).
- Splash rings are softer.

## Version 0.2.2 (2026-09-27): water in the Cisterns

The owner, on an iPhone: the water texture in the Cisterns was bad, and the light the water throws on the walls was switched off. Captures at 0.2.1 showed why: a flat, dark teal slab with no normal detail beyond a few regular sine waves (which read as stripes where they showed at all), no reflection of the pillars, walls or fires, a weak single-colour depth fade, a hard stairstep at every wall, refraction that bent up to 35 px and pulled the ledge in front of the water into it, a mobile tier with no foam at walls at all, and no caustics anywhere.

- **Surface** (`src/render/water.ts`): normals from a slow analytic swell plus two or three layers of a procedural ripple texture at unrelated sizes, angles and drifts (no visible tiling). The texture holds slopes, so its mipmaps flatten distant water instead of shimmering, and glints widen and dim with distance instead of sparkling. Schlick fresnel between the reflection (the room's dark vault, brighter towards the walls; the walls each fire and flare lights; their sharp glints; the sky through the skylight, traced to the opening in the vault) and what lies below. Per-channel absorption from the room's tint (clear shallows, tinted deep water, the sunk floor visible) and light scattered in the water, warmer near the fires. Snell's window from below, with rippled crests and a bright rim.
- **High tier**: screen-space reflections traced through the depth buffer (14 steps and 4 of bisection, unrolled for both backends), so pillars, walls and fires are mirrored in the ripples; refraction bends less (and less in the shallows) and never takes what stands in front of the water.
- **Shoreline on every tier**: each surface cell knows the tops of its eight neighbours, so the distance to walls, pillar corners and steps is exact without the depth buffer (mobile had no foam at walls before); the rich tiers add the depth buffer for Nora and props. Lacy foam and a thin meniscus hug the stone.
- **Flow**: while a gate drains or fills a room the ripples drift towards or away from it, roughen and churn near the gate.
- **Caustics are back without touching the level materials**: one overlay per wet room made of the room's own floor and wall triangles near and under the water (position and normal only, lifted 1 cm), drawn right after the opaque level with a modulate-2x blend. Map, normal map, AO, the uv1 lightmap, fog and shadows stay exactly as they were, and dry levels are untouched. Under the water the caustics dance on the pool floors and walls, fading with depth (red and blue a hair apart on high); above it, softer reflected ripples climb 1.6 m up the walls. The pattern is a photon-traced caustic texture made in code (`src/render/water-maths.ts`, tested): no assets.
- **Culling**: water surfaces and caustic overlays live in their room's group, so they are hidden with their room (the surfaces used to be drawn in every room).
- **One copy of the frame**: every viewport texture node copies the frame per render; all water reads now share one depth and one colour copy (0.2.1 made one per surface).
- **Tiers**: high 3 ripple layers, 3 swell waves, 6 lights, reflections, refraction, dispersed caustics; medium 3 layers, 2 waves, 4 lights, depth-buffer thickness and foam; mobile 2 layers, 1 wave, 2 lights, grid thickness and shoreline, caustics from two texture reads with a narrower band (0.9 m above the water, 4 m below).
- `pnpm bench --level cisterns` routes through a chamber other than the Antechamber.

Performance, `pnpm bench --level cisterns --warm 3 --frames 4` on SwiftShader (no GPU; wall time is only a rough direction), 0.2.1 → now:

| Tier   | Draw calls (mean / max) | Triangles (mean) | CPU frame median | Wall frame median | Textures (MB)         |
| ------ | ----------------------- | ---------------- | ---------------- | ----------------- | --------------------- |
| mobile | 147 / 206 → 137 / 197   | 121k → 136k      | 13.5 → 13.5 ms   | 851 → 887 ms      | 100 (360) → 102 (360) |
| high   | 244 / 370 → 235 / 361   | 688k → 703k      | 21.7 → 21.8 ms   | 1606 → 1713 ms    | 162 (438) → 131 (405) |

Same camera views before and after (`?level=cisterns`, WebGL 2 on SwiftShader), wall time per frame: mobile 390×844 at DPR 3 about +5 % on average (cistern pool 989 → 1081 ms, tide 1156 → 1233 ms, camp 1253 → 1296 ms; the caustic overlays are most of it), high 1280×720 about +8 % (the reflections). The Antechamber and the Temple keep the same draw calls and triangles.

The overlays add triangles and the high tier's reflections cost fill; culling the surfaces with their rooms takes back more draw calls than the overlays add. The ripple and caustic textures take about 0.25 s to generate on a desktop CPU, once, behind the loading screen.

## Version 0.2.1 (2026-09-27): no more bright lines along edges in the lightmaps

- **The cause** (`scripts/bake/bake_lightmap.py`): the bake splits the level into one object per room so each sun lights only its own room, and Blender applies the bake margin per object. Each room baked later painted its 4-texel margin over the gutters of rooms baked before it, and the atlas leaves only 4 texels between faces. The smoothing and the game's bilinear filtering then pulled that foreign light onto 1-texel faces (ledge lips, plinth tops, block rims, corbels), which showed as orange-red lines up to 20× too bright.
- **The fix**: Blender bakes with no margin. The smoothing averages only baked texels, and one margin over the whole atlas fills each gutter from its nearest face. The per-room sun, the shared fire gain and height, and leaving out the cold braziers all stay.
- **All three chambers re-baked** at the same size and samples. The Antechamber leaves the pre-shadow-audit bake that 0.2.0 restored as a stopgap.

## Version 0.2.0 (2026-09-27)

Three chambers to play, and a tomb that runs and sounds better on phones:

- **Chambers II and III:** the Cisterns and the Temple of the Sun, with the campaign between chambers (next-chamber button, Chambers map, saved progress).
- **Nora:** Mixamo motion made on her own mesh, pistols held in the palms and parallel when aiming, thigh holsters, and a torch that leaves one hand for a single pistol.
- **Look:** Options → Graphics (renderer, resolution, filtering, sharpen, grain, readout), softer textures, seamless fire lights, a shadow audit (fitted sun, true fire shadows) and matching bakes.
- **Performance:** room culling through portals, instancing, shader warm-up and a service worker. On the mobile tier the median CPU frame went from 31 to 19 ms.
- **Sound:** an adaptive orchestral score, and mobile audio that recovers by itself. The first tap starts the music, even on the splash.
- **Start-up:** splash, story cards while loading, a 3D app icon and a share preview.

## Shadow audit: the sun through the skylight, true fire shadows, a bake that matches

- **Sun framed on the skylight** (`src/render/shadows.ts`): daylight only enters through a sun room's opening, so the sun's shadow map now covers the prism under that opening (about 5 m across) instead of the whole room plus 4 m. Texels shrink from 14–20 mm to 2.6 mm on high and from 27–39 mm to 5 mm on medium and mobile, with the same map sizes. Outside the frustum counts as under the roof: three.js treats the outside of a shadow frustum as lit, which let the sun light every neighbouring room beyond the old frustum. The frustum is snapped to texels and stays put while the camera moves; it follows the last sun room while its light fades after leaving.
- **Biases from texel sizes, not by eye** (`src/render/shadow-math.ts`, tested): about a texel of depth bias and a texel plus half the filter's reach of normal offset, along the geometric normal (three's normalBias uses the normal-mapped one, which jitters on the rough scans). The fire casters had a constant bias in perspective depth, which grows with the square of the distance: 8 mm at 1 m, 20 cm at 5 m, over 1 m at 12 m of shadows detached from their casters. Theirs is now computed per pixel from the cube texel at that distance.
- **The mobile tier really leaves Nora out of the sun's static map**: with only layer 0 left, three copied the view camera's layers into the shadow camera and baked her in, a stale shadow refreshed once a second next to her contact blob.
- **Brazier bowls no longer shadow themselves**: the fire's light hangs 0.4 m above the bowl, inside the cube camera's 0.5 m near plane, which printed a broken half-ring on the floor; the near plane is 0.65 m and the whole bowl stays out of its own fire's map.
- **Ceilings**: only their sky side goes into shadow maps (they are double-sided), so fires no longer self-shadow the ceiling they light.
- **Contact blob** (mobile): it shrinks at ledges instead of hanging in the air past an edge.
- **Nora's torch** (high tier) had the same constant bias, worse at its 0.15 m near plane (about 1 m of detached shadow at 6 m); it now uses the fire casters' filter.
- **Lightmaps re-baked to match the realtime lights** (all three chambers): the bake is indirect-only (no double direct light), but every sun shone through every skylight at once, fires were baked at 2.5× the look's candela while the game drives them at 1.8×, and the Cisterns' cold braziers were baked burning, so the dark room and the tide glowed before any flare lit them. Each sun now lights only its own room (Cycles light linking), cold braziers are left out, and the fire gain and height are shared with the runtime.
- **Debug view**: `?debug=shadows` tints sunlight in shadow blue and firelight in shadow magenta, and draws the sun's frustum and each fire caster's near sphere; `GameRenderer.shadowAudit()` reports the framing, texel sizes, biases and every caster.

## The Temple of the Sun (chamber III)

Play it with `?level=sun_temple` (registered in `src/levels.ts`).

- **Ten rooms** (`levels/sun_temple.level.json`): the Sun Court, the Hall of Mirrors, the lift well with its ferry and lift, the vault of the bronze ray, the boulder run, the blade hall, the fire court with the Sun Door, the Court of Rays over its chasm, the guardian's hall and the sanctuary of the Sun Disc. Three secrets, three journal notes (`journal.sun_temple.1–3`; Elena's 1989 letter is tucked behind the last mirror drum of the Hall of Mirrors) and the relic, the Sun Disc.
- **Mechanisms and traps in the simulation** (`src/sim/mechanisms/`, spec §8): moving platforms that carry Nora, rotating mirrors and traced sun beams, sun-disc receivers, item slots, trapdoors, the rolling boulder, pendulum blades (2.4 s cycle, 40 damage and a shove) and fire floors with a readable warning. All reset at a checkpoint respawn.
- **The stone guardian** (`src/sim/actors/guardian.ts`, spec §7): immune to pistols; it falls only into a pit (lured onto the lever-dropped bridge) or to a blow on its core from above while its fists are buried after a slam. Two blows defeat it.
- **Score and checkpoints**: `music vista` at the first sight of the mirrors, `music chase` while the boulder rolls and `music calm` once it crashes, `music tension` from the blade hall through the fire court (calm in the Court of Rays), `music boss` when the guardian wakes and `music calm` when it falls apart. A checkpoint comes before the boulder, the blades, the fire and the boss; the walkthrough test checks the cue order.
- **Looks** (`art/looks/<room>.json`): golden, sunlit rooms with skylight shafts (the court, the lift well, the Court of Rays, the guardian hall, and a shaft falling on the Sun Disc's altar), dim warm halls where the beams are the light, gilded friezes and painted reliefs. Thirteen braziers light the dark rooms through the shared fire-light pool.
- **Lightmap**: baked with Blender Cycles at 64 spp (`public/levels/sun_temple.lightmap.*`); the renderer loads the current level's bake by id.
- **Visuals on a budget** (`src/render/temple.ts`, `src/render/guardian.ts`, `src/render/merge.ts`): static mechanism parts merge into one mesh per material; each sun beam is a fixed set of meshes (a core and a view-facing glow per segment, mirror flares, a hot spot and a splash of light where it lands, drifting dust) relaid only when a mirror turns; receivers flare when first lit and keep a breathing corona; fire flames are one instanced draw of camera-facing cards and the grates breathe faster before each burst; blades trail a motion smear; the boulder has a carved sun band, grit rains from its niche and dust follows its roll. The temple adds a fixed pool of three plain lights that fade between the nearest beam hot spots and burning grates (no shadow maps are created or resized at runtime). Nothing is allocated per frame. The mobile tier drops the beam glow, the smears and the boulder dust.
- **The guardian's body**: a carved figure with a crest of sun rays, amber eyes and the amber core in its back; a procedural heavy walk, a wind-up telegraphed by a ring filling in on the floor where the fists will land, the slam with a shockwave and dust, the stunned reel, the fall and climb out of the pit, and a collapse whose pieces tumble away.
- **Nora**: turning a mirror drum or setting the bronze ray in its slot plays one push cycle of the Mixamo push clip; standing on a moving platform, her planted feet ride with the deck.
- **Sound**: blade whooshes, fire hiss and bursts, drum grinds, a chime when a sun disc lights, the boulder's rumble and crash, and the guardian's steps, wind-up, slams, fall and collapse.

## The Cisterns (chamber II) and the campaign

Play it with `?level=cisterns`, or finish the Antechamber and choose "Enter the next chamber".

- **The level** (`levels/cisterns.level.json`): eleven flooded rooms under the tomb of Qarrum. Wading in Ferrand's camp, a first swim across the great cistern under a shaft of daylight, a dive under a drowned arch, a long dive with air pockets, the sluice hall whose gate lowers and raises the water to bring the door lever and the exit within reach, the aqueduct's two jackals and the flare cache, a pitch-dark hall of cold braziers lit with flares, Elena's landing and the Tide Chamber, where the tide is turned from a cave below to reach the Tide Glass. Three secrets (jade, gold, stone), three journal notes (Ferrand's diary, the gate carving, Elena's letter: `journal.cisterns.1–3`), checkpoints, medkits and hints in English and Spanish.
- **Water in the simulation** (`src/sim/player/modes/swim.ts`, `src/sim/actors/water.ts`): swimming at the surface and diving with a 60 s air bar and drowning damage, safe falls into deep water, wading, climbing out onto low edges, rolls in the water, and water gates that move a room's water. Movement tests in `tests/water.test.ts`.
- **Flares** (spec §7, essential here): light one with Flare (G, d-pad up), press again to throw it, with Walk drop it. They burn 30 s over 8 m, sink and keep burning under water, and light cold braziers they come close to. Cold braziers show no flame and get no pooled light until then; the fire-light scheduler fades their light in.
- **Water rendering** (`src/render/water.ts`, `water-fx.ts`): one surface draw per wet room with analytic ripples, fresnel between the scene and the room's darkness, glints of the nearest fires and flares, depth-based absorption and edge foam; Snell's window from below; caustics on floors and walls under the water and a softer reflected ripple above it; underwater fog, a wobble and a drowned grade; splashes, rings, bubbles and drips; a muffled mix (low-pass to about 500 Hz) while the camera is under. By tier: high refracts the scene through one frame copy; medium blends with depth-buffer thickness and foam; mobile reads neither frame nor depth, with three waves, two glints and no caustics.
- **Nora in the water** (`src/render/anim/animator.ts`): the Mixamo clips drive it. Treading Water when still, Swimming when moving (the cadence follows her speed), lifted to lie along the surface or centred under water and pitched along the dive; Swimming To Edge's reach blends into the climb when she climbs out. Water mode changes cross-fade more slowly.
- **Looks and light**: nine room looks (`art/looks/cistern_*.json`: cold stone, warm braziers, teal water with its own fog), a baked lightmap (`public/levels/cisterns.lightmap.*`, Cycles at 64 spp) and the Tide Glass as a cold sea-green relic.
- **Score**: the level marks its moments with `music vista` (the great cistern), `music tension` (the first dive and the dark hall), `music calm` and `music solved` after them, `music hall` in the sluice and `music relic` in the Tide Chamber, on the Cisterns palette.
- **Bot walkthrough** (`tests/cisterns.test.ts`): every room, all three secrets, no deaths; puzzle-necessity checks (the sluice door needs the basin lever, the lever needs low water, the island needs the high tide, the dark grate needs all three braziers) and a way out of every flooded room.
- **Campaign flow**: the end screen offers "Enter the next chamber" when the next level is in the build (the Antechamber leads to the Cisterns, the Cisterns to the Temple of the Sun, `sun_temple`). Chambers reached are kept in localStorage (`src/ui/progress.ts`, guarded; without storage the first chamber is always open). A chamber map from the title lists the nine chambers of `src/ui/campaign.ts`: the ones reached can be entered, the next wait, IV–VIII are sealed and IX is a mystery. Another chamber loads the page again with `?level=<id>`, which releases every GPU resource of the one left behind; an unknown or broken level falls back to the first chamber. Story cards over the loading reel are the Antechamber's, so other chambers tell theirs in the in-engine intro.

## The torch, and one pistol while she holds it

- **The torch** (`src/sim/player/torch.ts`, tests in `tests/torch.test.ts`): a new `torch` entity, found lit or unlit and picked up with Action. Action next to a burning brazier lights it. The new torch button (T, d-pad up where the flare slot was, and a touch button) puts it away on her belt and takes it out. Hanging, climbing, blocks and levers need both hands, so the torch goes on her belt still lit and comes back to her hand when she is free, unless she put it away herself. Water over the flame and the `torch.extinguish` rule action put it out. While the lit torch is in her hand the `torchLit` signal is true for level rules. Events: `torch.picked`, `torch.lit`, `torch.stowed`, `torch.drawn`, `torch.out`. The torch is part of the player state, so checkpoints restore it.
- **One pistol**: with the torch in her left hand only the right pistol is drawn and fired, at its own cadence (`weapons.pistols.oneHandCadence`, 0.48 s), so the rate halves. Auto-aim is unchanged. With the torch on her belt or put away, both pistols come back. The left pistol stays in its thigh holster (`src/render/combat.ts`).
- **Braziers** are now sim actors and can be cold (`"lit": false`): no flame, no light, dark coals.
- **Look and feel** (`src/render/torch.ts`): a wooden shaft wrapped in pitch-soaked cloth, flame sprites, embers and smoke in the braziers' style (24 particles), and one warm flickering light of its own, outside the fire-light pool. It casts shadows on the high tier only. Its `castShadow` is fixed at startup, and on other tiers the shadow fades out through `shadow.intensity`. The flame, light and shadow fade in and out and nothing pops. Nothing is allocated per frame. A left-arm hold-torch layer (`src/render/nora-scan.ts`) raises the upper arm about 30° and bends the elbow, over the walk and run clips. With pistols drawn, only the right arm goes to low ready. On her left hip the flame burns smaller.
- **The Antechamber**: the torch lies on the terrace above the Hall of Weights, next to its last brazier. The Sunken Causeway has gone dark: its braziers are cold and its look is near black. A new look field, `lightmap`, scales the baked bounce light in that room, so neither the geometry nor the bake changed. Without the lit torch a hint says it is too dark. With it, a carving explaining how to fill the chasm is revealed (`hint.carving`, flag `carving_seen`). The bot walkthrough lights the torch and carries it to the end.
- **UI, audio and haptics**: a "Light the torch" prompt near a brazier while she carries an unlit torch. A third touch slot, `.tbtn-slot-c`, shown once she has a torch and glowing while it burns in her hand. A crackle loop (the brazier fire, close and unpanned), a whoosh on lighting and on stowing, and a hiss when the flame dies. A small haptic tick on lighting.

## Audio on phones: the sound no longer drops out and stops

- **Root cause.** The AudioContext was resumed only from the title gesture and the pause menu. When Chrome for Android suspended or interrupted it on its own (audio focus, screen off, background, a stalled stream), nothing resumed it. The engine also dropped every event and frame update while the context was not running. Before that, the phone's audio thread ran at its limit, so the sound crackled in and out.
- **Self-healing.** The context resumes on `statechange`, on every gesture, when the page becomes visible again, and from a one-second watchdog. It is left alone while the pause menu holds it. The watchdog also frees voices that lost their `ended` event and resets gains stuck near zero. The music director keeps following events while the context is suspended. `__nc.audio.debug()` shows the state, voices, gains and a log.
- **Light profile on phones:**
  - 60 ms output buffer;
  - equal-power panning instead of HRTF;
  - 22 voices (12 sfx) and 2 footstep voices;
  - reverbs capped at 1.6 s;
  - the 3 nearest fires only;
  - sound effects decoded at 32 kHz and music loops at 22 kHz;
  - no chase or boss prefetch;
  - the synthesised air stops once the recorded beds play;
  - music streams play straight from the `<audio>` element instead of through Web Audio.
- **Ducking** is a JS-side envelope scheduled as linear ramps, so a duck can't get stuck. `cancelAndHoldAtTime` is no longer used. At most two stream elements exist at a time. A stream the browser pauses restarts on the next gesture.
- **Splash unlock.** The first tap or key, even on the splash before the game's code loads, makes and unlocks the AudioContext (`#audio-unlock` in `index.html`, with a silent buffer for iOS). The engine adopts that context, so the title theme starts from that same tap.

## Performance: room culling, instancing, lighter lights, offline start

- **Room culling through portals** (`src/render/rooms.ts`, `src/render/room-culling.ts`): only the rooms the camera can see are drawn. Portals are where open sectors of two rooms touch; a room is drawn when a chain of at most three portals whose openings are in the view frustum leads to it from the camera's (or Nora's) room. Level geometry is now merged per room and surface, and props, set dressing, flames, sun shafts, dust and jackals follow their room. Warm-up frames draw every room so hidden rooms' materials compile behind the loading screen.
- **Instanced set dressing**: rubble, pots, sand drifts, column bases and capitals and the altar are one instanced mesh per model part and room. Flame sprites share four materials instead of one each.
- **Fewer lights**: the ten sun-bounce point lights (one per sunlit room, all evaluated by every lit pixel) are now a pool of two that follows the current room.
- **Particles**: dust in rooms out of sight is not animated, and only the tier's share of dust and embers is updated.
- **Loading**: three.js in its own chunk (its hash survives game deploys), Nora preloaded from the HTML, and a service worker generated per build (`scripts/vite-sw.ts`): versioned by a hash of the build, precaching the engine and the first room, network-first for pages so a deploy is never hidden, and never taking over a running game.
- **Benchmark** (`pnpm bench`, `scripts/perf/bench.ts`) and `docs/performance.md` with the before and after numbers and how to profile.

## Splash and the story while the game loads

- **Splash** (`index.html`, `src/ui/prelude.css`): from the first paint, on black, the nine-segment seal carves itself: eight segments drawn one by one with an amber stroke and a glint as the stone fills in, the ninth left as an outline that flickers once like a dying ember; then the wordmark (by locale) fades in while its letter-spacing settles, with a faint shimmer of dust. About 2.8 s, pure CSS and SVG (the seal is the identity geometry from `src/ui/seal.ts`, baked in at build time). Any tap or key skips it; with reduced motion the finished seal holds still for a second. Loading runs underneath.
- **The story over the loading reel**: the four intro cards of The Antechamber play letterboxed over the reel of in-game renders, one image per card crossfading in with a slow drift, before any bundle arrives. The cards in every locale and each locale's timings are baked into `index.html` at build time (`scripts/vite-site.ts`, `%tt:key%` for text in every locale); a small inline script picks the language (the saved setting, else the browser's), reduced motion and touch, and the CSS plays the sequence. The loading line and its label sit small in the lower bar, with a Skip button on the right.
- **Loading on top of it** (`src/ui/prelude.ts`): when loading finishes, the card on screen finishes (never cut mid-read), then the title lockup comes up and the "Enter the tomb" button rises and glows; Skip, Escape, Enter, Space or a pad button bring the title at once. If the cards end first, the title comes up with the disabled button and the loading line under the menu.
- **No story twice**: entering the tomb leaves out the cards already read during loading; with all four read, the intro is a 9 s camera flythrough ending on the level title card. Cards skipped or never shown (a fast load) still play in the in-engine intro. Reduced motion keeps still images and the held intro shot.
- **Music**: the audio engine now exists before the renderer loads, so the first tap or key, even during the splash or the cards, unlocks audio and brings in the title theme with its slow fade-in. Without a gesture loading stays silent.
- **No jumps when the game loads**: the title screen's text (title, tagline, kicker, buttons, help, copyright, version, loading label) is in the page from the start in every locale, the seal's box is reserved and phones hide the keyboard help before the script runs.
- **Manifest**: background and theme colour are the splash black (`#0a0806`, also `<meta name="theme-color">`), orientation `any` (phones play in portrait too), and the flat SVG icon is gone from the icons so installs use the rendered PNGs.

## Adaptive score

- A music director (`src/audio/director.ts`) plays an adaptive score from simulation and UI events. States: title, intro, sparse exploration with long silences, tension, combat, chase, boss, relic climax, fanfare, death and end. Stingers mark discoveries, solved puzzles, checkpoints and death. The rules and techniques are in `docs/audio.md`.
- Vertical layering: each tension or danger loop opens from a filtered drone to the full bed as intensity rises, and a war-drum layer comes in on the bar grid. Switches between loops wait for the next bar. Stingers duck the bed. Low health adds a heartbeat and muffles the music.
- Level rules drive it with `music <name>`: `tension`, `calm`, `combat`, `chase`, `boss`, `vista`, `solved` and `silence`, plus the existing `hall`, `relic` and `fanfare`. Combat follows jackal alerts, deaths and give-ups; tension follows timed-door ticks, cracking floors and health.
- Palettes per chamber (`src/audio/score.ts`), mapped by level id: the Antechamber (ancient, solemn), the Cisterns (dark, watery) and the Temple of the Sun (majestic, with a boss).
- 29 cues by Scott Buckley and Kevin MacLeod (CC-BY 4.0), about 17 MB of Opus/WebM. Streams are never decoded; loops and stingers decode lazily at 24–32 kHz. `scripts/audio/build_audio.py` excerpts and levels them, finds seamless bar-length loop points, and writes the credits.

## Story, journal notes, intro and end screen

- **Story** (i18n, Spanish first): the eight known chambers sealed with a nine-segment ring, the ninth never found; the Ferrand expedition of 1956, from which only Elena Vidal came back and never spoke of it; seventy years later her granddaughter Nora, with Elena's notebooks, comes for the Amber Heart. Cast and dates for later chambers: Auguste Ferrand (leader), Elena Vidal (epigrapher, Nora's grandmother), Hartmann (photographer, lost on the gallery's west ledge); "where the water remembers" points to chamber II, The Cisterns.
- **Intro** (`src/ui/intro.ts`, `src/camera/cinematic.ts`): after "Enter the tomb", four cards in a letterbox over a camera move derived from the start room (the light shaft, the dust, Nora's front and side), landing on the orbit camera with the level title. Any key, click, tap or pad button skips it after 0.5 s. The title screen camera drifts on the same first shot, so the intro starts without a cut.
- **Journal notes**: new `note` entity (`text` i18n prefix, `style` diary / letter / carving, optional `wall`). Read with Action like a pickup; the sim emits `note.read`, sets `<id>.read` and counts each note once in `stats.notes` (kept across deaths). The validator checks the i18n keys and the wall. Four notes in The Antechamber: Ferrand's typed log, a fallen lintel, Elena's loose page and the inscription at the foot of the dais. The reader (`src/ui/reader.ts`) pauses the simulation and shows typed paper, a ruled notebook page or a rubbing of the carving (the same glyphs as the stone in the level, `src/core/glyphs.ts`) with Nora's translation. The props mark unread notes with a faint amber glint.
- **End of level** (`src/ui/end-screen.ts`): the relic moment (the star map inside the Heart, eight stars and an empty ninth place, and the initials scratched on the dais), time, secrets, notes, deaths and distance, a seal rank from `rateLevel()` (`src/sim/rating.ts`, constants in `tuning.ts`, par time in the level file), best time and seal in localStorage, and the teaser for The Cisterns. Play again or back to the title.
- **Title and credits** (`src/ui/title.ts`): logo lockup with the nine-segment seal (identity artboard), tagline, menu with keyboard and pad navigation, `v<version> · <git hash>` injected at build time, copyright line, and a Credits screen whose audio entries are read from `CREDITS.md` at build time. `CREDITS.md` added; the licence stays an open decision (`docs/license.md`, "All rights reserved" for now).
- **HTML and PWA basics**: description, Open Graph and Twitter card tags filled from `i18n/en.json` at build time (`scripts/vite-site.ts`), SVG favicon and PNG icons from the seal, and a generated `manifest.json` (fullscreen, landscape, theme colours).
- **Hooks for audio**: UI cues go through the same event bus as simulation events: `intro.start`, `intro.card`, `intro.skip`, `intro.end`, `note.closed`, `end.show`, `end.reveal`, `ui.credits` (plus the sim's `note.read`).
- **Campaign story** (`src/ui/campaign.ts`, i18n): the nine chambers with names and one-line descriptions for a campaign map (I The Antechamber, II The Cisterns, III The Temple of the Sun, IV–VIII sealed, IX unknown); for each playable chamber a kicker, a premise line, intro cards, 3–4 journal notes (`journal.<level>.<n>`), the relic, the clue it reveals and the end-screen teaser. The relics and their clues: the Amber Heart (a star map: where to look in the sky), the Tide Glass (the faces of the moon: a night without a moon) and the Sun Disc (nine rays, the uncut ninth: the sunset of the longest day, a direction). The intro, the level title, the relic notice and the end screen (with a figure per relic: stars, moons, rays) read this data by level id.
- **With the loading screen, pause menu and combat**: the start screen loads with the reel and the disabled button, then the reel gives way to the live entrance scene and the title lockup (Enter the tomb, Options, Credits); starting drops the curtain and lifts it on the intro, which lands in play with the level title. Escape or Start opens the pause menu in play (not during the intro or while reading a note). The end screen adds combat's rows (enemies, accuracy, medkits used). With reduced motion the title camera holds still and the intro holds its opening shot and cuts to Nora. The Credits screen's sound row reads the Audio and Music sections of `CREDITS.md`.
- **Secrets count once**: a secret found after the last checkpoint no longer comes back after a death (`stats.secretsFound`, kept across respawns), so it cannot be counted twice.

## Milestone 5 · Combat: the jackal and the pistols (in progress)

- Enemies in the simulation (`src/sim/actors/enemies.ts`): stats and behaviour name are data in `enemyTypes` (`src/sim/player/tuning.ts`). The jackal has 4 health, runs at 4.1 m/s, bites for 9 every 0.9 s within 1.1 m, climbs one click, never jumps or drops more than 1 m, and hunts in pairs: pack mates alert each other and flank from Nora's sides. States idle, alert, chase, attack, hurt, flee and dead. It perceives by distance, height and grid line of sight, and hears running (6 m), shots (14 m) and cracking tiles (10 m).
- A\* on the sector grid with height costs and no corner cutting (`src/sim/actors/pathfind.ts`), searched at most every 0.5 s and straightened with a walkability test. A high place is a refuge: out of reach, the jackal prowls right below and leaves after 8 s. Enemy bodies use the grid box sweep and push each other apart lightly. Enemy state lives in `world.state`, so checkpoints capture it; respawning sends the living ones home and they forget Nora.
- Dual pistols (`src/sim/player/weapons.ts`): R / LB / RB draw and holster (Fire also draws, for touch), 1 damage, 0.24 s cadence alternating hands, 16 m range, 85% hit chance rolled on `world.rng`. Holding Fire locks the nearest visible enemy and keeps it while visible; Tab / d-pad right cycles targets. Standing, Nora turns to her target; running, only her torso and arms follow it. Hanging, climbing or interacting holsters them. Medkits: H / Y uses the smallest kit that heals fully, else the largest.
- Levels: `enemy` entities (type, facing, pack) with a `<id>.dead` signal; the validator checks placement, headroom and packs of one. A pair of jackals rests in the brazier hall of The Antechamber; the walkthrough bot shoots them.
- Presentation: `src/render/enemies.ts` draws each jackal through a `JackalView`: a skinned glTF driven by named clips (`models/jackal.glb`, when present) or the procedural fallback, a lean golden jackal (dark saddle, cream throat and belly, rufous legs, big ears, black-tipped tail; ~3.7 k triangles) on a small bone hierarchy with a skinned spine and tail, animated from the sim state (idle sniffing, trot, rotary gallop, alert, bite strike, flinch, hurt, collapse). `src/render/combat.ts` adds pistols in Nora's hands, muzzle flashes with a brief light, hit and ricochet puffs and a subtle marker over the locked target. Nora gets an aiming arms layer (torso twist and two-bone IK of both arms, legs untouched). With the pistols out the camera moves over the right shoulder and closes to 4 m; shots and bites shake it a little.
- Audio: procedural gunshot (dry crack, thump and a tail into the room reverb), ricochets, bullet impacts, jackal growl, yelp, death whimper, bite and huff, holster clicks and medkit sounds. Haptics for shots, hits, bites and deaths.
- HUD: red edges when hurt; the end screen adds enemies, accuracy and medkits used. Touch: Fire (hold) and Draw / Holster buttons in the reserved arc slots.
- Tests (`tests/combat.test.ts`): perception, noise, packs, A\* round a pillar, step limits, refuge, bite damage and cadence, pistol cadence and seeded hit chance, auto-aim selection, medkits, checkpoint reset and the level format.

## The Antechamber grows to ten rooms

- The level now runs entrance → brazier hall → **Hall of Weights** → **Hourglass** → **Well of Light** → (terrace over the Hall of Weights) → **Sunken Causeway** → **Chamber of Scales** → **Descent** → gallery → relic chamber. The gallery and the relic chamber moved 48 rows north; their contents are unchanged.
- The level's new mechanic is the **weight plate**, introduced alone and then combined (spec §8, principle 2): in the Hall of Weights a plate holds its gate only while weighed down, so the hall's block has to hold it; in the Hourglass the gate lingers 12 s after the weight leaves, ticking, for a sprint with two jumps; in the Chamber of Scales two plates must be weighed at once, one block has to be pushed off a high shelf and the other is needed first as a step, with a spring lever that resets both blocks.
- Vertical exploration: the Well of Light is a 24 m sunlit shaft climbed with a block and a spiral of ledges; its top opens onto a terrace 12 m above the Hall of Weights, looking back over the plate and gate solved below. The Descent teaches lowering into a hang over a sunlit spike pit.
- Secrets: jade (entrance) and gold (brazier hall) stay; the stone idol moved from the gallery to a lone pillar in the Well, a standing jump away from the top walkway. A small medkit now sits on the gallery ledge where it was. Checkpoints precede every hard section; medkits follow the Well and the Causeway.
- New hints (`i18n/en.json`, `i18n/es.json`) for plates, holding weight, the ticking gate, the standing jump, filling a gap with a block, the two plates, the reset lever and lowering into a hang. New looks in `art/looks/`: `plate_hall`, `hourglass`, `well` (with a skylight), `causeway`, `scales`, `descent` (with a skylight).
- Sim: timed doors emit `door.tick` every second (a stone click in audio, doubled in the last three seconds); door actions only announce a move when the target changes; `"spring": true` levers can be pulled again; `<block>.reset` returns a block to its start; blocks fall when their support goes away; walking never drops off an edge the body already overhangs.
- Tests: the walkthrough bot (`tests/bot.ts`) plays the whole route through all ten rooms with the three secrets and no deaths (about 13 400 ticks); `tests/antechamber.test.ts` proves that each puzzle is needed, cannot be cheesed and never dead-ends.
- The baked lightmap (`public/levels/antechamber.lightmap.png`) predates the new geometry and must be re-baked.
- The four journal notes keep their places (entrance, brazier hall, gallery, relic chamber) in the ten-room layout; the par time for the rating rises from 240 s to 720 s (the bot's full route takes about 223 s).

- The lightmap (`public/levels/antechamber.lightmap.png`) was re-baked for the ten rooms (1024×2048, 96 spp).

## Visual quality · tiers, post-processing and menus (in progress)

- Quality tiers (`src/render/quality.ts`, spec §11): **high** has volumetric sun shafts ray-marched through the sun's shadow map, full-resolution GTAO, shadows from the two nearest fires, depth of field in focus shots, SMAA, 16× anisotropy and a pixel ratio up to 2; **medium** has one live shadow at a time (the sun where it shines, otherwise the nearest fire), the modelled light cones, SMAA, 8× anisotropy, 60 % particles and a pixel ratio up to 1.5; **mobile** has a sun shadow refreshed once a second without Nora plus a contact blob under her, FXAA, 4× anisotropy, 35 % particles and a pixel ratio up to 1.25.
- The first run picks the tier with a ~3 s benchmark of the title scene (phones go straight to mobile; a hidden tab falls back to a device heuristic). The choice is stored in `localStorage` and can be changed in Options. Dynamic resolution drops the scene render scale a step after 1 s over 18 ms and recovers slowly; at its floor an automatically chosen tier steps down.
- Post-processing is one TSL `RenderPipeline` (`src/render/post.ts`): AO, depth of field, god rays, bloom, the room grade (saturation, tint and now `grade.contrast`, in log space around mid-grey), AgX, SMAA/FXAA on the display image, then vignette and 24 fps film grain. The CSS grain and vignette overlays are gone. Development views: `?view=ao`, `?view=rays`, `?view=raw`.
- Pause menu (Esc, gamepad Start, a touch button, or leaving the tab): Resume, Restart from checkpoint, Options, Quit to title, with confirmation. Pausing stops the fixed-step simulation, freezes the frame and suspends audio.
- Options (also from the title): quality, master / music / effects volume, camera sensitivity, invert vertical look, reduced motion (no grain, no title sway), subtitles (placeholder), language. Keyboard, gamepad, mouse and touch share one amber focus.
- The start screen shows loading progress (files, shader warm-up, first-run calibration) and keeps the start button disabled until the tomb is ready.
- Smoother image after phone feedback (grainy, harsh, pixelated): the mobile tier now uses SMAA, 8× anisotropy and no film grain, and its pixel ratio (1.5 until measured, up to 2) comes from a first-run benchmark that phones now run too; grain is lighter everywhere. The scanned surfaces are softened at load time (albedo lerped towards its mean colour, normal maps at 0.65–0.85), and every texture in the scene, prop models included, gets trilinear mipmaps and the anisotropy level.
- Options → Graphics: Renderer (WebGL 2 / Auto / WebGPU, reloads to apply), Resolution (50 % / 75 % / Auto / Native up to 3×; only Auto runs dynamic resolution), Texture filtering (Auto / 4× / 8× / 16×), Sharpen (a light contrast-adaptive pass, automatic when the image is upscaled), Film grain and a Performance readout showing the backend, fps, pixel ratio and scene scale. Settings gain a layout version with a migration that re-measures phones once.
- Fire lights no longer pop: fixed pools of plain lights and shadow casters (`src/render/fire-lights.ts`) fade between braziers over ~0.8 s, the current and neighbouring rooms first, with shadow casters handed over by crossfading and hysteresis. The casters' `castShadow` flags and map sizes never change after creation, which ends the WebGPU "Destroyed texture [PointShadowDepthTexture]" flood caused by tier changes disposing a bound shadow map.

## Milestones 2–4 · The Antechamber (in progress)

- Nora is the Meshy scan provided by the owner, turned into a game asset by `scripts/character/rig_nora.py` (Blender): 1.5 M → 45 k triangles, scaled to 1.72 m, facing -Z, a 19-bone humanoid skeleton fitted to the scan with automatic weights, then compressed with meshopt and WebP (65 MB → 1.2 MB, `public/models/nora.glb`). `src/render/nora-scan.ts` retargets the procedural animation in `src/render/nora.ts` onto it, with rest-pose corrections for the A-pose limbs; the procedural body remains the fallback.
- Scanned CC0 textures from Poly Haven replace the procedural ones (`public/textures`, sources in `sources.json`); the procedural textures remain the fallback.
- Indirect light is baked with Blender Cycles (`scripts/bake`) into `public/levels/antechamber.lightmap.png` and applied on the second UV set; direct light stays dynamic.
- Procedural Web Audio engine (`src/audio`): buses, generated reverbs, positional fire and relic loops, footsteps per material, mechanism sounds and short music cues.
- Touch controls redesigned for phones: shown only while playing, icon buttons in a thumb arc with reserved weapon slots, ghost stick and look hints, dead zone and trailing stick base, gentle push walks, haptics, hints at the top, a glowing action button when something is usable, fullscreen on start and a minimum horizontal field of view in portrait.
- Haptics (`src/core/haptics.ts`): phones vibrate (Android browsers) and gamepads rumble on hard landings, ledge grabs, hits, death, moving and falling blocks, cracking and falling tiles, doors, levers, pickups, the relic and checkpoints, scaled by distance; touch buttons tick. The setting persists in `localStorage` (`nc.haptics`).
- Camera: over-the-shoulder pivot, lazy follow behind the direction of travel, look-ahead, speed-driven field of view and trauma shake on landings, hits, blocks, falling tiles and doors.
- Recorded audio replaces the procedural sounds (spec §12 "Producción"), which stay as the fallback while files load or where Opus/WebM cannot be decoded. `scripts/audio/build_audio.py` downloads the CC0 and CC-BY sources (Freesound, Kenney, incompetech), slices, cleans, levels (-18 LUFS sfx, -20 LUFS music and beds) and encodes them to Opus/WebM in `public/audio/` (1.3 MB of sfx, 5.3 MB of music), with `src/audio/samples.json` as the bank manifest and credits in `CREDITS.md` and `public/audio/CREDITS.md`.
  - `src/audio/samples.ts` loads banks by category after the unlock gesture and picks variants without repeats, with ±4 % pitch and ±2 dB gain. Footsteps have walk and run banks for stone and sand (10 each), a cloth layer, alternating left/right pan and extra room reverb; jumps, landings (soft and hard), ledge grabs and climbs are layered from boots, hands on stone, cloth and leather (no voice).
  - Mechanisms play at the actor or tile that emits them: stone block drags, door grinding loop with debris, lever, plates, tile cracks and collapses, the rumble. Braziers burn with a recorded fire loop; rooms get recorded air and wind beds and sparse distant drips.
  - Music (Kevin MacLeod) streams through `<audio>` into the music bus with crossfades: a title theme that opens the level and fades, a single pass of "Lost Frontier" in the great hall, "Arcadia" in the relic chamber and "Hero Theme" when the Heart is taken; then silence. Menu buttons click.

## Unreleased

- Nora is animated with the owner's Mixamo set, made on her own mesh: ground (idle, walk, run, walking backwards, with foot planting and a landing clip), jumps (standing and running take-offs, falling loop), hanging and shimmying, climbing up (timed to the simulation's climb), block, push and pull, pickup, a hit reaction and death. The pipeline reads the FBX downloads directly (`pnpm anim:build scripts/anim/sources/mixamo.json <folder>`); water clips are baked for level 2. The lever keeps its procedural animation. Details in `docs/animation.md`.

- Nora walks, runs and stands with motion clips instead of the procedural gait: `Idle_Loop`, `Walk_Loop` and `Jog_Fwd_Loop` from the Quaternius Universal Animation Library (CC0, see `CREDITS.md`), retargeted by direction onto her skeleton by `scripts/anim/build-clips.ts` (`pnpm anim:build`) into compact clips in `public/anim/` (6–16 kB each). At run time (`src/render/anim/`) idle, walk and run blend by speed with a shared gait phase, speed is matched with cadence and stride length, a leg pass pins planted feet (no sliding, no spinning on turns, steps followed smoothly), rolls the feet and lowers the hips when a leg can't reach, jumps play the library's take-off, airborne and landing clips, the arms are relaxed (straighter elbows, straight wrists, arms by the sides), and the procedural rig still drives hang, climb, block, push, pull, lever, pickup and dead with 0.2 s cross-fades. Details in `docs/animation.md`; `tests/anim.test.ts` checks the clips and that planted feet don't slide.

- The repo is now in English: code comments, error messages, test names, CLAUDE.md, README and this changelog. docs/spec.md stays in Spanish as the source document.
- `main` is deployed to GitHub Pages (https://ezar.github.io/ninth-chamber/) by `.github/workflows/pages.yml`.
- Player-facing strings moved to `i18n/en.json` and `i18n/es.json`, read through `src/ui/i18n.ts`; the locale follows the browser and falls back to English.

## Milestone 1 · Skeleton

- Repo with Vite, strict TypeScript, Three.js (`WebGPURenderer` with automatic WebGL2 fallback), Vitest, ESLint and Prettier.
- 60 Hz fixed-step loop with an accumulator, at most 5 ticks per frame and render interpolation (`src/core/loop.ts`).
- `InputFrame` as plain data with press and release edges; the camera yaw is part of the frame so replays are deterministic (`src/core/input-frame.ts`).
- Input from keyboard and mouse, gamepad (standard Gamepad API) and touch (floating joystick, camera drag, buttons) (`src/core/input.ts`).
- Seeded RNG and simulation event queue.
- Demo: a box character that runs, walks and jumps on a floor with a 2 m grid, with an orbit camera.
- Tests: fixed loop, input, RNG, PoC movement constants (5.4 m/s, 2.2 m/s, 1.35 m / 0.67 s jump, ~3.6 m running jump) and determinism via a `World` hash.
- CI on GitHub Actions (lint, format, types, tests, build). Per-PR previews through `netlify.toml` once the repo is connected in Netlify.

### Decisions

- TypeScript 5.9: the spec asks for TS 5 and typescript-eslint does not support TS 7 yet.
- Gravity is integrated exactly so jump height and duration match the spec regardless of step size.
- `camYaw` is part of `InputFrame`: movement is camera-relative and the simulation cannot read the camera.
