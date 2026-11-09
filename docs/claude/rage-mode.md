# Rage mode game

Moved out of the root `CLAUDE.md` (2026-11-09); the index there says when to read this file.

## Rage mode — a vertical-scrolling raid that takes off from your page

A small crosshair after "Anna Alldone: How can I help?" in the assistant line (`AssistantOptions` →
`components/RageMode/RageModeButton.js`) starts a vertical-scrolling shooter in the style of the
early-90s classics (`raidArena.js`). A voxel Anna Alldone with a jetpack takes off from the
assistant's avatar in the same line (and lands back on it when you leave),
**the page you are on slides down off the screen and generated ground scrolls in above it**, and
the mission is flown over that ground: today's tasks are dug in as labelled bunkers, scripted waves
of fighters and incoming mail come in, and the boss at the end is built from today's open-task
count. Between missions a hangar sells repairs, mega bombs and upgrades for credits earned in the
run. It replaced the earlier free-flight "shoot the page apart" mode (snakes, greetings, letter
knock-outs), which is gone. Purely for fun: **no data is ever written.** On for everyone; hidden only
for anonymous viewers, without WebGL, under reduced motion, or on a browser that opted out with
`?rageMode=off` (`?rageMode=on` undoes it; `rageModeFlag.js`). The arena is its own lazy
`rage-mode` chunk (three.js is shared with the skyline chunk).

**The app's DOM is never mutated, and the take-off is a STYLE, not a node.** The only things the
arena touches are inline style properties: `transform` + `will-change` on `#root` (the slide) and
`overflow: hidden` on `<html>` and `<body>` (a transformed root would otherwise grow a scrollbar).
React never renders those properties on those elements, and `setTemporaryStyle` restores each one to
exactly what it was — including removing a `style` attribute that did not exist — so the markup is
byte-identical afterwards (`browser-tests/rage-mode` asserts it). Everything else is drawn on the
arena's own canvas: a destroyed task row is covered with a plane in the colour behind it
(`resolveBackgroundColor`) and breaks into shards of a canvas copy of itself. Removing or moving real
nodes would hit the React/Quill `NotFoundError` class described above. **Nothing may reach the app**:
a transparent input layer covers the viewport under the canvas, and keys are swallowed in the
`window` capture phase, before every document-level listener including the escape stack
(Cmd/Ctrl/Alt combinations stay with the browser).

