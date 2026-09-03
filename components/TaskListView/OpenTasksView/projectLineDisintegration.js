/**
 * AT-2495 (second pass) — how a CLEARED PROJECT'S LINE leaves the board.
 *
 * ── WHAT MOVED, AND WHY ───────────────────────────────────────────────────────────────────────
 *
 * The first pass of this put the disintegration on the completed TASK row, and that was the wrong
 * target: "make it look like the line disappears the way Thanos snaps his fingers" was asked about
 * the PROJECT line, and a task row that comes apart into dust every time a checkbox is ticked turns
 * a dozens-of-times-an-hour interaction into a 1.2-second cinematic. The task row therefore has its
 * AT-2404 exit back, unchanged (`taskCompletionMotion.js`), and the disintegration lives here — on
 * the one row that leaves the board at most once per project per day, and only ever because
 * something worth marking has happened: the project's today list reached zero.
 *
 * That scarcity is the whole licence for the effect. It is also why the celebration
 * (`ProjectLineDisintegration.js`'s sparks) belongs here and nowhere else.
 *
 * ── THE THREE LAYERS ──────────────────────────────────────────────────────────────────────────
 *
 *   1. A DISSOLVE FRONT travelling right to left. The line's own pixels are erased by a CSS mask
 *      whose gradient slides across it — the project name, the avatar, the tags, the add-task
 *      button, the bottom rule and the completed sweep's own coloured wash, in one pass, with no
 *      duplicated content and no canvas.
 *   2. DUST AND SPARKS lifting off that front (`ProjectLineDisintegration.js`). Neutral motes for
 *      the texture of the disintegration, and a handful of small tinted sparkles as the "little
 *      celebration" — both released exactly where the line has started to come apart, so the
 *      celebration is visibly CAUSED by the line leaving rather than layered on top of it.
 *   3. The COLLAPSE, pushed to the very end: by the time the row's height starts closing there is
 *      nothing left in it to squash.
 *
 * ── WHY A MASK AND NOT PARTICLES ──────────────────────────────────────────────────────────────
 *
 * The honest way to disintegrate a DOM node is to erase it progressively, and `mask-image` is the
 * only thing on the platform that can do that to arbitrary live content — the line holds text, an
 * avatar image, chips and buttons, none of which can be sampled into particles without drawing the
 * row to a canvas first (`html2canvas`-shaped work). One masked node costs a single compositing
 * layer for 1.2 seconds and is thrown away afterwards.
 *
 * react-native-web 0.21 passes `maskImage` / `maskSize` / `maskRepeat` / `maskPosition` and their
 * `Webkit`-prefixed twins straight through `createReactDOMStyle` (the same passthrough
 * `transformOrigin` already relies on in the sweep beside this), and `Animated.Value.interpolate`
 * produces the position as a plain `'37%'` string, so the whole sweep is ONE animated value on ONE
 * existing node.
 *
 * It degrades safely. If a browser ever ignores the mask, `createProjectLineExitStyle` still fades
 * the row out over `CONTENT_FADE_*` and still collapses it, so the line leaves — it just leaves as
 * a fade. That fallback ramp is invisible when the mask works, because by then the mask has already
 * erased everything it would have dimmed.
 *
 * ── THE GEOMETRY, WHICH IS THE PART THAT IS EASY TO GET WRONG ─────────────────────────────────
 *
 * The mask image is `DISSOLVE_MASK_SCALE` times the row's width and is slid across it with
 * `mask-position`, which resolves as `offset = (rowWidth - imageWidth) * position`. So the row
 * window travels from the image's left edge to its right edge as the position runs 0% -> 100%.
 * For the row to be FULLY opaque at 0% and FULLY erased at 100%, the image needs a solid reservoir
 * one row wide at its left, a transparent reservoir one row wide at its right, and the grain band
 * in between — hence `2 + DISSOLVE_BAND_RATIO`, and hence the band being the only free parameter.
 *
 * Two consequences worth knowing. The band is what the eye reads as "the edge", so it is a
 * fraction of the ROW, not a fixed pixel count: the same gesture on a 320px phone row and a 1200px
 * desktop row. And the front is already inside the row at t=0 (its solid edge starts exactly at
 * the right-hand edge), so the dissolve begins immediately rather than after a lead-in — a 1.2s
 * effect cannot afford to spend its first third doing nothing.
 *
 * ── WHY THE BAND IS GRAINY AND NOT A SMOOTH RAMP ──────────────────────────────────────────────
 *
 * An EVENLY descending gradient is a fade, which is what this replaces. The stops inside the band
 * therefore fall by irregular amounts over irregular spans: a near-flat step is a patch of the row
 * that hangs on after its neighbours have gone, a steep one is a patch that goes all at once. What
 * they must never do is climb — see `DISSOLVE_GRAIN_FLOOR` for why that distinction is the whole
 * difference between dust and flicker.
 *
 * The irregularity is hashed from the stop index, never `Math.random()`: the gradient string is
 * built once at module load and has to be identical on every row and every run, or two projects
 * cleared in the same minute would visibly dissolve differently for no reason.
 */

