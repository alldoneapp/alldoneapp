/**
 * AT-2449 browser-level regression test.
 *
 * "After swiping left on a task and then dismissing the postpone popup by
 *  clicking next to it, I can no longer click into the task in the task list view"
 *
 * Driven in real Chromium against the real composition (see harness.entry.js):
 *
 *   1. Left-swipe the first row with the real mouse → the postpone popup opens.
 *   2. Dismiss it with a real click next to it → the popup goes away.
 *   3. Click the row's title → edit mode must open.
 *   4. Same for the NEIGHBOUR row — the reported symptom is about the list, and a
 *      global flag left set wedges every row, not just the swiped one.
 *   5. Then the whole thing again on the task list's GOAL row (AT-2449
 *      follow-up). A goal reaches the same popup by a different route — its
 *      `onRightSwipe` DEFERS the dispatch to a `setTimeout` and its press target
 *      is not gated on the popup being visible — which is why the first fix for
 *      (3) regressed it and why (1)-(4) could not have caught that. This step is
 *      the A/B that found it: run it against the commit before the fix and the
 *      goal swipe opens the popup while the task click is dead; run it against
 *      the fix alone and they swap over.
 *
 * Requirements (this does NOT run in CI's Jest jobs):
 *   nvm use 22
 *   (cd web-bundler && npm install)
 *   cp -R -f replacement_node_modules/* node_modules/
 *   npx playwright install chromium
 * Usage:
 *   node browser-tests/at2449/run.js
 */
const path = require('path')
const http = require('http')
const fs = require('fs')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const ENTRY = path.join(__dirname, 'harness.entry.js')

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>AT-2449</title>
<style>
  html, body, #root { margin:0; padding:0; height:100%; box-sizing:border-box; }
  body { display:flex; overflow-y:auto; }
  #root { flex-shrink:0; flex-basis:auto; flex-grow:1; display:flex; flex:1; }
  * { flex-basis: auto !important; }
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

// A left swipe: press inside the row, drag left past `rightThreshold` (80) with
// enough intermediate points that Hammer's pan recogniser sees a real gesture.
async function swipeLeft(page, taskId) {
    const point = await page.evaluate(id => window.__rowPoint(id), taskId)
    if (!point) throw new Error(`could not locate row ${taskId}`)
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    for (let step = 1; step <= 18; step++) {
        await page.mouse.move(point.x - step * 20, point.y, { steps: 2 })
        await page.waitForTimeout(10)
    }
    if (process.env.HARNESS_DEBUG) {
        console.log(
            '  mid-swipe transforms:',
            JSON.stringify(await page.evaluate(id => window.__rowTranslate(id), taskId))
        )
    }
    await page.mouse.up()
}

async function clickTitle(page, taskId, word) {
    const point = await page.evaluate(args => window.__pressPoint(args.id, args.word), {
        id: `line-${taskId}`,
        word,
    })
    if (!point) throw new Error(`could not locate the title of ${taskId}`)
    await page.mouse.click(point.x, point.y)
}

