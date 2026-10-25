/**
 * AT-2460 browser-level verification.
 *
 * "The celebration of empty inbox in All Projects > Tasks should be much more celebratory /
 *  longer. Also the new placement of the green dot should be a bigger deal."
 *
 * Driven in real Chromium against the real composition (see harness.entry.js). Everything asserted
 * here is a fact about pixels that jsdom cannot produce: element boxes, computed `position`, hit
 * testing, and values sampled while `requestAnimationFrame` is genuinely running.
 *
 * Six checks, in the order the user experiences them:
 *
 *   1. The confetti covers the WHOLE VIEWPORT — the point of the task — and keeps falling for
 *      seconds rather than a moment.
 *   2. It cannot take the page hostage: `pointer-events: none` all the way up, so a click in the
 *      middle of the confetti still lands on the page underneath.
 *   3. The dot is HELD BACK while the congratulation has the screen, instead of doing its whole
 *      beat before the eye arrives (the AT-2418 failure).
 *   4. The dot then GROWS several times past its cell and holds there — an 11px square in a
 *      53-column grid is not findable any other way.
 *   5. The card is outlined and the dot is labelled, so there is something to follow down the page
 *      and something that says what the dot was worth.
 *   6. It all settles back to exactly the cell a reload paints, leaving nothing behind.
 *
 * Then the whole thing again under `prefers-reduced-motion: reduce`, where the rule is the
 * opposite: the information is there and not one decorative layer is.
 *
 * Requirements (this does NOT run in CI's Jest jobs):
 *   nvm use 22
 *   (cd web-bundler && npm install)
 *   cp -R -f replacement_node_modules/* node_modules/
 *   npx playwright install chromium
 * Usage:
 *   node browser-tests/at2460/run.js
 */
const path = require('path')
const http = require('http')
const fs = require('fs')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const ENTRY = path.join(__dirname, 'harness.entry.js')
// Overridable so the frames can be collected somewhere they will be looked at.
const SHOT_DIR = process.env.HARNESS_SHOT_DIR || BUILD_DIR

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>AT-2460</title>
<style>
  html, body, #root { margin:0; padding:0; height:100%; box-sizing:border-box; }
  body { display:flex; overflow-y:auto; }
  #root { flex-shrink:0; flex-basis:auto; flex-grow:1; display:flex; flex:1; }