/**
 * The whole exit, from the first erased pixel to a flat row. Chosen by the user over a ~700ms
 * "subtle and fast" alternative — this is the cinematic one.
 *
 * Nothing waits on it. Unlike the task-row exit it replaced, this delays no Firestore write at all:
 * the write that empties the project happened when its last task was ticked, and all this holds is
 * the moment the board drops a block it has already decided to drop (`PROJECT_LINE_EXIT_HOLD_MS` in
 * `projectCompletedSweepMotion.js`).
 */
export const DISINTEGRATION_DURATION_MS = 1200

/*
 * Everything below is a fraction of `DISINTEGRATION_DURATION_MS`, because every layer is
 * interpolated from ONE `Animated.Value` running 0 -> 1 across the exit. That is the same rule
 * AT-2404 applies to the title bar and the row wash, and AT-2492 applies to the sweep's own stages,
 * and for the same reason: the dissolve front, the dust that lifts off it and the height that
 * closes behind it are one gesture, and separate timings for them would drift the moment any one
 * duration is retuned.
 */

/** The front carries its band off the row's left edge — the last pixel is erased — at 68% of the run. */
export const DISSOLVE_END = 0.68

/**
 * The mask-free fallback fade (see the header). Starts after the mask has already erased most of
 * the row, so it changes nothing about how this looks when masks work.
 */
export const CONTENT_FADE_START = 0.6
export const CONTENT_FADE_LEVEL = 0.35

/**
 * The gap closes last, and deliberately after the dust and the sparks have finished
 * (`maxParticleEnd() <= COLLAPSE_START`, pinned in the tests): a row whose height is collapsing
 * while motes are still drifting inside it clips them off mid-flight.
 */
export const COLLAPSE_START = 0.81
export const ROW_FADE_END = 0.95

/** The line leaves upward into the gap it is closing rather than simply being removed. */
export const ROW_LIFT_PX = -6

/**
 * The width of the grain band, as a fraction of the row's width. Wide enough that the front is a
 * region rather than a line — at 45% of a desktop row that is ~400px of ragged edge, which is why
 * no vertical raggedness has to be faked on top of it.
 */
export const DISSOLVE_BAND_RATIO = 0.45

/** One row of solid reservoir + the band + one row of transparent reservoir. See the header. */
export const DISSOLVE_MASK_SCALE = 2 + DISSOLVE_BAND_RATIO

const BAND_START_STOP = 1 / DISSOLVE_MASK_SCALE
const BAND_END_STOP = (1 + DISSOLVE_BAND_RATIO) / DISSOLVE_MASK_SCALE

/**
 * How far the front travels, in row widths, while `mask-position` runs 0% -> 100%. It is more than
 * one row because the front enters from the right-hand edge already partly inside the row and has
 * to carry its whole band off the left-hand edge before the last pixel is gone.
 */
export const DISSOLVE_TRAVEL = DISSOLVE_MASK_SCALE - 1