**The seam.** The camera is orthographic, one world unit per CSS pixel, so a hole drawn at a row's
`getBoundingClientRect()` covers exactly that row. Ground objects live in one group that scrolls with
the level: a point at ground distance `g` sits at screen y = `scroll − g`. While the page is on
screen, the ground must exist only ABOVE its top edge, so every ground material shares one clipping
plane (`seamPlane`) whose constant is the page's top edge; a soft shadow strip under the seam makes
the ground read as lying on top of the page. Leaving reverses it: the seam is re-anchored at the
bottom of the screen and rises with the page as it slides back up, so the ground never jumps. The
page's task rows on screen at take-off are the welcome committee (`pageTargets`): every other one
carries a turret that shoots back, and their titles (plus every other task row in the DOM) become the
bunker labels further up. Rows are found by the id every task row already has
(`task_body_<project>_<task>_…`, TaskPresentation's `nativeID`); bunkers take the project's marker
colour through `services.getProjectColor`, which reads the projects map from the store on demand
(lazily required) rather than subscribing the button to it (AT-2336).

**The game logic is pure and seeded** — `raidLevel.js` (missions, the six-wave script, bunker
placement that never lands in the river, terrain chunks), `raidEnemies.js` (scripted flight paths,
aimed fire), `raidArmory.js` (main gun levels, special volleys, rocket homing), `raidRun.js` (shield,
bombs, score, credits, the hangar price list), `raidControls.js` (mouse follow, keyboard, RELATIVE
touch drag so the thumb never covers her). The seed is the date (`daySeed`), so today's level is a
fixed thing you can get better at. **Credits are never Gold**: they are earned by shooting, live only
as long as the run and buy consumables; a game that paid out Gold would let a modified client mint
real currency.

**Where she launches from** is the avatar wrapper in `AssistantOptions`, tagged with
`RAGE_LAUNCH_ANCHOR_ID` (`rageLaunchAnchor.js`). `findLaunchPoint` searches OUTWARDS from the
crosshair for the nearest ancestor containing one, so two assistant lines on one screen never launch
from each other's avatar, and it falls back to the crosshair itself. The avatar's size is passed too:
she grows out of it and shrinks back into it.

**Progress follows the user across devices** (`raidProgress.js`). Clearing a mission saves a
checkpoint — the mission number plus the run as it leaves the hangar — and every successful hangar
purchase saves its own checkpoint; the next raid takes off at the following mission, and a game over replays from the
checkpoint (with that game's credits banked) rather than from mission 1. Only "Start over" clears it (↺ in the status pill pressed
twice, or the confirming button in the hangar and on the game-over card), and a start over is saved
as an EMPTY checkpoint so other devices drop theirs too. Two copies: the server's
(`rageModeProfiles/{uid}.progress`, written by `saveRageModeProgress`, returned by
`getRageModeProfile`) and the browser's (localStorage per uid) for saves
that could not reach the server yet (`pending`). Before Anna leaves her avatar, the arena waits
for `getRageModeProfile`, showing a loading panel. A failed read offers retry or exit; no timer
starts local gameplay (AT-2700). A successful empty profile starts at mission 1. The server stamps
`savedAt`, so devices with different clocks agree. `reconcile` adopts the server copy, retaining
only newer unsynced local saves for delivery; a synced local copy cannot override an empty server
profile. **Progress saves at every mission completion and every successful hangar purchase**
(AT-2700 follow-up), plus `gameOver`, explicit exit/navigation teardown or confirmed start-over.
Each boundary writes a pending local record and queues an individual cloud save. Rapid purchases
are delivered sequentially; an older acknowledgement cannot overwrite the newest local checkpoint.
Failed saves retain the queue for explicit retry. Every next takeoff waits for all outstanding saves,
with a retry/exit panel on failure; **active flight never saves or reloads progress**. Losing banks
only that mission's credits into the latest checkpoint; exiting retains the last completed
checkpoint/purchases (existing quit policy; uncompleted credits are not banked).
Score writes and leaderboard reads happen only at game end. Game-over offers save retry;
preflight/replay/reset also wait for outstanding score/board requests to settle.
`raidPersistence.js` carries the request barrier across arena teardown/reopening for the same uid,
so queued saves cannot overlap a new flight or its initial authoritative profile read. There is no
Rage progress realtime listener or polling. Loading/saving screens park requestAnimationFrame until
ready; no artificial delay. Gold weapon purchases remain explicit shop actions, with play paused. Both copies are owner-editable, so a checkpoint is always
read through `sanitizeCheckpoint`; the server's copy of those rules is
`functions/RageMode/rageModeProgress.js`, and `raidProgress.test.js` fails the build if the two
disagree. Since credits only buy in-run consumables, a forged checkpoint cheats nobody. Missions scroll faster as they go (`missionScrollSpeed`: 96 px/s, +12% per mission, at
most 1.8×), and the route is stretched to match so a mission keeps its length in time.

**The run-up.** On the page she does not simply fly off: she lands out of the avatar, RUNS (legs
on hip pivots in `rageModels.js`, jetpack sputtering) while the page starts to move slowly, then the
jetpack fires — a ring of dust, she rises, tips into flight, and the ground accelerates to the
mission's speed. The mission (and its first wave) starts at lift-off, and nothing fires before it.

**Shadows are real, not painted.** A shadow-casting sun throws every flying and standing object's
silhouette onto an invisible `ShadowMaterial` catcher plane, so shadows land on the ground and on the
page alike, and fall further away the higher something flies (heights in `Z`). Blurry blob shadows and
dark crater decals were removed because they read as dirt on the light ground; a destroyed bunker now
leaves a soft, light foundation patch with rubble that smokes for a moment. Keep the ground light:
fire cools into light smoke, never soot, and the hemisphere light's ground colour is bright so shaded
faces do not turn into dark spots.

**Enter (or 👋) is the greeting** (`rageGreeting.js`, pure and tested): one loop towards the camera in
which she turns from flying away up the screen to face you, greets with a pose and a speech bubble
and drops back into formation. An orthographic camera has no perspective, so "towards the camera" is
done by SCALE (`GREETING_GROW`); the pose's `z` runs 0 → 1 for exactly that. She stays steerable and
vulnerable but holds fire, and the greeting is cancelled by a game over, the hangar or leaving.

**The cast is Alldone's working day** (`raidEnemies.js`): mail swarms and fighters, chat bubbles
that zigzag and fire three-dot spreads, notification pings that HOME on Anna (the one steered path,
turn-rate limited so a sideways dodge works), sticky notes that split into two when destroyed,
checkbox mines that arm within `MINE_TRIGGER_RADIUS` and burst into a ring, meeting invites that fire
rotating rings, the deadline clock — a mid-mission mini-boss whose spiral turns with its hands — and
a golden starred task that never shoots and always drops power-ups. Fire patterns (aimed, spread,
ring, spiral) and each kind's tint, health and contact damage live in `ENEMY_TYPES`; the arena only
draws them. Mission 1 is hand-written and introduces the cast a wave at a time; later missions draw
from `WAVE_POOL` (seeded by the day), which unlocks notes, mines and meetings in mission 2 and the
deadline in mission 3, always flies a carrier, and puts a drawn deadline in the middle slot. The
first appearance of each new kind in a run is announced with how to deal with it.

**Power-ups** (`raidPickups.js`) drop from kills by `DROP_CHANCE` per kind (a carrier, a deadline and
the boss always drop): ☕ coffee (rapid fire), 💡 brainstorm (spread shot), 🛡️ shield bubble, 🩹 repair,
💣 bomb, 🤖 assistants (two drones that orbit and shoot), ⏳ deadline extension (the whole enemy side —
movement, fire, bullets, the boss — runs at `SLOWMO_SCALE`), ⭐ gold star (double score), 🧲 magnet,
💳 credits. A battered shield makes repairs three times as likely; a second pickup of a running buff
extends it, up to twice its duration. Kills chained within `COMBO_WINDOW` build a combo (`raidRun.js`)
worth up to ×3 on POINTS, never on credits.

**There is always a boss, and there are five of them** (`raidBosses.js` for how they fight,
`raidBossModels.js` for how they look), one per mission in turn: the Backlog (aimed fans, lunges, mail
swarms), Inbox Overlord (rows of falling letters with gaps to find), Calendar Colossus (column beams
that flash a warning before they burn, one always on Anna; corner bursts), Notification Storm (a
swinging bell whose shockwave rings each leave one gap; homing pings) and the Grand Deadline
(counter-rotating spirals, its hands sweeping as beams). Each gets angrier below half health. All
are equally hard every day (`BOSS_HP`, scaled only by the mission) — on an empty inbox too: today's
open-task count (the number the Home button's badge shows, `getAllProjectsOpenTasksAmount` over
`sidebarNumbers`) is only what each wears, counting down as it takes damage, and 0 the whole fight
on an empty inbox. Beams and waves ALWAYS telegraph before they can hurt (`BEAM_WARN`, and a wave's gap
is drawn exactly where `waveHits` has it). Text on a disc (a cylinder turned to the camera — the clock
face, badges, pickup tokens) needs `DISC_TEXTURE_TURN`, or it shows a quarter turn off.

**There is a GLOBAL leaderboard** (`functions/RageMode/rageModeLeaderboard.js`), shown after every
game over: the top five, the player's own row highlighted (or shown
below the five with its rank when it is not among them), and the name they play under, editable in
place. One document per player in `rageModeLeaderboard/{uid}` — no client rule, so only the callables
`getRageModeLeaderboard` / `setRageModeName` and `submitRageModeScore` touch it; a new best is written
to the board in the SAME transaction that keeps the profile highscore (also carrying a best from before
the board existed). Rank is a `count()` of strictly higher scores plus one, so ties share a rank and
nothing reads the whole board. The board is visible to every Alldone user across workspaces, so a real
name is never shown by default: until a player chooses one they are "Pilot ####" (derived from the uid),
and a chosen name must be 2–20 letters, digits, spaces or `. _ - '` — nothing that can carry a link,
markup or a mention. Scores are posted only when the run ends. Keys typed into the name field are kept from the game and the app
(`NAME_INPUT_ATTRIBUTE`): the window capture handler lets them type and stops everything else.

