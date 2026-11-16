/**
 * AT-3044 browser-level regression test: Gold is shown top left in the mobile header.
 *
 * Asserted at each phone width, for short and very long balances:
 *   1. exactly one Gold pill is rendered, and it is in the header's top row (not only in the
 *      ⋮ secondary row) — this is the reported bug;
 *   2. it does not overlap the centred Home button nor the search/chat/bell/⋮ group;
 *   3. it is fully inside the viewport and the document does not scroll sideways;
 *   4. opening the ⋮ row does not add a second Gold pill.
 * Also asserted: the tablet "mobile" header (sidebar hidden, ≤ SCREEN_BREAKPOINT_NAV) keeps
 * showing Gold top left.
 *
 * Requirements (not part of CI's Jest jobs):
 *   nvm use 22
 *   (cd web-bundler && npm install)
 *   npx playwright install chromium
 *   cp -R replacement_node_modules/. node_modules/
 * Usage:
 *   node browser-tests/at3044/run.js            (SCREENSHOTS=1 writes PNGs into .build/)
 */
const path = require('path')
const http = require('http')
const fs = require('fs')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const ENTRY = path.join(__dirname, 'harness.entry.js')

const WIDTHS = [320, 360, 375, 390, 412, 432, 459, 600, 768]
// 0, a typical balance, and balances long enough to need truncation on the narrowest phones.
const GOLD_VALUES = [0, 1234, 123456, 123456789]
const TOLERANCE_PX = 0.5

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>AT-3044</title>
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

async function measure(browser, port, { width, gold, expanded }) {
    const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 2 })
    const pageErrors = []
    const isBackendNoise = message => message === 'Event' || /auth\/invalid-api-key/.test(message)
    page.on('pageerror', error => {
        if (!isBackendNoise(error.message)) pageErrors.push(error.message)
    })
    await page.route('**://*.google*/**', route => route.abort())
    await page.goto(`http://127.0.0.1:${port}/?gold=${gold}&expanded=${expanded ? 1 : 0}`)
    await page.waitForFunction(() => window.__ready === true && !!window.__measure && !!window.__measure())
    await page.evaluate(() => document.fonts && document.fonts.ready)
    await page.waitForTimeout(150)
    const result = await page.evaluate(() => window.__measure())
    if (process.env.SCREENSHOTS) {
        await page.screenshot({
            path: path.join(BUILD_DIR, `w${width}-g${gold}${expanded ? '-expanded' : ''}.png`),
            clip: { x: 0, y: 0, width, height: expanded ? 96 : 56 },
        })
    }
    await page.close()
    if (pageErrors.length) throw new Error(`${width}px/${gold}: page errors: ${JSON.stringify(pageErrors)}`)
    return result
}

const overlaps = (a, b) => a && b && a.right > b.left + TOLERANCE_PX && b.right > a.left + TOLERANCE_PX

async function main() {
    if (!process.env.SKIP_BUILD) build()
    const server = await serve()
    const { port } = server.address()
    const { chromium } = requirePlaywright()
    const browser = await chromium.launch()
    const failures = []
    const fail = (label, message) => failures.push(`${label}: ${message}`)

    try {
        for (const width of WIDTHS) {
            for (const gold of GOLD_VALUES) {
                for (const expanded of [false, true]) {
                    const label = `${width}px gold=${gold}${expanded ? ' (⋮ open)' : ''}`
                    const m = await measure(browser, port, { width, gold, expanded })
                    const r = v => Math.round(v * 10) / 10
                    console.log(
                        `${label.padEnd(32)} gold ${m.gold ? `${r(m.gold.left)}–${r(m.gold.right)}` : 'MISSING'}` +
                            ` "${m.goldText}"${m.goldTextTruncated ? ' (truncated)' : ''}` +
                            ` | home ${r(m.home.left)}–${r(m.home.right)} | icons from ${r(m.right.left)}`
                    )
                    if (m.goldInRowCount !== 1)
                        fail(label, `expected Gold once in the top row, got ${m.goldInRowCount}`)
                    if (m.goldCount !== 1) fail(label, `expected exactly one Gold pill on screen, got ${m.goldCount}`)
                    if (overlaps(m.gold, m.home)) fail(label, 'Gold overlaps the Home button')
                    if (overlaps(m.gold, m.right)) fail(label, 'Gold overlaps the right-hand icons')
                    if (overlaps(m.home, m.right)) fail(label, 'Home overlaps the right-hand icons')
                    if (m.gold && (m.gold.left < -TOLERANCE_PX || m.gold.right > width + TOLERANCE_PX))
                        fail(label, 'Gold is outside the viewport')
                    if (m.gold && m.gold.width < 40) fail(label, `Gold pill collapsed to ${m.gold.width}px`)
                    if (m.documentScrollWidth > width)
                        fail(label, `document scrolls sideways (${m.documentScrollWidth})`)
                    // The common balances must never be cut off on a normal phone.
                    if (gold <= 123456 && width >= 360 && m.goldTextTruncated)
                        fail(label, 'typical balance is truncated')
                }
            }
        }
    } finally {
        await browser.close()
        server.close()
    }

    if (failures.length) {
        console.error(`\nAT-3044 FAILED (${failures.length}):\n  ${failures.join('\n  ')}`)
        process.exit(1)
    }
    console.log('\nAT-3044 passed')
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