async function run() {
    fs.mkdirSync(BUILD_DIR, { recursive: true })
    build()
    const server = await serve()
    const port = server.address().port
    const { chromium } = requirePlaywright()
    const browser = await chromium.launch()
    const failures = []
    const debug = !!process.env.HARNESS_DEBUG

    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const pageErrors = []
    page.on('pageerror', error => {
        const message = debug ? error.stack || error.message : error.message
        if (message !== 'Event') pageErrors.push(message)
    })
    page.on('console', message => debug && console.log(`[console.${message.type()}] ${message.text()}`))
    await page.route('**://*.google*/**', route => route.abort())
    await page.goto(`http://127.0.0.1:${port}/`)

    try {
        await page.waitForFunction(
            () => window.__ready === true && !!window.__rowPoint && !!window.__rowPoint('task-1')
        )
    } catch (error) {
        console.error('harness never became ready.')
        console.error(`  page errors: ${JSON.stringify(pageErrors)}`)
        console.error(`  body: ${(await page.evaluate(() => document.body.innerHTML)).slice(0, 2000)}`)
        throw error
    }

    const report = async label => {
        const state = await page.evaluate(() => window.__state())
        const popovers = await page.evaluate(() => window.__popoverCount())
        const editors = await page.evaluate(() => window.__editorCount())
        console.log(`  [${label}] ${JSON.stringify({ ...state, popovers, editors })}`)
        return { state, popovers, editors }
    }

    // --- Sanity: the row opens before any of this happens. ------------------
    await clickTitle(page, 'task-1', 'alpha')
    await page.waitForTimeout(400)
    let after = await report('baseline click')
    if (after.editors === 0) failures.push('baseline: clicking the task title did not open edit mode')
    // Close edit mode again by pressing Escape, then clicking away.
    await page.keyboard.press('Escape')
    await page.mouse.click(20, 20)
    await page.waitForTimeout(400)
    await report('baseline closed')

    // --- 1. swipe left ------------------------------------------------------
    await swipeLeft(page, 'task-1')
    await page.waitForTimeout(600)
    const swiped = await report('after swipe')
    if (!swiped.state.swipePopupVisible) failures.push('swipe: the postpone popup never opened')
    if (swiped.popovers === 0) failures.push('swipe: no popover portal was rendered')
    if (debug) console.log('  popovers:', JSON.stringify(await page.evaluate(() => window.__popoverRects())))

    // --- 2. dismiss it by clicking next to it -------------------------------
    // Top-left of the viewport: the popup is centred, so this is unambiguously
    // "next to it" and lands on the harness' empty header space, not on a row.
    await page.mouse.click(20, 20)
    await page.waitForTimeout(600)
    const dismissed = await report('after outside click')
    if (dismissed.state.swipePopupVisible) failures.push('dismiss: showSwipeDueDatePopup.visible stayed true')
    if (dismissed.popovers > 0) failures.push('dismiss: a popover portal is still in the DOM')

    // --- 3. the swiped row must open again ----------------------------------
    if (debug) {
        const point = await page.evaluate(() => window.__pressPoint('line-task-1', 'alpha'))
        console.log('  press point:', JSON.stringify(point))
        console.log('  hit chain:', JSON.stringify(await page.evaluate(p => window.__hitTest(p.x, p.y), point)))
    }
    await clickTitle(page, 'task-1', 'alpha')
    await page.waitForTimeout(500)
    const reopened = await report('after clicking the swiped task')
    if (reopened.editors === 0) {
        failures.push('REPRO: after the swipe + outside dismiss, clicking the swiped task does nothing')
    }

    // --- 4. and so must its neighbour ---------------------------------------
    await page.keyboard.press('Escape')
    await page.mouse.click(20, 20)
    await page.waitForTimeout(400)
    await clickTitle(page, 'task-2', 'bravo')
    await page.waitForTimeout(500)
    const neighbour = await report('after clicking the neighbour task')
    if (neighbour.editors === 0) {
        failures.push('REPRO: after the swipe + outside dismiss, clicking a DIFFERENT task does nothing')
    }

    // --- 5. the GOAL row of the task list -----------------------------------
    // AT-2449 follow-up: "swiping left on a goal in the task list no longer
    // shows the postpone popup". A goal reaches the same popup by a different
    // route than a task (`GoalItemPresentation.onRightSwipe` → `close()` →
    // `setTimeout` → dispatch), so the task scenario above cannot cover it.
    await page.keyboard.press('Escape')
    await page.mouse.click(20, 20)
    await page.waitForTimeout(400)
    await report('before the goal swipe')

    await swipeLeft(page, 'goal-1')
    await page.waitForTimeout(600)
    const goalSwiped = await report('after the goal swipe')
    if (!goalSwiped.state.swipePopupVisible) {
        failures.push('REPRO(goal): swiping left on a goal did not open the postpone popup')
    }
    if (goalSwiped.popovers === 0) failures.push('REPRO(goal): no popover portal was rendered for the goal')

    // And the original AT-2449 symptom must not come back on the goal row
    // either: dismissing the popup next to it must leave the row clickable.
    await page.mouse.click(20, 20)
    await page.waitForTimeout(600)
    const goalDismissed = await report('after dismissing the goal popup')
    if (goalDismissed.state.swipePopupVisible) failures.push('goal dismiss: the popup stayed visible')

    if (debug) console.log('  goal blocked press targets:', await page.evaluate(() => window.__blockedPressTargets()))
    await clickTitle(page, 'goal-1', 'charlie')
    await page.waitForTimeout(500)
    const goalReopened = await report('after clicking the swiped goal')
    if (goalReopened.editors === 0) {
        failures.push('REPRO(goal): after the swipe + outside dismiss, clicking the swiped goal does nothing')
    }

    await browser.close()
    server.close()

    if (pageErrors.length) console.log(`page errors: ${JSON.stringify(pageErrors.slice(0, 5))}`)

    if (failures.length) {
        console.error('\nAT-2449 FAILURES:')
        failures.forEach(failure => console.error(`  - ${failure}`))
        process.exit(1)
    }
    console.log('\nAT-2449 passed.')
}

run().catch(error => {
    console.error(error)
    process.exit(1)
})
