/**
 * AT-2397 browser-level regression test.
 *
 * "If I do at-mention in the 'Add task' popup, the at-mention popup is rendered
 *  below the 'Add task' popup but should be rendered above it."
 *
 * Both popups are portaled to `document.body`, so they are SIBLINGS in the root
 * stacking context — the mention list being nested inside the popup's React tree
 * decides nothing. The vendored popover container carries no z-index unless the
 * caller passes one, so the mention list sat at `z-index: auto` and lost to the
 * "Add task" popup's 9999 every single time.
 *
 * Asserted in real Chromium, because jsdom has no paint order and cannot answer
 * the only question that matters here:
 *
 *   1. the two portals really do overlap (otherwise the rest proves nothing);
 *   2. `document.elementFromPoint()` over that overlap resolves INSIDE the
 *      mention portal — i.e. the mention list is what the user sees and clicks;
 *   3. the mention portal carries a z-index strictly greater than the host
 *      popup's, which is the mechanism that makes (2) true rather than an
 *      accident of DOM order.
 *
 * Run against the pre-fix code (drop the `containerStyle` from
 * WrapperMentionsModal) and case 2 and 3 both fail — the hit lands in the "Add
 * task" card and `mentionZIndex` reads ''.
 *
 * Requirements (this does NOT run in CI's Jest jobs):
 *   nvm use 22
 *   (cd web-bundler && npm install)
 *   npx playwright install chromium
 * Usage:
 *   node browser-tests/at2397/run.js
 */
const path = require('path')
const http = require('http')
const fs = require('fs')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const ENTRY = path.join(__dirname, 'harness.entry.js')

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>AT-2397</title>
<style>html,body{margin:0;padding:0;height:100%}</style></head>
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

async function runCase(port, browser, { name, viewport }) {
    const page = await browser.newPage({ viewport })
    const pageErrors = []
    const debug = !!process.env.HARNESS_DEBUG
    page.on('pageerror', error => pageErrors.push(debug ? error.stack || error.message : error.message))
    page.on('console', message => debug && console.log(`[${name} console.${message.type()}] ${message.text()}`))

    // Nothing here needs Google auth/gapi; blocking it removes network flakiness
    // from what is purely a paint-order measurement.
    await page.route('**://*.google*/**', route => route.abort())
    await page.goto(`http://127.0.0.1:${port}/`)

    try {
        await page.waitForFunction(() => window.__ready === true && !!window.__probe && window.__probe().ready)
    } catch (error) {
        console.error(`${name}: harness never became ready.`)
        console.error(`  window.__ready = ${await page.evaluate(() => window.__ready)}`)
        const probe = await page.evaluate(() => (window.__probe ? window.__probe() : null))
        console.error(`  probe = ${JSON.stringify(probe)}`)
        console.error(`  page errors: ${JSON.stringify(pageErrors)}`)
        console.error(`  body: ${(await page.evaluate(() => document.body.innerHTML)).slice(0, 800)}`)
        throw error
    }

    // The mention modal reports its own height back and re-positions once, so
    // settle before measuring.
    await page.waitForTimeout(400)
    const probe = await page.evaluate(() => window.__probe())

    await page.close()
    return { name, probe, pageErrors }
}

function check({ name, probe }) {
    const failures = []

    if (!probe.overlaps) {
        failures.push(
            `${name}: the two popups do not overlap, so this run proves nothing about stacking ` +
                `(mention=${JSON.stringify(probe.mentionRect)}, host=${JSON.stringify(probe.hostRect)}). ` +
                `Fix the harness geometry.`
        )
        return failures
    }

    // The assertion the user actually cares about: what is on top.
    if (!probe.hitInMentionPortal) {
        failures.push(
            `${name}: the element at the overlap (${round(probe.point.x)}, ${round(probe.point.y)}) is ` +
                `${probe.hitInHostPortal ? 'the "Add task" popup' : `<${probe.hitTag}> outside the mention portal`}` +
                ` - the @-mention popup is being painted BELOW the popup that hosts it`
        )
    }

    // And the mechanism, so a pass can never be an accident of DOM order.
    const mentionZ = Number(probe.mentionZIndex)
    const hostZ = Number(probe.hostZIndex)
    if (!probe.mentionZIndex || !(mentionZ > hostZ)) {
        failures.push(
            `${name}: mention portal z-index is ${JSON.stringify(probe.mentionZIndex)} and the host popup's is ` +
                `${JSON.stringify(probe.hostZIndex)} - the mention layer must be strictly above the popup layer`
        )
    }

    return failures
}

async function main() {
    build()
    const server = await serve()
    const port = server.address().port
    const { chromium } = requirePlaywright()
    const browser = await chromium.launch()

    const cases = [
        { name: 'desktop', viewport: { width: 1280, height: 900 } },
        { name: 'mobile', viewport: { width: 390, height: 780 } },
    ]

    const failures = []
    for (const testCase of cases) {
        const result = await runCase(port, browser, testCase)
        const { probe } = result
        console.log(
            `${result.name}: mention z-index=${JSON.stringify(probe.mentionZIndex)} ` +
                `host z-index=${JSON.stringify(probe.hostZIndex)}; overlap probe at ` +
                `(${round(probe.point.x)}, ${round(probe.point.y)}) hit ` +
                `${probe.hitInMentionPortal ? 'MENTION portal' : probe.hitInHostPortal ? 'HOST popup' : 'neither'}`
        )
        if (result.pageErrors.length) console.log(`${result.name} page errors:`, result.pageErrors)
        failures.push(...check(result))
    }

    await browser.close()
    server.close()

    if (failures.length) {
        console.error('\nFAIL:\n' + failures.map(failure => `  - ${failure}`).join('\n'))
        process.exit(1)
    }
    console.log('\nPASS: the @-mention popup paints above the popup that hosts its input.')
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
