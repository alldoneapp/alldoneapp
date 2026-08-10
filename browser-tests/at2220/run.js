/**
 * AT-2220 browser-level regression test.
 *
 * "When I click into a 'new task line' or click into an existing task the app
 *  should not 'jump around' in scrolling .. currently the input fields almost go
 *  out of the screen (too much below)"
 *
 * Two independent causes, both pinned here:
 *
 *   A. Quill 2's `focus()` runs `scrollSelectionIntoView()`, which walks EVERY
 *      scrollable ancestor up to `document.body` and scrolls each one so the
 *      caret rect is inside it. Quill 1 — what the app shipped before the Stage 4
 *      editor migration — restored its own container's scroll position instead
 *      and touched nothing else. The task list's `CustomScrollView` is one of
 *      those ancestors, and the app focuses the editor on mount and again on
 *      every popup dismiss, mention insert and assignee pick.
 *   B. A task line quadruples in height when it turns into an editor (a ~34px
 *      title becomes a ~59px input plus a 55px action bar), so a line opened near
 *      the bottom edge pushes its own input and buttons past the fold. Quill's
 *      caret-level scroll cannot help — the caret is at the TOP of the new editor
 *      and is already visible, so nothing moves.
 *
 * Asserted, in real Chromium, on real `scrollTop` / `getBoundingClientRect()`,
 * for the new-task line and an existing task, on desktop / narrow desktop /
 * mobile viewports, with the line mid-viewport and at the bottom edge:
 *
 *   1. a line that is already comfortably visible must not scroll the list at
 *      all, and the editor must open exactly where the line was.
 *   2. wherever the line was, the whole editor — input AND action bar — must end
 *      up fully inside the viewport ("the input fields almost go out of the
 *      screen").
 *   3. revealing it must never overshoot what the editor's own height required.
 *   4. the document itself must never scroll (that would drag the top bar and
 *      sidebar off screen, AT-2177).
 *   5. one correction, then still: no drift or oscillation across samples.
 *   6. re-focusing an already-open editor — what every popup dismiss does — must
 *      not pull the list back to the caret after the user has scrolled away.
 *
 * Verified to FAIL on the unfixed build: all 12 cases fail there, the mid-viewport
 * ones by up to 423px of unwanted scroll on re-focus, the bottom-edge ones with
 * the editor hanging up to 58px below the viewport.
 *
 * Requirements (this does NOT run in CI's Jest jobs):
 *   nvm use 22
 *   (cd web-bundler && npm install)
 *   npx playwright install chromium
 * Usage:
 *   node browser-tests/at2220/run.js
 */
const path = require('path')
const http = require('http')
const fs = require('fs')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const ENTRY = path.join(__dirname, 'harness.entry.js')

const SAMPLES_MS = [150, 600, 1200]
// Sub-pixel scroll adjustments are not a "jump"; a clicked line that is already
// fully visible should not move the list by a perceptible amount.
const SCROLL_TOLERANCE_PX = 2

// The app shell binds itself to the viewport (html, body, #root { height: 100% }),
// so the harness page must too, otherwise the list would have no inner scroller
// at all and the document would scroll instead.
const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>AT-2220</title>
<style>
  html, body, #root { margin:0; padding:0; height:100%; box-sizing:border-box; }
  html { scroll-behavior: smooth; }
  body { display:flex; overflow-y:auto; overscroll-behavior-y:none; }
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

const round = value => Math.round(value * 100) / 100