/** Grain resolution. Enough stops to read as texture, few enough to keep the gradient legible. */
export const DISSOLVE_GRAIN_STEPS = 9
/**
 * The grain is made of UNEVEN STEPS, not of a jittered ramp — and the difference is the one design
 * decision in this file that a test caught rather than a review.
 *
 * The obvious way to roughen a gradient is to scatter each stop's alpha around a smooth ramp. It
 * produces a convincing-looking gradient and a wrong animation: a band whose alpha rises anywhere
 * along it will, as it slides over a fixed pixel, take that pixel down, put it BACK, and take it
 * again. Dust does not come back. On a row of text it reads as flicker, which is exactly the
 * "cheap effect" impression this pass exists to avoid.
 *
 * So the alpha only ever descends, and the irregularity is in HOW FAR and HOW FAST it descends at
 * each step. A near-zero drop is a plateau — a patch of the row that hangs on while its neighbours
 * have already gone — and a big drop over a narrow span is a patch that vanishes at once. That is
 * spatial grain, which is what disintegration looks like, without any temporal reversal.
 *
 * A weight can therefore be almost nothing (`FLOOR`) or nearly twice the average (`FLOOR + SPREAD`).
 */
export const DISSOLVE_GRAIN_FLOOR = 0.08
export const DISSOLVE_GRAIN_SPREAD = 1.84

/**
 * Deterministic per index — NOT `Math.random()`, for the same reason `EmptyInboxConfetti` hashes
 * its trajectories: a value read at build time must be identical on every row, and a value read
 * during render would re-roll on every re-render and teleport a mote onto a new path mid-flight.
 * This row re-renders constantly — it is subscribed to the project's task counts.
 */