**The raid is fitted to the screen** (`raidScreen.js`): the same waves on a phone would be three times
as dense as on a laptop, with the same Anna and the same hit box. Against a 1280×800 reference area,
`density` (√ of the area ratio, 0.5–1.15) scales HOW MANY — enemies per wave, bullets per ring, bunkers,
armed rows at take-off — and `pace` (0.65–1) scales HOW OFTEN enemies, bunkers and bosses fire. Health,
damage, scoring and mission length do not change. Recomputed on resize.

**Steering is relative where it has to be.** A browser cannot move the real cursor, and at take-off
it is still on the crosshair, so the first mouse movement after a reset only records the gap between
the (hidden) cursor and Anna; later movements move her by as much and close the gap a little,
bounded so she always moves the way the mouse moved. It resets after the shop, the hangar, a game
over and keyboard steering. The weapon shop opens mid-mission too (🛒 / B) and pauses everything,
buff timers included; it is also on the hangar and the game-over card.

**Sound** (`rageSound.js`) is synthesised: a compressor bus with a short generated reverb, small
random detunes so repeats never sound identical, rate limits for rapid fire, and a voice per event —
each special weapon, explosions by size, every enemy's fire, mines arming, each power-up's own chime,
combo steps, every boss's arrival plus the bell's dong, the clock's tick and charging/firing beams,
the run-up's footsteps and ignition, a jetpack rumble that follows the ground speed, a low-shield
alarm, and stings for mission start, mission complete and game over. Loops (engine, laser hum) stop
on mute, pause, the hangar, game over and exit.

