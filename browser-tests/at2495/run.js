/**
 * AT-2495 browser-level test — the PROJECT LINE's disintegration and its celebration, actually
 * erasing pixels.
 *
 * The user asked for the cleared project's line to come apart into dust, right to left, over 1.2
 * seconds, with a small celebration as it goes. Four things about that are unobservable from jest
 * and are checked here instead:
 *
 *   1. THE PASSTHROUGH. The whole erasure is a CSS mask, applied through react-native-web's style
 *      pipeline and animated through `Animated`'s per-frame `setNativeProps`. jsdom drops CSS
 *      properties it does not implement without a word, so a jsdom test reports the same empty
 *      string whether the code is right or completely wrong.
 *   2. THE PICTURE. A style object is not a paint. The row is screenshotted every ~50ms and its
 *      surviving pixels are counted per column, which is the only measurement that can tell
 *      "a mask is applied" apart from "the mask erases the correct half in the correct order".
 *   3. THE CLOCK. `__mocks__/react-native.js` replaces `Animated.timing` with a no-op `{start}`
 *      stub, so no jest suite in this repo has ever watched this animation advance by one frame.
 *   4. THE BRANCH. Stage 4 of the sweep is either a settle (the line stays) or the disintegration
 *      (the line leaves), and which one runs is read 2.1s in, from a ref, precisely because the
 *      board's verdict usually arrives AFTER the celebration starts. `--stay` and `--late` drive
 *      both orders; getting this wrong is invisible in production, because a settle is a perfectly
 *      plausible-looking animation.
 *
 * `--reduce-motion` asserts the INVERTED contract: no run at all — no mask, no particles, no
 * collapse — because a line that cannot be celebrated should leave exactly as it always did.
 *
 * Requirements (not part of CI's Jest jobs):
 *   nvm use 22
 *   (cd web-bundler && npm install)
 *   cp -R -f replacement_node_modules/* node_modules/
 *   npx playwright install chromium
 * Usage:
 *   node browser-tests/at2495/run.js [--reduce-motion] [--stay] [--late]
 */