</style></head>
<body><div id="root"></div><script src="/harness.js"></script></body></html>`

function build() {
    const webpackBin = path.join(ROOT, 'web-bundler', 'node_modules', '.bin', 'webpack')
    if (!fs.existsSync(webpackBin)) {
        throw new Error('web-bundler dependencies are missing. Run: (cd web-bundler && npm install)')
    }
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
        { cwd: path.join(ROOT, 'web-bundler'), stdio: 'inherit' }
    )
    fs.writeFileSync(path.join(BUILD_DIR, 'index.html'), HTML)
}

function serve() {
    const server = http.createServer((req, res) => {
        const url = req.url.split('?')[0]
        const file = path.join(BUILD_DIR, url === '/' ? 'index.html' : url)
        if (!file.startsWith(BUILD_DIR) || !fs.existsSync(file)) {
            res.writeHead(404)
            res.end('not found')
            return
        }
        res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : 'application/javascript' })
        res.end(fs.readFileSync(file))
    })
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)))
}

function requirePlaywright() {
    try {
        return require('playwright')
    } catch (error) {
        const fallback = path.join(process.env.PLAYWRIGHT_HOME || '/home/user/repro', 'node_modules', 'playwright')
        return require(fallback)
    }
}

const VIEWPORT = { width: 1280, height: 900 }

async function openBoard(browser, { reducedMotion } = {}) {
    // A fresh context each time: the once-per-day marker lives in localStorage, so a shared one
    // would silently make the second run a no-celebration run and every assertion below vacuous.
    const context = await browser.newContext({ viewport: VIEWPORT, reducedMotion })
    const page = await context.newPage()
    const pageErrors = []
    page.on(
        'pageerror',
        error =>
            error.message !== 'Event' &&
            pageErrors.push(process.env.HARNESS_DEBUG ? error.stack || error.message : error.message)
    )
    if (process.env.HARNESS_DEBUG) page.on('console', m => console.log(`[console.${m.type()}] ${m.text()}`))
    await page.route('**://*.google*/**', route => route.abort())

    return { context, page, pageErrors }
}

const check = (failures, label, condition, detail) => {
    if (condition) {
        console.log(`  ok    ${label}`)
        return
    }
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
    failures.push(label)
}

async function run() {
    fs.mkdirSync(BUILD_DIR, { recursive: true })
    fs.mkdirSync(SHOT_DIR, { recursive: true })
    build()
    const server = await serve()
    const port = server.address().port
    const { chromium } = requirePlaywright()
    const browser = await chromium.launch()
    const failures = []

    try {
        // ---------------------------------------------------------------- animated
        const animated = await openBoard(browser)
        await animated.page.goto(`http://127.0.0.1:${port}/`)
        await animated.page.waitForFunction(() => window.__ready === true && !!window.__measure)

        // The page captured every beat on its own clock; wait for the last one and read them all.
        await animated.page.waitForFunction(() => window.__framesDone === true, null, { timeout: 15000 })
        const frames = await animated.page.evaluate(() => window.__frames)

        if (process.env.HARNESS_DEBUG) console.log(JSON.stringify(frames, null, 2))

        console.log('\nanimated:')

        const opening = frames.opening
        const hold = frames.hold
        const settled = frames.settled

        // 1. The confetti covers the whole viewport, not one block of it.
        check(
            failures,
            'confetti is a viewport-wide fixed layer',
            opening.pageLayer &&
                opening.pageLayer.position === 'fixed' &&
                opening.pageLayer.width >= VIEWPORT.width - 1 &&
                opening.pageLayer.height >= VIEWPORT.height - 1,
            JSON.stringify(opening.pageLayer)
        )
        const spread = opening.pieces.length
            ? Math.max(...opening.pieces.map(p => p.x)) - Math.min(...opening.pieces.map(p => p.x))
            : 0
        check(
            failures,
            'pieces are spread across the full width',
            spread > VIEWPORT.width * 0.8,
            `spread ${Math.round(spread)}px of ${VIEWPORT.width}px across ${opening.pieces.length} pieces`
        )
        // 2. ...and it is still going seconds later. This is the "longer" half of the task, and it
        //    is the one thing a duration constant alone cannot prove: the pieces have to still be
        //    on screen.
        check(
            failures,
            'confetti is still falling at 2.4s',
            frames.late.pieces.length > 0 && !!frames.late.pageLayer,
            `${frames.late.pieces.length} pieces`
        )

        // 3. It cannot take the page hostage.
        const chain = hold.hitCentre
        check(
            failures,
            'nothing in the confetti layer can swallow a click',
            Array.isArray(chain) && !chain.some(node => node.testID && node.testID.startsWith('empty-inbox-confetti')),
            JSON.stringify(chain && chain.slice(0, 3))
        )

        // 4. The dot is held back while the congratulation has the screen. `opacity` is the
        //    honest probe: the fill is mounted from the first frame, and what the staging changes
        //    is whether it has been painted yet.
        check(
            failures,
            'the dot has not landed yet during the opening beat',
            opening.dotFill && opening.dotFill.opacity < 0.5,
            opening.dotFill && `opacity ${opening.dotFill.opacity}`
        )
        check(
            failures,
            'the card is not lit during the opening beat',
            !opening.spotlight || opening.spotlight.opacity < 0.5,
            opening.spotlight && `opacity ${opening.spotlight.opacity}`
        )

        // 5. ...and then it is unmissable. The cell is 11px; anything under ~30px here means the
        //    swell is not happening in a real browser however green the unit tests are.
        const cellSize = settled.dotCell ? settled.dotCell.width : 11
        check(
            failures,
            'the dot swells well past its grid cell',
            hold.dotFill && hold.dotFill.width > cellSize * 2.5,
            hold.dotFill && `${Math.round(hold.dotFill.width)}px against a ${Math.round(cellSize)}px cell`
        )
        check(
            failures,
            'the cell itself never changes size, so the grid cannot move',
            hold.dotCell &&
                settled.dotCell &&
                Math.abs(hold.dotCell.width - settled.dotCell.width) < 0.5 &&
                Math.abs(hold.dotCell.x - settled.dotCell.x) < 0.5,
            `${JSON.stringify(hold.dotCell)} vs ${JSON.stringify(settled.dotCell)}`
        )

        // 6. The badge says what the dot was worth, and stays inside the card.
        check(failures, 'the dot is labelled while it is swollen', !!hold.callout, 'no callout rendered')
        check(
            failures,
            'the label never overhangs the card',
            hold.callout &&
                hold.spotlight &&
                hold.callout.x >= hold.spotlight.x &&
                hold.callout.right <= hold.spotlight.right,
            `callout ${JSON.stringify(hold.callout && [hold.callout.x, hold.callout.right])} card ${JSON.stringify(
                hold.spotlight && [hold.spotlight.x, hold.spotlight.right]
            )}`
        )
        check(
            failures,
            'the card is outlined while the dot is being added',
            hold.spotlight && hold.spotlight.opacity > 0.5,
            hold.spotlight && `opacity ${hold.spotlight.opacity}`
        )

        // 7. And it all goes away, leaving the cell a reload would paint.
        check(failures, 'the confetti is gone once the run is over', !settled.pageLayer && !settled.burstLayer)
        check(failures, 'the callout and the card outline are gone', !settled.callout && !settled.spotlight)
        check(
            failures,
            'the dot settles back to exactly its cell',
            settled.dotFill &&
                settled.dotCell &&
                Math.abs(settled.dotFill.width - settled.dotCell.width) < 0.5 &&
                settled.dotFill.opacity > 0.99,
            settled.dotFill && `${settled.dotFill.width}px at opacity ${settled.dotFill.opacity}`
        )
        check(failures, 'no page errors', animated.pageErrors.length === 0, animated.pageErrors.join(' | '))

        await animated.context.close()

        // ----------------------------------------------------------------- frames
        // A SECOND page load, for pictures only. Screenshotting costs a few hundred milliseconds
        // each, which is a large fraction of a beat — taking them on the measured run silently
        // pushes every later sample past the beat it was aimed at, and the "the dot swells" check
        // starts reporting the settled dot. So the run that decides pass/fail never screenshots,
        // and the run that screenshots never decides anything.
        const capture = await openBoard(browser)
        await capture.page.goto(`http://127.0.0.1:${port}/`)
        await capture.page.waitForFunction(() => window.__ready === true && !!window.__measure)
        const marks = await capture.page.evaluate(() => window.__MARKS)
        let capturedAt = 0
        for (const [name, at] of marks) {
            await capture.page.waitForTimeout(Math.max(0, at - capturedAt))
            capturedAt = at
            await capture.page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) })
        }
        await capture.context.close()
        console.log(`\nframes written to ${SHOT_DIR}`)

        // ---------------------------------------------------- prefers-reduced-motion
        const reduced = await openBoard(browser, { reducedMotion: 'reduce' })
        await reduced.page.goto(`http://127.0.0.1:${port}/`)
        await reduced.page.waitForFunction(() => window.__ready === true && !!window.__measure)
        // `useReducedMotion` resolves from a promise, so give it a beat to land before reading.
        await reduced.page.waitForTimeout(600)
        const still = await reduced.page.evaluate(() => window.__measure())

        console.log('\nprefers-reduced-motion: reduce:')
        check(
            failures,
            'the information is there — the day is green at full size',
            still.dotFill && still.dotCell && Math.abs(still.dotFill.width - still.dotCell.width) < 0.5,
            JSON.stringify([still.dotFill, still.dotCell])
        )
        check(failures, 'the congratulation is on screen', !!still.headline)
        check(
            failures,
            'not one decorative layer is rendered',
            !still.pageLayer && !still.burstLayer && !still.callout && !still.spotlight && still.pieces.length === 0,
            JSON.stringify({
                page: !!still.pageLayer,
                burst: !!still.burstLayer,
                callout: !!still.callout,
                spotlight: !!still.spotlight,
                pieces: still.pieces.length,
            })
        )
        check(failures, 'no page errors', reduced.pageErrors.length === 0, reduced.pageErrors.join(' | '))
        await reduced.page.screenshot({ path: path.join(SHOT_DIR, 'reduced-motion.png') })
        await reduced.context.close()
    } finally {
        await browser.close()
        server.close()
    }

    if (failures.length) {
        console.error(`\n${failures.length} check(s) failed:\n  - ${failures.join('\n  - ')}`)
        process.exit(1)
    }
    console.log('\nAT-2460: all checks passed.')
}

run().catch(error => {
    console.error(error)
    process.exit(1)
})
