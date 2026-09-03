/**
 * AT-2495 browser-level test — the row disintegration, actually erasing pixels.
 *
 * The user asked for the completed task row to come apart into dust, right to left, over 1.2
 * seconds. Three things about that are unobservable from jest and are checked here instead:
 *
 *   1. THE PASSTHROUGH. The whole erasure is a CSS mask, applied through react-native-web's style
 *      pipeline and animated through `Animated`'s per-frame `setNativeProps`. jsdom drops CSS
 *      properties it does not implement without a word, so a jsdom test reports the same empty
 *      string whether the code is right or completely wrong.
 *   2. THE PICTURE. A style object is not a paint. The row is screenshotted every ~60ms and its
 *      surviving pixels are counted per column, which is the only measurement that can tell
 *      "a mask is applied" apart from "the mask erases the correct half in the correct order".
 *   3. THE CLOCK. `__mocks__/react-native.js` replaces `Animated.timing` with a no-op `{start}`
 *      stub, so no jest suite in this repo has ever watched this animation advance by one frame.
 *
 * `--reduce-motion` asserts the INVERTED contract: no mask, no dust, no 1.2s — a reduced-motion
 * user gets the static frame and a short hold, which is the whole point of the fallback.
 *
 * Requirements (not part of CI's Jest jobs):
 *   nvm use 22
 *   (cd web-bundler && npm install)
 *   cp -R -f replacement_node_modules/* node_modules/
 *   npx playwright install chromium
 * Usage:
 *   node browser-tests/at2495/run.js [--reduce-motion]
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

async function main() {
    const reduceMotion = process.argv.includes('--reduce-motion')
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
    // `useReducedMotion` resolves its preference a microtask deep; the claim below must see it.
    await sleep(200)

    console.log(`\n--- mode: ${reduceMotion ? 'prefers-reduced-motion: reduce' : 'normal motion'} ---\n`)

    const clip = { x: 0, y: 0, width: 900, height: 48 }
    const shot = async () => {
        const dataUrl = `data:image/png;base64,${(await page.screenshot({ clip })).toString('base64')}`
        return survival(await page.evaluate(url => window.__scan(url), dataUrl))
    }

    const before = await shot()
    check(
        'the row is fully painted before anything happens',
        before.coverage > 0.98,
        `coverage ${before.coverage.toFixed(3)}`
    )

    const holdMs = await page.evaluate(() => {
        window.__t0 = performance.now()
        return window.__begin({ isCompletion: true })
    })
    console.log(`    begin() asked the caller to hold its write for ${holdMs}ms`)

    // The whole hold plus a margin, sampled as fast as a screenshot + decode allows (~50ms a
    // frame). It has to outlast the LAST mote, which lifts off near the row's left edge well
    // after the mask has finished with it.
    const frames = []
    for (let i = 0; i < 46; i += 1) {
        const measured = await page.evaluate(() => window.__measure())
        frames.push({ ...measured, ...(await shot()) })
        await sleep(20)
    }

    const spark = values => values.map(v => (v === null || v === undefined ? '-' : v)).join(' ')
    console.log('    t (ms)     :', spark(frames.map(f => f.t)))
    console.log('    coverage   :', spark(frames.map(f => f.coverage.toFixed(2))))
    console.log('    opaqueRight:', spark(frames.map(f => f.opaqueRight)))
    console.log('    row height :', spark(frames.map(f => f.rowHeight)))
    console.log('    mask pos   :', spark(frames.map(f => (f.maskPosition || '').split(' ')[0] || '-')))
    console.log('    motes      :', spark(frames.map(f => f.moteCount)))

    if (reduceMotion) {
        /**
         * The contract inverts. A 1.2s dissolve is exactly what somebody who has asked for reduced
         * motion has asked not to see, so the row keeps no mask, sheds no dust and never collapses
         * — `useTaskCompletionMotion` shows a static completion frame and answers a short hold.
         */
        check(
            'reduced motion — the row is never masked',
            frames.every(f => !f.maskImage || f.maskImage === 'none'),
            ''
        )
        check(
            'reduced motion — no dust layer is mounted',
            frames.every(f => !f.dustPresent),
            ''
        )
        check(
            'reduced motion — the row never collapses',
            frames.every(f => f.rowHeight === null || f.rowHeight >= 48),
            `heights ${[...new Set(frames.map(f => f.rowHeight))].join(',')}`
        )
        check('reduced motion — the hold is short', holdMs <= 400, `${holdMs}ms`)
        await browser.close()
        server.close()
        const failed = results.filter(r => !r.ok)
        console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
        process.exit(failed.length ? 1 : 0)
    }

    // ── 1. the passthrough ──────────────────────────────────────────────────────────────────────
    const masked = frames.filter(f => f.maskImage && f.maskImage !== 'none')
    check('the mask reaches the DOM at all', masked.length > 0, `${masked.length}/${frames.length} frames`)
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
    const gone = frames.find(f => f.coverage < 0.02)
    check('the row is erased down to nothing', !!gone, gone ? `by ${gone.t}ms` : 'never fell below 2%')

    // The direction. Sampled where the erasure is genuinely mid-flight, so a mask that ran the
    // wrong way could not pass by being caught at either end.
    const midFlight = frames.filter(f => f.coverage > 0.15 && f.coverage < 0.85)
    check('the erasure is observed mid-flight', midFlight.length > 0, `${midFlight.length} frames`)
    check(
        'RIGHT TO LEFT — the left half always outlives the right half',
        midFlight.length > 0 && midFlight.every(f => f.leftHalf > f.rightHalf),
        midFlight.map(f => `${f.leftHalf.toFixed(2)}>${f.rightHalf.toFixed(2)}`).join(' ')
    )
    const fronts = frames.filter(f => f.opaqueRight >= 0).map(f => f.opaqueRight)
    check(
        'the untouched edge only ever moves left',
        fronts.every((value, index) => index === 0 || value <= fronts[index - 1] + 2),
        spark(fronts)
    )
    check(
        'the front crosses the whole row',
        fronts.length > 1 && Math.max(...fronts) > 800 && Math.min(...fronts) < 100,
        `${Math.max(...fronts)}px → ${Math.min(...fronts)}px`
    )
    check(
        'the row never comes back once a column has gone',
        frames.every((f, index) => index === 0 || f.coverage <= frames[index - 1].coverage + 0.02),
        ''
    )

    // ── the dust ────────────────────────────────────────────────────────────────────────────────
    const withDust = frames.filter(f => f.dustPresent)
    check('a dust layer is mounted for the exit', withDust.length > 0, `${withDust.length} frames`)
    check(
        'it carries the full set of motes',
        withDust.length > 0 && withDust[0].moteCount === 18,
        `${withDust.length ? withDust[0].moteCount : 0} motes`
    )
    const moteOpacities = withDust.map(f => (f.mote ? f.mote.opacity : 0))
    check(
        'a mote fades in and back out rather than sitting there',
        Math.max(...moteOpacities) > 0.05 && moteOpacities[moteOpacities.length - 1] < 0.05,
        `peak ${Math.max(...moteOpacities)}`
    )
    const motePositions = withDust.filter(f => f.mote).map(f => f.mote.y)
    check(
        'the dust drifts upward',
        motePositions.length > 2 && Math.min(...motePositions) < motePositions[0],
        `${motePositions[0]} → ${Math.min(...motePositions)}`
    )

    // ── 3. the clock ────────────────────────────────────────────────────────────────────────────
    /**
     * Measured from the first frame the mask has MOVED, not from the first frame the paint visibly
     * changes: the grain's leading steps are gentle by design, so a coverage-based start reads the
     * exit as ~150ms shorter than it is. `mask-position` leaving 0% is the exit's actual first
     * frame.
     */
    const started = frames.find(f => f.maskPosition && !/^0%/.test(f.maskPosition))
    const flat = frames.find(f => f.rowHeight === 0)
    check('the row collapses to nothing', !!flat, flat ? `by ${flat.t}ms` : 'never reached 0')
    if (started && flat) {
        const span = flat.t - started.t
        // 1200ms, give or take one ~50ms sampling interval at either end. Anything outside this is
        // not "the 1.2 seconds that were asked for".
        check('THE EXIT LASTS ~1.2 SECONDS', span >= 1100 && span <= 1350, `${span}ms of exit`)
    }
    check(
        'and it does not start before the celebration has finished',
        !!started && started.t >= 600,
        started ? `first moved at ${started.t}ms` : 'never moved'
    )
    const collapsed = frames.filter(f => f.rowHeight !== null && f.rowHeight < 48 && f.rowHeight > 0)
    check(
        'the gap closes only at the very end, after the row is already gone',
        collapsed.every(f => f.coverage < 0.05),
        `heights ${spark(collapsed.map(f => f.rowHeight))}`
    )
    const nextTops = frames.map(f => f.nextRowTop).filter(v => v !== null)
    check(
        'the list closes the gap the row leaves behind',
        Math.min(...nextTops) < Math.max(...nextTops) - 40,
        `${Math.max(...nextTops)} → ${Math.min(...nextTops)}`
    )

    // ── failure recovery ────────────────────────────────────────────────────────────────────────
    await page.evaluate(() => window.__cancel())
    await sleep(120)
    const restored = await page.evaluate(() => window.__measure())
    const after = await shot()
    check(
        'a failed write puts the whole row back — no mask, no dust, full height',
        (!restored.maskImage || restored.maskImage === 'none') &&
            !restored.dustPresent &&
            restored.rowHeight === 48 &&
            after.coverage > 0.98,
        `height ${restored.rowHeight} coverage ${after.coverage.toFixed(3)}`
    )

    await browser.close()
    server.close()
    const failed = results.filter(r => !r.ok)
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
    process.exit(failed.length ? 1 : 0)
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
