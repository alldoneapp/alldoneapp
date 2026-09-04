/**
 * AT-2507 browser-level test — the goal flourish, actually painting.
 *
 * The smallest of the app's four completion celebrations, and the only place it can ever be seen:
 * `__mocks__/react-native.js` stubs `Animated.timing` with a no-op `{start}`, so a jest suite can
 * assert on every one of this feature's rules and still be looking at an animation that never moves
 * a pixel. That is not hypothetical here — it is exactly how AT-2492's sweep shipped invisible.
 *
 * What is checked, in the order the run happens:
 *
 *   0. the TRIGGER — completing the first of two tasks paints nothing; completing the last starts
 *      a run. Driven through the real `publishGoalTaskCompletion`, the same call the task row makes.
 *   1. FILL    the bar grows across the card and the wash fades in behind it
 *   2. PULSE   the bar thickens for one breath and comes back
 *   3. FADE    every layer goes, and the card is handed back with nothing painted on it
 *   4. BUDGET  the whole run is over before the completing task's write would take the row away
 *
 * Requirements (not part of CI's Jest jobs):
 *   nvm use 22
 *   (cd web-bundler && npm install)
 *   cp -R -f replacement_node_modules/* node_modules/
 *   npx playwright install chromium
 * Usage:
 *   node browser-tests/at2507/run.js
 *   node browser-tests/at2507/run.js --reduce-motion
 */
const path = require('path')
const http = require('http')
const fs = require('fs')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const ENTRY = path.join(__dirname, 'harness.entry.js')

/** Kept in step with `goalCompletedFlourishMotion.js` / `taskCompletionMotion.js`. */
const GOAL_FLOURISH_TOTAL_MS = 900
const COMPLETION_HOLD_MS = 1070

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>AT-2507</title>
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