**Weapons are bought with Gold on the SERVER, never granted by the client.** The main gun always
fires and is upgraded with credits; ON TOP of it fires one special weapon bought with Gold
(`rageWeapons.js`: blaster = none, shotgun 100, rocket 250, flamethrower 400, laser 600, black hole
1000, finger snap 2000), switched with 1–7 or the weapon bar and bought in the shop panel reached
from the hangar, which always asks to confirm. `functions/RageMode/rageModeProfile.js` hosts three
callables — `getRageModeProfile`, `purchaseRageModeItem`, `submitRageModeScore` (plus
`saveRageModeProgress` and the leaderboard's two) — over
`rageModeProfiles/{uid}`, a collection with NO client rule at all, so Firestore's default deny keeps
ownership and highscores out of reach of the browser (deliberately not `users/{uid}` or
`users/{uid}/private/**`, which are owner-writable). A purchase goes through `deductGold` with source
`rage_mode_item` and the idempotency key `rage_mode_item:<weapon>`, scoped per user — each weapon is
charged at most once ever. The server's price list is `functions/RageMode/rageWeaponsCatalog.js`;
`rageWeapons.test.js` fails the build if the display copy disagrees. `submitRageModeScore` keeps the
best score and caps it at 10 million. The arena stays free of backend imports: `RageModeButton` hands
it `services` (the three calls via the lazily-required `rageModeBackend.js`, plus live getters), and
the harness passes fakes. `tuning` (`seed`, `bossAt`, `noWaves`, `startShield`, `startCredits`, `invincible`) exists
for tests only (plus `waves`, `bossHp` and `pickups`, which `browser-tests/rage-mode --cast` uses to
show the whole cast at once). All strings come from one table, `rageStrings.js`.

**Credits are balanced for about a hundred games, and a test holds it there.** A perfect mission
pays ~250 credits early and ~500 later (`CREDITS` + `MISSION_BONUS_CREDITS` in `raidRun.js`), an
ordinary game about half that, while the permanent upgrades cost ~20,500 (cannon 3,000 → 7,000,
shield generator 2,500 → 3,500 → 4,500); repairs (60) and bombs (80) stay cheap enough for every go.
That only works because **a lost game keeps what it earned**: `gameOver` banks the attempt's
`missionCredits` into the checkpoint (`bankCredits` in `raidProgress.js` — before mission 1 is ever
cleared that is a `completed: 0` checkpoint, which `sanitizeCheckpoint` keeps only while it carries
credits, upgrades or purchased extra bombs; the server copy applies the same rule), and the game-over card opens the hangar
(🛠️, or H) to spend them before another go at the same mission. Without banking, a grind this long
would strand players at the first mission they cannot clear. Difficulty never stops rising but each
mission adds less (`missionDifficulty`: `1 + 0.3·(n−1)^0.7` — 1.3 at mission 2, 2.4 at 10, 3.5 at 30).
An earlier tuning paid ~2,200 for mission 1 and everything was bought after two missions, after
which nothing was hard. The `balance` block in `raidRun.test.js` sums every kill of the real
generated missions and fails if the hundred-game target drifts.

**The HUD must fit a 320px phone with a 12px edge gap** (`EDGE` in `raidHud.js`): the status pill and
the weapon bar are `width: max-content` capped at `100vw - 24px` and wrap (a fixed element at
`left: 50%` is otherwise offered only half the screen and wraps far too early); the buff chips and the
bomb button sit above the weapon bar's MEASURED height; the boss bar sits below the pill's measured
height; toasts wrap within `min(460px, 100vw - 48px)`; panels pad by `EDGE` plus the safe-area insets
and put the launch / play-again button first, full width.

**Light ground needs opaque effects**: explosions, flames and enemy fire are opaque tinted sprites,
never additive glow, which vanishes on a light background (the skyline learned the same). Particles,
shots and sparks are `InstancedMesh`es with `frustumCulled = false` (their bounding sphere is the
unit geometry at the origin). **Overlays are placed on the VISIBLE viewport**
(`visibleWidth`/`visibleHeight` in `raidHud.js`): on a phone a page that overflows sideways widens
`innerWidth` past the screen, and `left: 50%` on a fixed element then lands off screen.
`raidArena.test.js` drives the real arena in jsdom with only the renderer stubbed;
`browser-tests/rage-mode` (`--touch`, `--game`) is the only place it actually renders.
