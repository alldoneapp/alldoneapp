/**
 * AT-2594 browser regression: global search preserves its desktop card while
 * using the available mobile sheet and keeping all controls in bounds.
 *
 * Usage: node browser-tests/at2594/run.js
 */
const fs = require('fs')
const http = require('http')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const ENTRY = path.join(__dirname, 'harness.entry.js')
const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>AT-2594</title>
<style>html,body,#root{margin:0;padding:0;width:100%;height:100%;overflow-x:hidden}</style></head>
<body><div id="root"></div><script src="/harness.js"></script></body></html>`

function build() {
    const webpackBin = path.join(ROOT, 'web-bundler', 'node_modules', '.bin', 'webpack')
    if (!fs.existsSync(webpackBin)) throw new Error('web-bundler dependencies are missing')
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
    const server = http.createServer((request, response) => {
        const cleanPath = request.url.split('?')[0]
        const requestPath = cleanPath === '/' ? '/index.html' : cleanPath
        const file = path.join(BUILD_DIR, requestPath)
        if (!file.startsWith(BUILD_DIR) || !fs.existsSync(file)) {
            response.writeHead(404)
            return response.end('not found')
        }
        response.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'application/javascript' : 'text/html' })
        response.end(fs.readFileSync(file))
    })
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)))
}

function requirePlaywright() {
    try {
        return require('playwright')
    } catch (error) {
        return require(path.join(process.env.PLAYWRIGHT_HOME || '/home/user/repro', 'node_modules', 'playwright'))
    }
}

const within = (inner, outer, tolerance = 1) =>
    inner.left >= outer.left - tolerance &&
    inner.right <= outer.right + tolerance &&
    inner.top >= outer.top - tolerance &&
    inner.bottom <= outer.bottom + tolerance

async function main() {
    build()
    const server = await serve()
    const { chromium } = requirePlaywright()
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    const cases = [
        { name: 'desktop', viewport: { width: 1280, height: 900 }, mobile: false, language: 'en' },
        {
            name: 'tall phone',
            viewport: { width: 390, height: 844 },
            mobile: true,
            language: 'de',
            expectWrappedFilters: true,
        },
        {
            name: 'narrow phone',
            viewport: { width: 320, height: 568 },
            mobile: true,
            language: 'de',
            expectWrappedFilters: true,
        },
        {
            name: 'short landscape phone',
            viewport: { width: 568, height: 320 },
            mobile: true,
            language: 'de',
            expectWrappedFilters: true,
        },
    ]
    const failures = []

    for (const testCase of cases) {
        const page = await browser.newPage({ viewport: testCase.viewport })
        const pageErrors = []
        page.on('pageerror', error => {
            // The harness intentionally has no Firebase credentials. The real
            // modal catches its project refresh and uses the loaded Redux
            // project; Firebase Auth also reports that absent test key at page
            // level, which is unrelated to rendering.
            if (error.message === 'Event' || error.message.includes('auth/invalid-api-key')) return
            pageErrors.push(process.env.HARNESS_DEBUG ? error.stack : error.message)
        })
        page.on('console', message => {
            if (process.env.HARNESS_DEBUG) console.log(`[console.${message.type()}] ${message.text()}`)
        })
        await page.route('**://*.google*/**', route => route.abort())
        await page.goto(
            `http://127.0.0.1:${server.address().port}/?mobile=${testCase.mobile ? 1 : 0}&language=${testCase.language}`
        )
        try {
            await page.waitForFunction(() => window.__ready && window.__measureSearchLayout())
        } catch (error) {
            const diagnostics = await page.evaluate(() => ({
                ready: window.__ready,
                html: document.body.innerHTML.slice(0, 1000),
            }))
            throw new Error(`${error.message}\n${JSON.stringify({ pageErrors, diagnostics })}`)
        }
        // Measure the final sheet position, not an intermediate slide-up frame.
        await page.waitForTimeout(250)
        const measured = await page.evaluate(() => window.__measureSearchLayout())
        if (process.env.HARNESS_DEBUG && pageErrors.length) console.log(`page errors: ${JSON.stringify(pageErrors)}`)

        const checks = testCase.mobile
            ? {
                  'uses the bottom-sheet presentation': !!measured.sheet,
                  'uses the available screen height': measured.popup.height >= measured.viewport.height - 100,
                  'keeps the popup inside the sheet': within(measured.popup, measured.sheet),
                  'keeps filters inside the popup': within(measured.filters, measured.popup),
                  'keeps every filter chip fully visible': measured.filterChips.every(chip =>
                      within(chip, measured.filters)
                  ),
                  'keeps every filter label unclipped': measured.filterChips.every(
                      chip => chip.scrollWidth <= chip.clientWidth + 1
                  ),
                  ...(testCase.expectWrappedFilters
                      ? { 'wraps filters when horizontal space is insufficient': measured.filterRowCount >= 2 }
                      : {}),
                  'keeps the search field inside the popup': within(measured.input, measured.popup),
                  'keeps the results region inside the popup': within(measured.results, measured.popup),
                  'keeps the tab strip inside the results region': within(measured.tabs, measured.results),
                  'keeps every tab label inside the tab strip': measured.tabLabels.every(label =>
                      within(label, measured.tabs)
                  ),
                  'does not create horizontal page overflow':
                      measured.documentWidth <= measured.viewport.width &&
                      measured.bodyWidth <= measured.viewport.width,
              }
            : {
                  'keeps the desktop card presentation': !measured.sheet,
                  'keeps the 640px desktop width': Math.abs(measured.popup.width - 640) <= 1,
                  'keeps the 512px desktop height': Math.abs(measured.popup.height - 512) <= 1,
                  'keeps the desktop card centered':
                      Math.abs(measured.popup.left - (measured.viewport.width - measured.popup.width) / 2) <= 1,
                  'keeps desktop filters on one line': measured.filterRowCount === 1,
                  'keeps every desktop filter chip visible': measured.filterChips.every(chip =>
                      within(chip, measured.filters)
                  ),
              }

        checks['renders without page errors'] = pageErrors.length === 0
        for (const [label, passed] of Object.entries(checks)) {
            console.log(`${passed ? 'PASS' : 'FAIL'}  ${testCase.name}: ${label}`)
            if (!passed) failures.push(`${testCase.name}: ${label} (${JSON.stringify(measured)})`)
        }
        await page.close()
    }

    await browser.close()
    server.close()
    if (failures.length) {
        console.error(`\n${failures.length} failure(s):\n${failures.map(failure => `- ${failure}`).join('\n')}`)
        process.exit(1)
    }
    console.log('\nAT-2594: global search is responsive at all tested sizes.')
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
