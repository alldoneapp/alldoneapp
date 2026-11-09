# Empty inbox skyline (3D city)

Moved out of the root `CLAUDE.md` (2026-11-09); the index there says when to read this file.

## The Empty inbox card draws the last month as a 3D city (skyline)

The card has a Week/Month/Year switch (remembered in localStorage, `alldone.emptyInbox.range`; Week
until the user picks one). Week and Month draw the current week or the last 5 weeks as a three.js
city (`Achievements/Skyline/`), laid out like a calendar page — weekdays as columns, weeks as rows,
the current week nearest the camera; Year is the original 2D grid for the whole year. The scene is
built for one layout (`createSkylineScene(…, { weeks })`, `SKYLINE_RANGE_WEEKS`), so the card
remounts it with `key={range}`. A single week is a 7×1 strip, so it gets a flatter canvas, a
narrower orbit (`getOrbitView(t, sweep)` — turning a strip diagonal costs most of its width), no
plane, and a balloon, birds and helicopter kept below its roofs, because its frame has no sky above
them. Without WebGL (native, jsdom, `canRenderSkyline` in `webglSupport.js`,
which must never import three) there is no switch and the grid is all there is. three.js is
loaded with a dynamic `import()` into its own `skyline` chunk and never enters the main bundle; the
web bundle aliases `three` to its ES module build because the app's Babel config turns imports into
`require`, which otherwise picks three's CJS shim and throws on `process.emitWarning` in a browser.

**Data.** One building per day: height = `doneTasks` summed over the user's **active** projects from
`statistics/{projectId}/{userId}` (one `day` range read per project; the past is cached per session,
only today is re-read — `utils/backends/Users/skylineStatistics.js`), scaled to the user's own
95th-percentile day (`getSkylineScale`) so one extreme day cannot dwarf the rest. Building TYPE
follows the same measure (`getBuildingType`: park → house → mid-rise → tower → skyscraper). A gold
flag waving on the building's highest point marks a day in `emptyInboxDays` (the same array the
grid reads) — it replaced a green roof, which a green project's building made indistinguishable. Everything that decides what a
building means lives in the pure, unit-tested `skylineData.js`.

**Look.** Drawn straight onto the white card (transparent canvas) in app colours only, with lit
shading. Height is the only thing that carries data; each day otherwise picks one of several designs
for its height band (cottage, silo, row houses, shop; fan block, round tower, L-block, twisted stack;
stepped tower, banded cylinder, spiral, twins with a sky bridge, obelisk, spire skyscraper) . Colour
comes from the day's PROJECTS: the body is the busiest project's colour, accents the second
project's, and stacked designs colour their slabs by each project's share (`getProjectColorAt`).
`BODY_PALETTE`/`ACCENT_PALETTE` only fill in what the data leaves open; design and fill-ins are
seeded by date so a day always looks the same, and the palette picks are always drawn so a second
project appearing never changes the design. Every design tops out at exactly the day's height. A night sky and cloud shadows were each tried and removed (they revealed the edge of the canvas). Days sit `PITCH` apart with roads between every
row and column. Nothing may be drawn on the ground outside the city.

**Light and materials.** Physically based (`MeshStandardMaterial`): masonry (stone, plaster, brick)
and tinted glass for towers, whose windows are real low-roughness, slightly metallic glass that
reflects a prefiltered `RoomEnvironment` (skipped gracefully where float render targets are
missing). Neutral tone mapping keeps the palette honest. Light is that environment, a hemisphere
fill and one shadow-casting sun (or moon); the shadow camera is deliberately wide so a low sun's long
shadows are not cut off, and the light never comes from below ~17° so golden hour stays lit. Project
colours are small touches only (lobby bands, awnings, small roofs, tower bands, sky bridges).
Framing fits the camera to the real building tops where they stand (`setBuildingTops`), eased by
time rather than per frame. Tuning was done by rendering the real scene headless in Chromium
(Playwright + SwiftShader, bundled with esbuild, a frozen `Date` for day/golden hour/night) — jsdom
cannot show any of this, so do the same before changing materials or light.
`getDaylight` puts the sun where it really is for the user's city (`getSunPosition`, the standard
low-precision almanac): real sunrise, sunset, noon height and season. The location is inferred
WITHOUT a permission prompt — IANA time zones are named after cities, so `guessLocation` maps the
common ones to coordinates and otherwise derives a longitude from the UTC offset. Day blends into
night through civil twilight (sun between +6° and −6°), which is also when the lamps come on; low
sun is warm and throws long shadows, the night is a dimmer cool moon. The city faces south, so the
midday sun lights the side the camera sees. Facade detail (faint floor lines, darkening where walls meet the street, and a window grid on
walls only) is injected into the buildings' material with `onBeforeCompile`. Windows are quiet
darker glass by day; a seeded third of them glow warm as emissive light, faded in with the street
lamps by `getDaylight().lamps` (an early always-lit version read as noise — tie them to the evening).
The injection keeps three's lighting and shadows; the anchors it replaces (`worldpos_vertex`,
`color_fragment`, `metalnessmap_fragment`, `emissivemap_fragment`) must still exist in the Standard (physical) shader after a three.js
bump, or the detail silently disappears. Traffic is deliberately sparse (8 slow cars): the city should feel calm.
After dark the city gets its own light, all of it faded in with `lamps` and absent by day: warm
light pools under the street lamps, car headlights with a beam on the road and red tail lights, the
plane's red/green/strobe navigation lights, the balloon's flickering burner, brighter skyscraper
beacons, and a helicopter that only flies at night, sweeping a searchlight cone over the streets
(birds roost then). These are additive glow sprites and meshes, not real lights — a real point
light per lamp would multiply the per-fragment cost of every building.

