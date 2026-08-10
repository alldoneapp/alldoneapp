/**
 * AT-2202 browser-level regression test.
 *
 * "If I start typing in the assistant line the text field rightfully expands but
 *  the send button and call button are then no longer nicely aligned. They
 *  should be directly below each other and the input field should expand
 *  accordingly."
 *
 * Asserted, in real Chromium, on real `getBoundingClientRect()` values:
 *
 *   1. collapsed  — the two controls sit side by side on one row.
 *   2. expanded   — the call button sits DIRECTLY ABOVE the send button: same
 *                   centre axis (<= 1px apart) and no vertical overlap.
 *   3. expanded   — the text field is WIDER than it was collapsed, i.e. it
 *                   expanded into the space the second control no longer needs.
 *   4. expanded   — the field and the control column are the same height, so the
 *                   buttons cannot overhang the field they belong to.
 *   5. stability  — after the field widens and the text re-wraps to one line the
 *                   layout must NOT flip back (that feedback loop is the "wiggle"
 *                   this composer was fixed for once already); measurements taken
 *                   over time must all be identical.
 *
 * Both the desktop (send button carries a "Send" label) and the small-screen
 * (icon-only send button) states are exercised, because the two controls have
 * very different relative widths in those two cases.
 *
 * Requirements (this does NOT run in CI's Node 14 Jest job):
 *   nvm use 22
 *   (cd web-bundler && npm install)
 *   npx playwright install chromium
 * Usage:
 *   node browser-tests/at2202/run.js
 */
const path = require('path')
const http = require('http')
const fs = require('fs')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const ENTRY = path.join(__dirname, 'harness.entry.js')

// Long enough to wrap onto a second line in the collapsed layout.
const LONG_TEXT =
    'Bitte fasse mir die wichtigsten offenen Punkte aus dieser Woche zusammen und schlage konkrete naechste Schritte vor.'
// One wrapped line at the composer's lineHeight of 22 on top of the 40px
// single-line height.
const TWO_LINE_HEIGHT = 62
// The height the field reports once it is wider and the text re-wraps back to a
// single line — the input that used to restart the expand/collapse oscillation.
const REWRAPPED_HEIGHT = 40
const SAMPLES_MS = [150, 500, 1200]
const AXIS_TOLERANCE_PX = 1

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>AT-2202</title>
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

async function runCase(port, browser, { name, query, viewport }) {
    const page = await browser.newPage({ viewport })
    const pageErrors = []
    const debug = !!process.env.HARNESS_DEBUG
    page.on('pageerror', error => pageErrors.push(debug ? error.stack || error.message : error.message))
    page.on('console', message => debug && console.log(`[${name} console.${message.type()}] ${message.text()}`))

    // The app boots Google's auth/gapi scripts; nothing here needs them and they
    // only add noise (and network flakiness) to a layout measurement.
    await page.route('**://*.google*/**', route => route.abort())
    await page.goto(`http://127.0.0.1:${port}/${query}`)
    try {
        await page.waitForFunction(() => window.__ready === true && !!window.__measure && !!window.__measure())
    } catch (error) {
        console.error(`${name}: harness never became ready.`)
        console.error(`  window.__ready = ${await page.evaluate(() => window.__ready)}`)
        const measure = await page.evaluate(() => (window.__measure ? window.__measure() : null))
        console.error(`  measure = ${JSON.stringify(measure)}`)
        console.error(`  page errors: ${JSON.stringify(pageErrors)}`)
        console.error(`  body: ${(await page.evaluate(() => document.body.innerHTML)).slice(0, 800)}`)
        throw error
    }

    const collapsed = await page.evaluate(() => window.__measure())

    // Type the message (real input events -> real onChangeText), then report the
    // content height a wrapped second line produces. See __reportContentHeight.
    await page.evaluate(text => window.__setText(text), LONG_TEXT)
    await page.evaluate(height => window.__reportContentHeight(height), TWO_LINE_HEIGHT)

    const samples = []
    let elapsed = 0
    for (const at of SAMPLES_MS) {
        await page.waitForTimeout(at - elapsed)
        elapsed = at
        samples.push({ at, measure: await page.evaluate(() => window.__measure()) })
    }

    // Now simulate the re-wrap that stacking causes: the field is ~48px wider,
    // so the browser reports a single line again. The layout must not flip back.
    await page.evaluate(height => window.__reportContentHeight(height), REWRAPPED_HEIGHT)
    await page.waitForTimeout(250)
    const afterRewrap = await page.evaluate(() => window.__measure())

    await page.close()
    return { name, collapsed, samples, afterRewrap, pageErrors }
}