async function runCase(port, browser, { name, viewport, target, position }) {
    const page = await browser.newPage({ viewport })
    const pageErrors = []
    const debug = !!process.env.HARNESS_DEBUG
    // The harness has no backend, so Firestore's offline transport reports a bare
    // `Event` — noise that says nothing about the layout under test.
    page.on('pageerror', error => {
        const message = debug ? error.stack || error.message : error.message
        if (message !== 'Event') pageErrors.push(message)
    })
    page.on('console', message => debug && console.log(`[${name} console.${message.type()}] ${message.text()}`))

    await page.route('**://*.google*/**', route => route.abort())
    await page.goto(`http://127.0.0.1:${port}/`)
    try {
        await page.waitForFunction(() => window.__ready === true && !!window.__scrollState && !!window.__scrollState())
    } catch (error) {
        console.error(`${name}: harness never became ready.`)
        console.error(`  window.__ready = ${await page.evaluate(() => window.__ready)}`)
        console.error(`  page errors: ${JSON.stringify(pageErrors)}`)
        console.error(`  body: ${(await page.evaluate(() => document.body.innerHTML)).slice(0, 1500)}`)
        throw error
    }

    // Park the list so the line under test sits at a chosen height in the
    // viewport, with content above AND below it.
    await page.evaluate(
        args => {
            const anchor = document.getElementById(args.id)
            const rect = anchor.getBoundingClientRect()
            const wanted = rect.top - window.innerHeight * args.fraction
            const state = window.__scrollState()
            window.__setScrollTop(
                Math.max(0, Math.min(state.scrollTop + wanted, state.scrollHeight - state.clientHeight))
            )
        },
        { id: target.anchorId, fraction: position.fraction }
    )
    await page.waitForTimeout(120)

    const before = {
        scroll: await page.evaluate(() => window.__scrollState()),
        line: await page.evaluate(id => window.__rectOfId(id), target.anchorId),
        viewportHeight: viewport.height,
    }

    // Click the line's title with the real mouse, the way the user opens it.
    const point = await page.evaluate(args => window.__pressPoint(args.anchorId, args.word), {
        anchorId: target.anchorId,
        word: target.clickText,
    })
    if (!point) throw new Error(`${name}: could not locate the line's title`)
    await page.mouse.click(point.x, point.y)
    await page.waitForFunction(() => window.__editorCount() > 0, null, { timeout: 5000 })

    const samples = []
    let elapsed = 0
    for (const at of SAMPLES_MS) {
        await page.waitForTimeout(at - elapsed)
        elapsed = at
        samples.push({
            at,
            scroll: await page.evaluate(() => window.__scrollState()),
            // The whole editor the user has to work with: the input AND the
            // action bar underneath it, not just the caret's line.
            card: await page.evaluate(id => window.__editorCardRect(id), target.anchorId),
            editor: await page.evaluate(() => window.__editorRect()),
        })
    }

    // Second phase: with the editor open, the user scrolls the list away and the
    // app re-focuses the editor (every popup it opens does that on dismiss).
    // Whatever the user scrolled to must survive.
    await page.mouse.move(viewport.width / 2, viewport.height / 2)
    // Far enough that the open editor leaves the viewport entirely — the state
    // in which stock Quill's scroll-into-view yanks the list back.
    await page.mouse.wheel(0, viewport.height)
    await page.waitForTimeout(200)
    const beforeRefocus = await page.evaluate(() => window.__scrollState())
    const refocused = await page.evaluate(() => window.__refocusEditor())
    await page.waitForTimeout(400)
    const afterRefocus = await page.evaluate(() => window.__scrollState())

    await page.close()
    return { name, position, before, samples, refocus: { refocused, beforeRefocus, afterRefocus }, pageErrors }
}