**Camera.** It flies on its own and ignores the page scroll (`getOrbitView`: a slow ±30° sweep, elevation
~38–49°, never round the back so the ground legends are never upside down; a wider sweep turns the
wide calendar diagonal to the camera and shrinks the city).
Every frame `fitDistance` bisects the closest distance at which the ground with its legends and
the tallest possible building on the outermost blocks project inside the canvas with a margin
(bounds kept asymmetric and tight so no room is reserved where nothing can be — the legends are
bounded where they are painted, with the week-date width measured, not by a rectangle whose
near corner projects far outside them), and a lens shift (`setViewOffset`) centres the projected
box, so only its SIZE has to fit: the camera looks at a fixed ground point while the towers rise
above it, and fitting the distance alone left an empty band along one edge. The
camera never sits closer than that, so the city can never be clipped by the canvas edge; a clipped
city is what breaks the illusion that it stands on the card. Flying objects stay over the city and
appear/disappear by scale, never by crossing the edge. Two earlier designs were dropped: a
scroll-driven off-axis "flyover" with a fixed ground (looked wrong in practice), and a low camera
(outer buildings fanned outwards).

**Interaction.** Hover/tap shows a day; there is no drag or zoom, and the only event the canvas stops
is `click` (the all-projects card is itself a link). Every tap on the city also launches an
ASTEROID — at the tapped building, or at the tapped spot on the ground (a tap off the city's ground
launches nothing). It appears high over the city by scale (never across the canvas edge), streaks in
trailing fire and smoke while a red ring tightens on its target, and does its damage only where it
lands: `getAsteroidDamage` (pure, in `skylineData.js`) gives 2 hit points for a direct hit and 1 to
anything else in the blast, whose radius stops short of the next block, so aiming at a building
never hurts a neighbour; a road strike catches both sides, and the 15% big ones (`CRITICAL_HIT_CHANCE`)
hit for 4 and reach the four neighbours. Buildings still roll their hit points (`rollHitPoints`) and
lose floors per hit (`getIntegrity` keeps a third standing until the final blow, so the collapse
stays an event), then collapse into dust and rubble. The impact is flash, fireball, a ring of fire on
the ground, shockwave, smoke column with a mushroom cap, debris, embers, one real `PointLight` (always
in the scene at intensity 0, so shaders never recompile), camera shake and a scorch mark that stays.
Fire is **opaque, unlit, flat-shaded** puffs coloured along a white→yellow→orange→red→soot ramp —
additive glow is invisible on the card's white sky. What lies on the ground (shockwave, scorch) is
clipped to the city's ground with `localClippingEnabled` clipping planes, and debris that leaves the
city burns out before it lands, so an edge strike cannot paint the card. The week strip has no sky above its towers, so there a rock aims at a tall tower's lower floors, the blast is smaller, and fire and smoke flatten out under the highest roof (`blastCeiling`) instead of rising off the canvas. Six rocks can be in the air;
under reduced motion there is no flight or explosion, only the damage. Memory-only and keyed by
date — a statistics refresh must not resurrect a demolished day, a reload brings everything back.
The celebration run that pops the 2D today dot pops today's flag instead, and the first hit on
a building knocks its flag and rooftop equipment off.

**Today is marked in the app's blue (`Primary100`), never in gold.** Gold already means "empty
inbox" (the flags), so today gets the colour the 2D grid rings its square in: a blue ring round
today's block on the ground, today's weekday and week legends in bold blue, a ripple spreading from
the block, and a "Today" tag (a sprite, so it reads from every angle, drawn with `depthTest: false`
so a tower in front cannot hide it) floating over the roof. The tag is part of the framing bounds
(`setBuildingTops`), so it never leaves the card; the day line under the city prefixes "Today". The
Year grid rings today's square with a 2px blue border whether or not it was cleared (it used to lose
the ring exactly on a cleared day).

**Life and cost.** The decorative layer (a few slow cars, street trees and lamps, zebra crossings,
a small flock of birds, an occasional balloon or plane) carries no data, is not interactive, and is switched off under
reduced motion (which also freezes the camera at `SKYLINE_REST_VIEW`). The render loop only runs
while the card intersects the viewport. `skylineScene.test.js` drives the real scene in jsdom with
only the WebGL renderer and the 2D canvas stubbed — it is the one test that executes this module,
which needs `three` in Jest's transform allowlist and the class-static-block Babel transform.