const pseudoRandom = (index, salt) => {
    const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453
    return value - Math.floor(value)
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const percent = value => `${Number(value.toFixed(4))}%`

/** Normalised, irregular, and summing to exactly 1 — one set for the drops, one for the spans. */
const grainWeights = salt => {
    const weights = Array.from(
        { length: DISSOLVE_GRAIN_STEPS },
        (_unused, step) => DISSOLVE_GRAIN_FLOOR + pseudoRandom(step, salt) * DISSOLVE_GRAIN_SPREAD
    )
    const total = weights.reduce((sum, weight) => sum + weight, 0)
    return weights.map(weight => weight / total)
}

export const buildDissolveMaskStops = () => {
    // Two independent weightings, so a stop that drops a long way is not also the one that covers
    // a long span. Correlating them would produce a band with a single steep middle — a smooth
    // ramp with extra vertices.
    const drops = grainWeights(11)
    const spans = grainWeights(13)

    const stops = [
        { offset: 0, alpha: 1 },
        { offset: BAND_START_STOP, alpha: 1 },
    ]

    let alpha = 1
    let travelled = 0
    for (let step = 0; step < DISSOLVE_GRAIN_STEPS - 1; step += 1) {
        alpha -= drops[step]
        travelled += spans[step]
        stops.push({
            offset: BAND_START_STOP + (BAND_END_STOP - BAND_START_STOP) * travelled,
            alpha: clamp(alpha, 0, 1),
        })
    }

    // Pinned rather than accumulated: the band has to end at exactly transparent and exactly at
    // its own edge, and floating-point drift there leaves a hairline of the row behind forever.
    stops.push({ offset: BAND_END_STOP, alpha: 0 }, { offset: 1, alpha: 0 })
    return stops
}

/**
 * `rgba(0,0,0,a)` rather than a greyscale ramp: a gradient mask is matched on its ALPHA channel
 * (`mask-mode: match-source`), so the colour is irrelevant and the alpha is the whole signal.
 */
export const buildDissolveMaskImage = (stops = buildDissolveMaskStops()) =>
    `linear-gradient(to right, ${stops
        .map(({ offset, alpha }) => `rgba(0, 0, 0, ${Number(alpha.toFixed(3))}) ${percent(offset * 100)}`)
        .join(', ')})`

export const DISSOLVE_MASK_IMAGE = buildDissolveMaskImage()
export const DISSOLVE_MASK_SIZE = `${percent(DISSOLVE_MASK_SCALE * 100)} 100%`

/**
 * Where the front's leading (still-solid) edge is, as a fraction of the row's width, at a given
 * point of the run. 1 is the row's right edge, 0 its left.
 *
 * Derived rather than eyeballed because the dust depends on it: a mote has to lift off exactly
 * when the row under it starts to come apart, and a hand-tuned stagger would slide out of step
 * with the mask the first time the band width is retuned.
 */
export const dissolveEdgeAt = (progress, bandFraction = 0) =>
    1 + DISSOLVE_BAND_RATIO * bandFraction - DISSOLVE_TRAVEL * clamp(progress / DISSOLVE_END, 0, 1)

/** The band's leading edge: the last column of the row that is still completely untouched. */
export const dissolveFrontAt = progress => dissolveEdgeAt(progress, 0)

/**
 * How thin a column has to get before it is worth shedding a mote. NOT the leading edge of the
 * band, and the difference matters: the grain's first steps are deliberately gentle, so the band's
 * leading ~45% takes the row from 1.0 down to only ~0.9 alpha. A mote released there would be a
 * dot hanging over text that has visibly not started to come apart yet.
 */
export const DUST_LIFT_ALPHA = 0.9

/** Where in the band the row first drops below `DUST_LIFT_ALPHA`, as a fraction of its width. */
const bandFractionAtAlpha = (threshold, stops = buildDissolveMaskStops()) => {
    const bandWidth = BAND_END_STOP - BAND_START_STOP
    for (let index = 1; index < stops.length; index += 1) {
        const previous = stops[index - 1]
        const current = stops[index]
        if (current.alpha > threshold) continue
        const span = previous.alpha - current.alpha
        const ratio = span > 0 ? (previous.alpha - threshold) / span : 0
        const offset = previous.offset + (current.offset - previous.offset) * ratio
        return clamp((offset - BAND_START_STOP) / bandWidth, 0, 1)
    }
    return 1
}

export const DUST_LIFT_BAND_FRACTION = bandFractionAtAlpha(DUST_LIFT_ALPHA)

/**
 * The point of the run at which the row at `x` starts visibly coming apart (0 = the row's left
 * edge, 1 = its right). Derived from the mask rather than tuned by hand, so neither the dust nor
 * the sparks can slide out of step with the erasure the first time the band is retuned.
 */
export const particleLiftOff = x =>
    clamp((DISSOLVE_END * (1 + DISSOLVE_BAND_RATIO * DUST_LIFT_BAND_FRACTION - clamp(x, 0, 1))) / DISSOLVE_TRAVEL, 0, 1)

/**
 * Sparse on purpose. The dust is the texture of the effect, not the effect itself — the mask is
 * what actually removes the row — and every mote is an `Animated.View` restyled on every frame by
 * the JS driver. Eighteen across a full-width row is roughly one per 50px, which reads as dust
 * without turning the board into a particle system.
 */
export const DUST_MOTE_COUNT = 18
/** A mote's life, as a fraction of the run: ~215ms, plus up to ~72ms of jitter. */
export const DUST_MOTE_LIFE = 0.18
export const DUST_MOTE_LIFE_JITTER = 0.06
/** Where in its own life a mote is at its brightest. Early, so it appears AT the front. */
export const DUST_MOTE_PEAK = 0.22
export const DUST_TONE_COUNT = 3

/**
 * One mote per column plus a bounded jitter, rather than a free random x. Free randomness at this
 * count reliably leaves a bald patch somewhere across a wide row and clumps three motes together
 * somewhere else; columns guarantee the front sheds dust along its whole travel.
 */
export const buildDustMotes = (count = DUST_MOTE_COUNT) =>
    Array.from({ length: count }, (_unused, index) => {
        const columnJitter = (pseudoRandom(index, 1) - 0.5) * (0.8 / count)
        const x = clamp((index + 0.5) / count + columnJitter, 0, 1)
        const start = particleLiftOff(x)
        const life = DUST_MOTE_LIFE + pseudoRandom(index, 6) * DUST_MOTE_LIFE_JITTER

        return {
            key: `dust-${index}`,
            x,
            // Kept off the row's extreme top and bottom: a mote on the edge reads as a rendering
            // artefact of the row's border rather than as something lifting out of it.
            y: 0.16 + pseudoRandom(index, 2) * 0.68,
            size: 1.5 + pseudoRandom(index, 3) * 2.5,
            // Up, always. Falling dust reads as debris; rising dust reads as dispersal.
            rise: -(6 + pseudoRandom(index, 4) * 12),
            // …and slightly to the right, i.e. trailing BEHIND the front, which travels left.
            trail: 3 + pseudoRandom(index, 5) * 12,
            peakOpacity: 0.35 + pseudoRandom(index, 7) * 0.4,
            toneIndex: index % DUST_TONE_COUNT,
            start,
            end: start + life,
        }
    })

export const DUST_MOTES = buildDustMotes()

/* ── THE CELEBRATION ─────────────────────────────────────────────────────────────────────────────
 *
 * "Add a little celebration to the animation when the project line disappears."
 *
 * The constraint that shapes every number below is AT-2492's ranking rule, which this must not
 * break: the all-projects empty inbox is the big moment and owns CONFETTI — sixteen pieces thrown
 * from behind a headline plus thirty falling across the whole viewport, under gravity, spinning,
 * on a `position: fixed` layer that escapes to the screen. Clearing ONE project is a smaller thing
 * and has to stay smaller in KIND, not merely in degree, or the two read as the same celebration at
 * two volumes — which is exactly what the first pass of AT-2492 got wrong and had to withdraw.
 *
 * So this is not confetti at a lower piece count. It is SPARKS, and it differs from confetti in
 * every property that carries the difference:
 *
 *   • they are struck OFF the dissolve front — same `particleLiftOff` as the dust, so the
 *     celebration is visibly caused by the line coming apart rather than thrown over it;
 *   • they rise and fade; nothing falls, nothing spins, there is no gravity arc;
 *   • they are a 4-point twinkle a few pixels across, not a tumbling rectangle;
 *   • the layer is `position: absolute` and bounded to the one 56px row, so it can never escape to
 *     the viewport the way the page fall deliberately does;
 *   • there are nine of them against confetti's forty-six.
 *
 * The colours are the project's own tint plus a neutral highlight (resolved by the component), for
 * AT-2492's reason: a project line is an identity, and the sweep that has just crossed it is in the
 * project's colour, so the sparks it sheds should be too.
 */

/** Nine. Enough to read as a flourish, few enough that it can never read as confetti. */
export const SPARK_COUNT = 9
/** Longer-lived than dust — a spark is meant to be caught, a mote only to texture the edge. */
export const SPARK_LIFE = 0.26
export const SPARK_LIFE_JITTER = 0.08
/**
 * Later in its own life than a mote's peak (`DUST_MOTE_PEAK`, 0.22): a twinkle grows into its
 * brightest frame and then goes, which is what makes it read as a spark rather than as a dot being
 * switched on.
 */
export const SPARK_PEAK = 0.34
/** How large a spark gets at its peak, relative to its resting size. */
export const SPARK_PEAK_SCALE = 1
export const SPARK_START_SCALE = 0.25
export const SPARK_END_SCALE = 0.1

export const buildSparks = (count = SPARK_COUNT) =>
    Array.from({ length: count }, (_unused, index) => {
        // Its own column grid, offset half a column from the dust's, so a spark never lands exactly
        // on a mote and the two layers read as one shower rather than as paired dots.
        const columnJitter = (pseudoRandom(index, 21) - 0.5) * (0.7 / count)
        const x = clamp((index + 0.5) / count + columnJitter, 0, 1)
        const start = particleLiftOff(x)
        const life = SPARK_LIFE + pseudoRandom(index, 22) * SPARK_LIFE_JITTER

        return {
            key: `spark-${index}`,
            x,
            y: 0.2 + pseudoRandom(index, 23) * 0.6,
            // 5–9px across the full star, i.e. a couple of pixels of visible arm. Small enough that
            // nine of them across a 900px row is a sprinkle, not a burst.
            size: 5 + pseudoRandom(index, 24) * 4,
            // Rises further than dust does — this is the layer that is meant to be noticed.
            rise: -(12 + pseudoRandom(index, 25) * 16),
            // Drifts both ways, unlike the dust, which all trails behind the front. A celebration
            // that leans in one direction reads as the same wipe again.
            drift: (pseudoRandom(index, 26) - 0.5) * 22,
            peakOpacity: 0.55 + pseudoRandom(index, 27) * 0.35,
            // Every third spark is the neutral highlight; the rest carry the project's colour.
            tinted: index % 3 !== 1,
            start,
            /**
             * Clamped, not merely tuned. A spark lives longer than a mote, and the last few lift off
             * near the row's left edge — late enough that an unclamped life would still be drifting
             * when the height starts closing and the board pulls whatever is underneath up through
             * it. Deriving the bound rather than picking a life that happens to fit means
             * `SPARK_LIFE` can be retuned without silently reintroducing that overlap; the sparks
             * that lift off early (most of them) get their full life, and only the last one or two
             * are cut short — at the very end of their fade, where it is not visible.
             */
            end: Math.min(start + life, COLLAPSE_START),
        }
    })

export const SPARKS = buildSparks()

/**
 * The last frame on which anything is still drifting. Pinned against `COLLAPSE_START` in the tests:
 * the row must not start closing while a particle is still alive inside it, because the collapsing
 * node clips its own overflow and would cut the particle off mid-flight.
 */
export const maxParticleEnd = (particles = [...DUST_MOTES, ...SPARKS]) =>
    particles.reduce((latest, particle) => Math.max(latest, particle.end), 0)

/**
 * The mask half of the exit. Separate from `createProjectLineExitStyle` only so a caller can reason
 * about (and a test can assert on) the erasure without the collapse in the way; both are applied to
 * the same node.
 *
 * @param {Animated.Value} progress 0 -> 1 across `DISINTEGRATION_DURATION_MS`.
 */
export const createDissolveStyle = progress => {
    // Two interpolations rather than one shared node: the same `AnimatedInterpolation` listed
    // under two style keys would be attached to the style twice, and paying for a second trivial
    // division per frame is cheaper than reasoning about that.
    const maskPosition = () =>
        progress.interpolate({
            inputRange: [0, DISSOLVE_END],
            outputRange: ['0%', '100%'],
            extrapolate: 'clamp',
        })

    return {
        maskImage: DISSOLVE_MASK_IMAGE,
        maskSize: DISSOLVE_MASK_SIZE,
        maskRepeat: 'no-repeat',
        maskPosition: maskPosition(),
        // Safari served `-webkit-mask-*` alone for years and still accepts it; both are set
        // because there is no cost to it and no way to feature-detect from inside a style object.
        WebkitMaskImage: DISSOLVE_MASK_IMAGE,
        WebkitMaskSize: DISSOLVE_MASK_SIZE,
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskPosition: maskPosition(),
    }
}

/**
 * Everything the leaving project line carries during its exit: the dissolve, the fallback fade, the
 * height that closes the gap and the lift that sends it upward into that gap.
 *
 * @param {Animated.Value} progress 0 -> 1 across `DISINTEGRATION_DURATION_MS`.
 * @param {number} rowHeight The line's measured height, frozen when the exit began. The caller only
 *   builds this style once it has one — collapsing from an unknown height would jump.
 */
export const createProjectLineExitStyle = (progress, rowHeight) => ({
    ...createDissolveStyle(progress),
    height: progress.interpolate({
        inputRange: [0, COLLAPSE_START, 1],
        outputRange: [rowHeight, rowHeight, 0],
        extrapolate: 'clamp',
    }),
    opacity: progress.interpolate({
        inputRange: [0, CONTENT_FADE_START, COLLAPSE_START, ROW_FADE_END],
        outputRange: [1, 1, CONTENT_FADE_LEVEL, 0],
        extrapolate: 'clamp',
    }),
    // Load-bearing during the collapse, and harmless before it: the row is a fixed height for the
    // whole exit, and its content keeps its natural size inside that box.
    overflow: 'hidden',
    transform: [
        {
            translateY: progress.interpolate({
                inputRange: [0, COLLAPSE_START, 1],
                outputRange: [0, 0, ROW_LIFT_PX],
                extrapolate: 'clamp',
            }),
        },
    ],
})