function check(result) {
    const failures = []
    const { name, collapsed, samples } = result
    const expanded = samples[samples.length - 1].measure

    // 1. collapsed: one row, controls side by side.
    if (!(collapsed.call.centerX < collapsed.send.centerX && collapsed.call.top === collapsed.send.top)) {
        failures.push(
            `${name}: collapsed layout should be a single row, got call=${JSON.stringify(
                collapsed.call
            )} send=${JSON.stringify(collapsed.send)}`
        )
    }

    // 2. expanded: call button directly above the send button, same centre axis.
    const axisDelta = Math.abs(expanded.call.centerX - expanded.send.centerX)
    if (axisDelta > AXIS_TOLERANCE_PX) {
        failures.push(
            `${name}: call and send buttons are ${round(axisDelta)}px off the shared centre axis ` +
                `(call.centerX=${round(expanded.call.centerX)}, send.centerX=${round(expanded.send.centerX)}) ` +
                `- they must be directly below each other`
        )
    }
    if (!(expanded.call.bottom <= expanded.send.top + 0.5)) {
        failures.push(
            `${name}: call button is not stacked above the send button ` +
                `(call.bottom=${round(expanded.call.bottom)}, send.top=${round(expanded.send.top)})`
        )
    }

    // 3. expanded: the field reclaimed the width the row layout needed.
    if (!(expanded.input.width > collapsed.input.width + 1)) {
        failures.push(
            `${name}: the input did not expand into the freed width ` +
                `(collapsed=${round(collapsed.input.width)}px, expanded=${round(expanded.input.width)}px)`
        )
    }

    // 4. expanded: field and control column are the same height (no overhang).
    const heightDelta = Math.abs(expanded.input.height - expanded.cluster.height)
    if (heightDelta > 1) {
        failures.push(
            `${name}: the control column overhangs the field by ${round(heightDelta)}px ` +
                `(input=${round(expanded.input.height)}px, cluster=${round(expanded.cluster.height)}px)`
        )
    }

    // 5. stability: no oscillation once expanded.
    const key = measure =>
        JSON.stringify([
            round(measure.input.width),
            round(measure.input.height),
            round(measure.call.centerX),
            round(measure.send.centerX),
        ])
    const keys = samples.map(sample => key(sample.measure)).concat(key(result.afterRewrap))
    if (new Set(keys).size !== 1) {
        failures.push(`${name}: layout is oscillating -> ${keys.join('  |  ')}`)
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
        { name: 'desktop', query: '?width=720', viewport: { width: 1280, height: 900 } },
        { name: 'mobile', query: '?width=340&mobile=1', viewport: { width: 390, height: 780 } },
    ]

    const failures = []
    for (const testCase of cases) {
        const result = await runCase(port, browser, testCase)
        const expanded = result.samples[result.samples.length - 1].measure
        console.log(
            `${result.name}: collapsed input ${round(result.collapsed.input.width)}x${round(
                result.collapsed.input.height
            )} -> expanded ${round(expanded.input.width)}x${round(expanded.input.height)}; ` +
                `call.centerX=${round(expanded.call.centerX)} send.centerX=${round(expanded.send.centerX)}; ` +
                `cluster ${round(expanded.cluster.width)}x${round(expanded.cluster.height)}`
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
    console.log('\nPASS: send and call buttons stack on one axis and the field expands into the freed width.')
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