const path = require('path')
const http = require('http')
const fs = require('fs')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const ENTRY = path.join(__dirname, 'harness.entry.js')

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>AT-2495</title>
<style>html,body,#root{margin:0;padding:0;box-sizing:border-box;background:#fff}</style></head>
<body><div id="root"></div><script src="/harness.js"></script></body></html>`

// Kept in step with `projectCompletedSweepMotion.js`; asserted against the paint below.
const SWEEP_LEAD_MS = 820 + 760 + 540
const DISINTEGRATION_MS = 1200
const ROW_WIDTH = 900
const ROW_HEIGHT = 57
/**
 * How far past the run to keep sampling, so the abandoned-exit backstop is observed rather than
 * merely trusted. `EXIT_RECOVERY_MS` fires 520ms after the run ends (the board's 120ms hold tail
 * plus 400ms), and the harness deliberately never unmounts the line.
 */
const RECOVERY_TAIL_MS = 900

function build() {
    const webpackBin = path.join(ROOT, 'web-bundler', 'node_modules', '.bin', 'webpack')
    if (!fs.existsSync(webpackBin)) throw new Error('web-bundler deps missing: (cd web-bundler && npm install)')
    execFileSync(
        webpackBin,
        [
            '--config',
            path.join(ROOT, 'browser-tests', 'webpack.harness.js'),
            '--mode',
            'development',
            '--env',
            `harnessEntry=${ENTRY}`,
            '--env',
            `harnessOut=${BUILD_DIR}`,
        ],
        { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=1400' } }
    )
    fs.writeFileSync(path.join(BUILD_DIR, 'index.html'), HTML)
}

function serve() {
    const server = http.createServer((req, res) => {
        const url = req.url === '/' ? '/index.html' : req.url.split('?')[0]
        const file = path.join(BUILD_DIR, url)
        if (!fs.existsSync(file)) {
            res.writeHead(404)
            return res.end('not found')
        }
        const type = file.endsWith('.js') ? 'application/javascript' : 'text/html'
        res.writeHead(200, { 'Content-Type': type })
        res.end(fs.readFileSync(file))
    })
    return new Promise(resolve => server.listen(0, () => resolve(server)))
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail) => {
    results.push({ name, ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

/** Fraction of the row's stand-in colour still painted, and where its surviving edges are. */
const survival = scan => {
    if (!scan || !scan.columns.length) return null
    const columns = scan.columns
    const total = columns.reduce((sum, value) => sum + value, 0)
    let opaqueRight = -1
    let anyRight = -1
    let anyLeft = -1
    columns.forEach((value, index) => {
        if (value > 0.97) opaqueRight = Math.max(opaqueRight, index)
        if (value > 0.05) {
            anyRight = Math.max(anyRight, index)
            if (anyLeft < 0) anyLeft = index
        }
    })
    const half = Math.floor(columns.length / 2)
    return {
        coverage: total / columns.length,
        opaqueRight,
        anyRight,
        anyLeft,
        leftHalf: columns.slice(0, half).reduce((a, b) => a + b, 0) / half,
        rightHalf: columns.slice(half).reduce((a, b) => a + b, 0) / (columns.length - half),
    }
}

const finish = async (browser, server) => {
    await browser.close()
    server.close()
    const failed = results.filter(r => !r.ok)
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
    process.exit(failed.length ? 1 : 0)
}

async function main() {
    const reduceMotion = process.argv.includes('--reduce-motion')
    // The board's verdict arrives BEFORE the celebration (`--late` off) or after it (`--late` on).
    const late = process.argv.includes('--late')
    // The line is staying put — the selected-project board, where the header never leaves.
    const stay = process.argv.includes('--stay')
    build()
    const server = await serve()
    const port = server.address().port
    const { chromium } = require('playwright')
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    const page = await browser.newPage({
        viewport: { width: 1000, height: 400 },
        reducedMotion: reduceMotion ? 'reduce' : 'no-preference',
    })
    page.on('pageerror', e => console.log('PAGE ERROR:', e.message))
    await page.goto(`http://127.0.0.1:${port}/`)
    await page.waitForFunction('window.__ready === true')
    // `useReducedMotion` resolves its preference a microtask deep; the run below must see it.
    await sleep(200)

    const mode = reduceMotion
        ? 'prefers-reduced-motion: reduce'
        : stay
          ? 'the line stays'
          : late
            ? 'the board says "leaving" only after the celebration has started'
            : 'the line leaves'
    console.log(`\n--- mode: ${mode} ---\n`)

    const clip = { x: 0, y: 0, width: ROW_WIDTH, height: ROW_HEIGHT }
    const shot = async () => {
        const dataUrl = `data:image/png;base64,${(await page.screenshot({ clip })).toString('base64')}`
        return survival(await page.evaluate(url => window.__scan(url), dataUrl))
    }

    const before = await shot()
    check(
        'the line is fully painted before anything happens',
        before.coverage > 0.98,
        `coverage ${before.coverage.toFixed(3)}`
    )

    await page.evaluate(
        ([leaving]) => {
            window.__t0 = performance.now()
            window.__begin(leaving)
        },
        [!stay && !late]
    )
    if (late) {
        // The ordinary production order: the celebration starts on the `sidebarNumbers` snapshot,
        // and `thereAreNotTasksInFirstDay` — which is what says the block is being dropped — lands a
        // beat later. Deciding stage 4 at `start()` would have missed this every time.
        await sleep(900)
        await page.evaluate(() => window.__setLeaving(true))
    }

    // The whole run plus a margin, sampled as fast as a screenshot + decode allows. It has to
    // outlast the LAST spark, which lifts off near the row's left edge well after the mask has
    // finished with it.
    const frames = []
    // Long enough to cover the abandoned-exit backstop as well as the run itself: the harness never
    // unmounts the line, which is exactly the situation that backstop exists for.
    const deadline = Date.now() + SWEEP_LEAD_MS + DISINTEGRATION_MS + RECOVERY_TAIL_MS
    while (Date.now() < deadline) {
        const measured = await page.evaluate(() => window.__measure())
        frames.push({ ...measured, ...(await shot()) })
        await sleep(10)
    }

    const spark = values => values.map(v => (v === null || v === undefined ? '-' : v)).join(' ')
    /**
     * The run itself, i.e. everything before the abandoned-exit backstop puts the row back.
     *
     * That backstop is real behaviour and is asserted separately below — the harness leaves the line
     * mounted forever, where the board would have dropped it ~120ms after the run — so the erasure
     * checks have to be scoped to the run or "the row is restored" reads as "the row came back
     * mid-dissolve".
     */
    const runFrames = frames.filter(f => f.t <= SWEEP_LEAD_MS + DISINTEGRATION_MS + 200)
    const exitFrames = runFrames.filter(f => f.t >= SWEEP_LEAD_MS - 150)
    console.log('    t (ms)     :', spark(exitFrames.map(f => f.t)))
    console.log('    coverage   :', spark(exitFrames.map(f => f.coverage.toFixed(2))))
    console.log('    opaqueRight:', spark(exitFrames.map(f => f.opaqueRight)))
    console.log('    row height :', spark(exitFrames.map(f => f.rowHeight)))
    console.log('    mask pos   :', spark(exitFrames.map(f => (f.maskPosition || '').split(' ')[0] || '-')))
    console.log('    motes/sparks:', spark(exitFrames.map(f => `${f.moteCount}/${f.sparkCount}`)))

    if (reduceMotion || stay) {
        /**
         * Both of these assert the same inverted contract, for different reasons. Under reduced
         * motion a 1.2s dissolve is exactly what the user has asked not to see. On the
         * selected-project board the line is not going anywhere, so erasing it would leave a hole
         * where the project header should be — the run has to hand the row back exactly as it found
         * it.
         */
        const label = reduceMotion ? 'reduced motion' : 'a line that stays'
        check(
            `${label} — the row is never masked`,
            frames.every(f => !f.maskImage || f.maskImage === 'none'),
            ''
        )
        check(
            `${label} — no particle layer is mounted`,
            frames.every(f => !f.layerPresent),
            ''
        )
        check(
            `${label} — the row never collapses`,
            frames.every(f => f.rowHeight === null || f.rowHeight >= ROW_HEIGHT),
            `heights ${[...new Set(frames.map(f => f.rowHeight))].join(',')}`
        )
        check(
            `${label} — the row is still fully painted at the end`,
            frames[frames.length - 1].coverage > 0.98,
            `coverage ${frames[frames.length - 1].coverage.toFixed(3)}`
        )
        return finish(browser, server)
    }

    // ── 1. the passthrough ──────────────────────────────────────────────────────────────────────
    const masked = runFrames.filter(f => f.maskImage && f.maskImage !== 'none')
    check('the mask reaches the DOM at all', masked.length > 0, `${masked.length}/${runFrames.length} frames`)
    if (masked.length) {
        console.log('    mask-image :', masked[0].maskImage.slice(0, 110), '…')
        console.log('    mask-size  :', masked[0].maskSize)
        check('it is the dissolve gradient', /linear-gradient/.test(masked[0].maskImage), '')
        check('it is sized to travel across the row', /245%/.test(masked[0].maskSize), masked[0].maskSize)
        const positions = [...new Set(masked.map(f => f.maskPosition))]
        check(
            'Animated actually drives mask-position frame by frame',
            positions.length > 3,
            `${positions.length} distinct values`
        )
    }

    // ── 2. the picture ──────────────────────────────────────────────────────────────────────────
    const gone = runFrames.find(f => f.coverage < 0.02)
    check('the line is erased down to nothing', !!gone, gone ? `by ${gone.t}ms` : 'never fell below 2%')

    // The direction. Sampled where the erasure is genuinely mid-flight, so a mask that ran the
    // wrong way could not pass by being caught at either end.
    const midFlight = runFrames.filter(f => f.coverage > 0.15 && f.coverage < 0.85)
    check('the erasure is observed mid-flight', midFlight.length > 0, `${midFlight.length} frames`)
    check(
        'RIGHT TO LEFT — the left half always outlives the right half',
        midFlight.length > 0 && midFlight.every(f => f.leftHalf > f.rightHalf),
        midFlight
            .slice(0, 12)
            .map(f => `${f.leftHalf.toFixed(2)}>${f.rightHalf.toFixed(2)}`)
            .join(' ')
    )
    const fronts = runFrames.filter(f => f.opaqueRight >= 0).map(f => f.opaqueRight)
    check(
        'the untouched edge only ever moves left',
        fronts.every((value, index) => index === 0 || value <= fronts[index - 1] + 2),
        ''
    )
    check(
        'the front crosses the whole row',
        fronts.length > 1 && Math.max(...fronts) > 800 && Math.min(...fronts) < 100,
        `${Math.max(...fronts)}px → ${Math.min(...fronts)}px`
    )
    check(
        'the line never comes back once a column has gone',
        runFrames.every((f, index) => index === 0 || f.coverage <= runFrames[index - 1].coverage + 0.02),
        ''
    )

    // ── 3. the dust and the celebration ─────────────────────────────────────────────────────────
    const withLayer = runFrames.filter(f => f.layerPresent)
    check('a particle layer is mounted for the exit', withLayer.length > 0, `${withLayer.length} frames`)
    check(
        'it carries the full set of dust motes and sparks',
        withLayer.length > 0 && withLayer[0].moteCount === 18 && withLayer[0].sparkCount === 9,
        `${withLayer.length ? withLayer[0].moteCount : 0} motes / ${withLayer.length ? withLayer[0].sparkCount : 0} sparks`
    )
    check(
        'the layer is bounded to the row — it can never escape to the viewport',
        withLayer.length > 0 &&
            withLayer[0].layerPosition === 'absolute' &&
            withLayer[0].layerBox.w <= ROW_WIDTH + 1 &&
            withLayer[0].layerBox.h <= ROW_HEIGHT + 1,
        withLayer.length ? `${withLayer[0].layerPosition} ${withLayer[0].layerBox.w}x${withLayer[0].layerBox.h}` : ''
    )
    check(
        'the dust is neutral grey and the sparks are not',
        withLayer.some(f => f.moteColor && /^rgb\((\d+), (\d+), (\d+)\)$/.test(f.moteColor)) &&
            withLayer.some(f => f.sparkArmColor && f.sparkArmColor !== f.moteColor),
        `mote ${withLayer[0].moteColor} spark ${withLayer[0].sparkArmColor}`
    )
    const moteOpacities = withLayer.map(f => (f.motes[0] ? f.motes[0].opacity : 0))
    check(
        'a mote fades in and back out rather than sitting there',
        Math.max(...moteOpacities) > 0.05 && moteOpacities[moteOpacities.length - 1] < 0.05,
        `peak ${Math.max(...moteOpacities)}`
    )
    const moteTops = withLayer.filter(f => f.motes[0]).map(f => f.motes[0].y)
    check(
        'the dust drifts upward',
        moteTops.length > 2 && Math.min(...moteTops) < moteTops[0],
        `${moteTops[0]} → ${Math.min(...moteTops)}`
    )
    /**
     * The one property that separates a spark from a mote at this size: a mote only ever shrinks,
     * a spark GROWS into its brightest frame and then goes. Measured on the painted box rather than
     * on the style, because that is the difference a user can actually see.
     */
    const sparkSizes = withLayer.filter(f => f.sparks[0]).map(f => f.sparks[0].w)
    const sparkOpacities = withLayer.filter(f => f.sparks[0]).map(f => f.sparks[0].opacity)
    check(
        'a spark twinkles — it grows into its peak and then goes',
        sparkSizes.length > 3 &&
            Math.max(...sparkSizes) > sparkSizes[0] * 1.5 &&
            Math.max(...sparkOpacities) > 0.1 &&
            sparkOpacities[sparkOpacities.length - 1] < 0.05,
        `${sparkSizes[0].toFixed(1)}px → ${Math.max(...sparkSizes).toFixed(1)}px, peak opacity ${Math.max(
            ...sparkOpacities
        )}`
    )
    check(
        'nothing is left behind once the run is over',
        !runFrames[runFrames.length - 1].layerPresent ||
            (runFrames[runFrames.length - 1].motes.every(m => m.opacity < 0.05) &&
                runFrames[runFrames.length - 1].sparks.every(s => s.opacity < 0.05)),
        ''
    )

    // ── 4. the clock, and the branch ────────────────────────────────────────────────────────────
    /**
     * Measured from the first frame the mask has MOVED, not from the first frame the paint visibly
     * changes: the grain's leading steps are gentle by design, so a coverage-based start reads the
     * exit as ~150ms shorter than it is. `mask-position` leaving 0% is the exit's actual first
     * frame.
     */
    const started = runFrames.find(f => f.maskPosition && !/^0%/.test(f.maskPosition))
    const flat = runFrames.find(f => f.rowHeight === 0)
    check('the line collapses to nothing', !!flat, flat ? `by ${flat.t}ms` : 'never reached 0')
    if (started && flat) {
        const span = flat.t - started.t
        // 1200ms, give or take one sampling interval at either end. Anything outside this is not
        // "the 1.2 seconds that were asked for".
        check('THE EXIT LASTS ~1.2 SECONDS', span >= 1100 && span <= 1350, `${span}ms of exit`)
    }
    check(
        'it waits for the celebration — the sweep gets all three of its stages first',
        !!started && started.t >= SWEEP_LEAD_MS - 100,
        started ? `first moved at ${started.t}ms, lead is ${SWEEP_LEAD_MS}ms` : 'never moved'
    )
    if (late) {
        check(
            'THE LATE VERDICT IS STILL HONOURED — the line disintegrates, it does not just settle',
            !!started && !!flat,
            'the board said "leaving" 900ms into a run that had already started'
        )
    }
    const collapsed = runFrames.filter(f => f.rowHeight !== null && f.rowHeight < ROW_HEIGHT && f.rowHeight > 0)
    check(
        'the gap closes only at the very end, after the line is already gone',
        collapsed.every(f => f.coverage < 0.05),
        `heights ${spark(collapsed.map(f => f.rowHeight))}`
    )
    const nextTops = runFrames.map(f => f.nextRowTop).filter(v => v !== null)
    check(
        'the board closes the gap the line leaves behind',
        Math.min(...nextTops) < Math.max(...nextTops) - 40,
        `${Math.max(...nextTops)} → ${Math.min(...nextTops)}`
    )

    /**
     * THE BACKSTOP. Nothing here ever unmounts the line, which is precisely the situation
     * `EXIT_RECOVERY_MS` exists for: if the board does not drop the block, an erased and collapsed
     * row would otherwise sit there forever — present, unclickable and invisible until something
     * remounted it. A line that reappears half a second late is a cosmetic oddity; that is a bug a
     * user has to reload to clear.
     */
    const afterRun = frames.filter(f => f.t > SWEEP_LEAD_MS + DISINTEGRATION_MS + 200)
    const recovered = afterRun.find(f => f.rowHeight === ROW_HEIGHT && f.coverage > 0.98)
    check(
        'an exit the board never finished puts the line back rather than leaving an invisible hole',
        !!recovered,
        recovered
            ? `restored by ${recovered.t}ms`
            : `never restored (last height ${afterRun.length ? afterRun[afterRun.length - 1].rowHeight : 'n/a'})`
    )

    // ── recovery ────────────────────────────────────────────────────────────────────────────────
    /**
     * A new task landing in the project mid-exit flips the board's verdict back. Without the
     * recovery in `useProjectCompletedSweepMotion` the header would be left masked to nothing and
     * collapsed to zero height: present, unclickable and invisible until something remounted it.
     */
    await page.evaluate(() => window.__setLeaving(false))
    await sleep(150)
    const restored = await page.evaluate(() => window.__measure())
    const after = await shot()
    check(
        'a line that stops leaving is put back whole — no mask, no particles, full height',
        (!restored.maskImage || restored.maskImage === 'none') &&
            !restored.layerPresent &&
            restored.rowHeight === ROW_HEIGHT &&
            after.coverage > 0.98,
        `height ${restored.rowHeight} coverage ${after.coverage.toFixed(3)}`
    )

    return finish(browser, server)
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