function check(result) {
    const failures = []
    const { name, before, samples, position } = result
    const settled = samples[samples.length - 1]

    if (!settled.editor) {
        failures.push(`${name}: no editor appeared after the click — the harness did not open edit mode`)
        return failures
    }

    const scrolled = settled.scroll.scrollTop - before.scroll.scrollTop

    if (position.mustNotScroll) {
        // 1. A line that is comfortably inside the viewport must not move the
        //    list at all. This is the half of the report that Quill 2 broke:
        //    `focus()` walks every scrollable ancestor and nudges each one.
        for (const sample of samples) {
            const delta = Math.abs(sample.scroll.scrollTop - before.scroll.scrollTop)
            if (delta > SCROLL_TOLERANCE_PX) {
                failures.push(
                    `${name}: clicking an already-visible line scrolled the task list by ${round(delta)}px ` +
                        `at t=${sample.at}ms (scrollTop ${round(before.scroll.scrollTop)} -> ` +
                        `${round(sample.scroll.scrollTop)}) — the list must not jump`
                )
                break
            }
        }

        // 2. The editor must open exactly where the clicked line was.
        const drift = Math.abs(settled.editor.top - before.line.top)
        if (drift > 8) {
            failures.push(
                `${name}: the editor opened ${round(drift)}px away from the line that was clicked ` +
                    `(line.top=${round(before.line.top)}, editor.top=${round(settled.editor.top)})`
            )
        }
    }

    // 3. Wherever the line was, the whole editor — input AND action bar — has to
    //    be usable: fully inside the viewport once things settle.
    if (settled.card.top < -0.5 || settled.card.bottom > before.viewportHeight + 0.5) {
        failures.push(
            `${name}: the editor is not fully visible after the click ` +
                `(top=${round(settled.card.top)}, bottom=${round(settled.card.bottom)}, ` +
                `viewport=${before.viewportHeight}) — the input must not hang off the screen`
        )
    }

    // 4. Revealing it may never overshoot: scrolling further than what the
    //    editor's own height required is exactly the "too far" complaint.
    const neededScroll = Math.max(
        0,
        before.line.bottom + settled.card.height - before.line.height - before.viewportHeight
    )
    if (scrolled > neededScroll + 24) {
        failures.push(
            `${name}: the list scrolled ${round(scrolled)}px but at most ~${round(neededScroll)}px was needed ` +
                `to reveal the editor — that is the over-scroll the ticket is about`
        )
    }
    if (scrolled < -SCROLL_TOLERANCE_PX) {
        failures.push(`${name}: the list scrolled backwards by ${round(-scrolled)}px`)
    }

    // 5. The document itself must never scroll — that would drag the top bar
    //    and the sidebar off screen (AT-2177).
    for (const sample of samples) {
        if (Math.abs(sample.scroll.windowScrollY - before.scroll.windowScrollY) > SCROLL_TOLERANCE_PX) {
            failures.push(
                `${name}: the document scrolled by ` +
                    `${round(sample.scroll.windowScrollY - before.scroll.windowScrollY)}px at t=${sample.at}ms`
            )
            break
        }
    }

    // 6. Stability: one correction, then still. No drift, no oscillation.
    const settledTops = samples.slice(1).map(sample => round(sample.scroll.scrollTop))
    if (new Set(settledTops).size > 1) {
        failures.push(`${name}: the scroll position kept moving after the click: ${settledTops.join(' -> ')}`)
    }

    // 7. Re-focusing an open editor (what every popup dismiss does) must not
    //    drag the list back to the caret.
    const { refocused, beforeRefocus, afterRefocus } = result.refocus
    if (refocused !== 'focused') {
        failures.push(`${name}: could not re-focus the open editor (${refocused})`)
    } else {
        const pulled = Math.abs(afterRefocus.scrollTop - beforeRefocus.scrollTop)
        if (pulled > SCROLL_TOLERANCE_PX) {
            failures.push(
                `${name}: re-focusing the open editor pulled the task list back by ${round(pulled)}px ` +
                    `(scrollTop ${round(beforeRefocus.scrollTop)} -> ${round(afterRefocus.scrollTop)}) — ` +
                    `focus must never scroll the list`
            )
        }
    }

    if (result.pageErrors.length) {
        failures.push(`${name}: page errors: ${JSON.stringify(result.pageErrors)}`)
    }

    return failures
}

// `SocialText` renders one span per word, so the press target is a single word
// of the line's label — the same DOM node a user's click lands on.
const NEW_TASK_LINE = { anchorId: 'new-task-anchor', clickText: 'new' }
const EXISTING_TASK_LINE = { anchorId: 'existing-task-line', clickText: 'existing' }

// Two positions, because the report has two halves. A line in the middle of the
// viewport must not move the list at all; a line at the very bottom must be
// revealed — the row quadruples in height when it becomes an editor — but only
// by as much as that actually takes.
const MIDDLE = { name: 'mid-viewport', fraction: 0.4, mustNotScroll: true }
const BOTTOM = { name: 'bottom edge', fraction: 0.93, mustNotScroll: false }

const VIEWPORTS = [
    { name: 'desktop', viewport: { width: 1280, height: 720 } },
    { name: 'narrow desktop', viewport: { width: 900, height: 600 } },
    { name: 'mobile', viewport: { width: 390, height: 664 } },
]

const CASES = []
for (const { name: viewportName, viewport } of VIEWPORTS) {
    for (const [targetName, target] of [
        ['new task line', NEW_TASK_LINE],
        ['existing task', EXISTING_TASK_LINE],
    ]) {
        for (const position of [MIDDLE, BOTTOM]) {
            CASES.push({
                name: `${viewportName} / ${targetName} / ${position.name}`,
                viewport,
                target,
                position,
            })
        }
    }
}

async function main() {
    build()
    const server = await serve()
    const port = server.address().port
    const { chromium } = requirePlaywright()
    // HARNESS_NO_SANDBOX is for containers where the Chromium sandbox cannot run.
    const browser = await chromium.launch({ args: process.env.HARNESS_NO_SANDBOX ? ['--no-sandbox'] : [] })

    const failures = []
    for (const testCase of CASES) {
        const result = await runCase(port, browser, testCase)
        if (process.env.HARNESS_DEBUG) console.log(JSON.stringify(result, null, 2))
        const caseFailures = check(result)
        if (caseFailures.length === 0) {
            console.log(`PASS  ${testCase.name}`)
        } else {
            caseFailures.forEach(failure => console.log(`FAIL  ${failure}`))
        }
        failures.push(...caseFailures)
    }

    await browser.close()
    server.close()

    if (failures.length) {
        console.error(`\n${failures.length} failure(s)`)
        process.exit(1)
    }
    console.log('\nAT-2220: all cases pass')
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