async function main() {
    const reduceMotion = process.argv.includes('--reduce-motion')
    build()
    const server = await serve()
    const port = server.address().port
    const { chromium } = require('playwright')
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    const page = await browser.newPage({
        viewport: { width: 800, height: 400 },
        reducedMotion: reduceMotion ? 'reduce' : 'no-preference',
    })
    page.on('pageerror', e => console.log('PAGE ERROR:', e.message))
    await page.goto(`http://127.0.0.1:${port}/`)
    await page.waitForFunction('window.__ready === true')
    // Let the reduce-motion preference resolve before anything can be claimed.
    await sleep(150)

    console.log(`\n--- mode: ${reduceMotion ? 'prefers-reduced-motion: reduce' : 'normal motion'} ---\n`)

    const finish = async () => {
        await browser.close()
        server.close()
        const failures = results.filter(r => !r.ok)
        console.log(`\n${results.length - failures.length}/${results.length} checks passed`)
        process.exit(failures.length ? 1 : 0)
    }

    // ── the trigger ──────────────────────────────────────────────────────────────────────────────
    // The goal still has a second task on it, so finishing the first one is not an achievement.
    await page.evaluate(() => window.__completeTask('t1'))
    await sleep(60)
    const afterFirst = await page.evaluate(() => ({ runId: window.__runId, painted: window.__measure().present }))
    check('a goal with work left on it is not celebrated', afterFirst.runId === 0 && !afterFirst.painted, '')

    await page.evaluate(() => window.__completeTask('t2'))
    await sleep(30)
    const runId = await page.evaluate(() => window.__runId)
    check('finishing the last task of the goal starts a run', runId === 1, `runId=${runId}`)

    /**
     * Under reduced motion the CONTRACT INVERTS. The flourish deliberately draws nothing — the goal
     * section emptying already says the work is done, so unlike the task row's progress bar there is
     * no information here worth a static frame — while the TRIGGER still fires, because whether the
     * row animates is a separate question from whether the work was finished.
     */
    if (reduceMotion) {
        await sleep(400)
        const painted = await page.evaluate(() => window.__measure())
        check('reduced motion — nothing is painted on the card', !painted.present, '')
        return finish()
    }

    // ── the run, sampled every 40ms so each of the three beats gets several frames ────────────────
    const SAMPLE_MS = 40
    const SAMPLES = 32
    const frames = []
    for (let i = 0; i < SAMPLES; i++) {
        frames.push({ t: i * SAMPLE_MS, ...(await page.evaluate(() => window.__measure())) })
        await sleep(SAMPLE_MS)
    }

    const present = frames.filter(f => f.present)
    check('the flourish is mounted and painted', present.length > 0, `${present.length}/${SAMPLES} frames`)

    if (present.length) {
        const cardWidth = present[0].overlay.width
        const at = key => present.map(f => f[key])
        const spark = values => values.map(v => (v === null ? '-' : v)).join(' ')

        console.log('    overlay box :', JSON.stringify(present[0].overlay))
        console.log('    bar colour  :', present[0].barColor)
        console.log('    wash colour :', present[0].washColor)
        console.log('    bar width   :', spark(at('barWidth')))
        console.log('    bar height  :', spark(at('barHeight')))
        console.log('    wash opacity:', spark(at('washOpacity')))
        console.log('    overlay op. :', spark(at('overlayOpacity')))

        // ── stage 1: the fill ────────────────────────────────────────────────────────────────────
        const barWidths = at('barWidth').filter(v => v !== null)
        const maxBar = Math.max(...barWidths)
        check('stage 1 — the bar actually grows (the animation advances)', maxBar > 40, `max painted ${maxBar}px`)
        check(
            'stage 1 — the bar reaches the full width of the card',
            maxBar > cardWidth * 0.95,
            `${maxBar}px of ${cardWidth}px`
        )
        check(
            'stage 1 — it grows from the left edge, not from the middle',
            // `transform-origin: left bottom`. Growing from the centre would keep `left` moving
            // leftwards as the bar widens, which is what makes it stop reading as progress.
            at('barLeft')
                .filter(v => v !== null)
                .every(left => Math.abs(left) <= 2),
            `left offsets ${Array.from(new Set(at('barLeft'))).join(',')}`
        )
        const washOpacities = at('washOpacity').filter(v => v !== null)
        check(
            'stage 1 — the wash fades in behind it',
            Math.max(...washOpacities) > 0.5 && Math.min(...washOpacities) < 0.5,
            `${Math.min(...washOpacities)} → ${Math.max(...washOpacities)}`
        )

        // ── stage 2: the breath ──────────────────────────────────────────────────────────────────
        // It must rise AND come back: a bar left thick is a visible residue on a row that stays.
        const barHeights = at('barHeight').filter(v => v !== null)
        const peakHeight = Math.max(...barHeights)
        const baseHeight = Math.min(...barHeights)
        check(
            'stage 2 — the bar thickens for one breath',
            peakHeight > baseHeight + 0.5,
            `${baseHeight}px → ${peakHeight}px`
        )
        const peakIndex = barHeights.indexOf(peakHeight)
        check(
            'stage 2 — and settles back to its resting thickness',
            barHeights.slice(peakIndex).some(h => h <= baseHeight + 0.2),
            `ends at ${barHeights[barHeights.length - 1]}px`
        )
        /**
         * The breath brightens the WASH too, and this is the check that earns its keep: the first
         * version of the fill took the wash to opacity 1 and had the breath add on top of it, which
         * the browser clamps — so the layer sat pinned at 1 for the whole confirmation and the beat
         * silently did nothing. No jest assertion can see that (nothing is painted there and the
         * `Animated.Value` arithmetic is perfectly correct); only a computed opacity can.
         */
        // The plateau is read from the END of the run rather than from before the breath: the wash
        // keeps its own opacity through stage 3 (the fade is applied once, on the overlay above it),
        // so the last sample IS where the fill settled — and it has to be the same value the breath
        // returned to.
        const washPlateau = washOpacities[washOpacities.length - 1]
        const washPeak = Math.max(...washOpacities)
        check(
            'stage 2 — the wash brightens for the breath instead of clamping at full',
            washPeak > washPlateau + 0.05 && washPeak <= 1 && washPlateau < 1,
            `settles ${washPlateau}, peaks ${washPeak}`
        )

        // ── stage 3: the fade ────────────────────────────────────────────────────────────────────
        const overlayOpacities = at('overlayOpacity').filter(v => v !== null)
        check(
            'stage 3 — every layer fades out together',
            Math.min(...overlayOpacities) < 0.5,
            `min overlay opacity ${Math.min(...overlayOpacities)}`
        )

        // ── geometry ─────────────────────────────────────────────────────────────────────────────
        check(
            'the overlay covers the goal card and nothing beyond it',
            present[0].overlay.height > 10 && present[0].overlay.width === present[0].cardWidth,
            `${present[0].overlay.width}x${present[0].overlay.height} vs card ${present[0].cardWidth}`
        )
        check(
            'it paints in the goal accent, not the task green',
            present[0].barColor === 'rgb(108, 99, 255)',
            present[0].barColor
        )
    }

    // ── nothing is left behind ───────────────────────────────────────────────────────────────────
    // The goal row USUALLY STAYS on the board after being cleared (as an `EmptyGoal` with its
    // add-task line), so a bar left painted here would be permanent, not a frame nobody sees.
    await sleep(400)
    const settled = await page.evaluate(() => window.__measure())
    check('the card is handed back with nothing painted on it', !settled.present, '')

    // ── the budget ───────────────────────────────────────────────────────────────────────────────
    const lastPaintedAt = present.length ? present[present.length - 1].t : 0
    check(
        'the whole run fits inside the completing task write hold',
        lastPaintedAt < COMPLETION_HOLD_MS,
        `last painted frame at ${lastPaintedAt}ms, budget ${GOAL_FLOURISH_TOTAL_MS}ms of ${COMPLETION_HOLD_MS}ms`
    )

    return finish()
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
