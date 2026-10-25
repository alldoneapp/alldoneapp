/**
 * AT-2538 browser-level regression: invisible width-measurement controls must never intercept
 * mouse or touch input intended for the visible Search and More buttons.
 *
 * Usage: node browser-tests/at2538/run.js
 */
const path = require('path')
const http = require('http')
const fs = require('fs')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const ENTRY = path.join(__dirname, 'harness.entry.js')
const SETUP = path.join(__dirname, 'webpack.setup.js')
const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>AT-2538</title>
<style>html,body,#root{margin:0;padding:0;box-sizing:border-box;background:#fff}</style></head>
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
            '--env',
            `harnessSetup=${SETUP}`,
        ],
        { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=1400' } }
    )
    fs.writeFileSync(path.join(BUILD_DIR, 'index.html'), HTML)
}

function serve() {
    const server = http.createServer((request, response) => {
        const url = request.url === '/' ? '/index.html' : request.url.split('?')[0]
        const file = path.join(BUILD_DIR, url)
        if (!fs.existsSync(file)) {
            response.writeHead(404)
            return response.end('not found')
        }
        response.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'application/javascript' : 'text/html' })
        response.end(fs.readFileSync(file))
    })
    return new Promise(resolve => server.listen(0, () => resolve(server)))
}

const checks = []
const check = (name, ok, detail) => {
    checks.push({ name, ok })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function loadPlaywright() {
    try {
        return require('playwright')
    } catch (error) {
        return require(path.join(process.env.PLAYWRIGHT_HOME || '/home/user/repro', 'node_modules', 'playwright'))
    }
}

async function tapCenter(page, testID, touch) {
    const element = page.locator(`[data-testid="${testID}"]`)
    const box = await element.boundingBox()
    if (!box) throw new Error(`${testID} has no bounding box`)
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    const hitTarget = await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid]')?.getAttribute('data-testid') || null,
        { x, y }
    )
    if (touch) await page.touchscreen.tap(x, y)
    else await page.mouse.click(x, y)
    return hitTarget
}

async function runCase(browser, server, { name, viewport, touch }) {
    const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch })
    const page = await context.newPage()
    page.on('pageerror', error => console.log('PAGE ERROR:', error.message))
    const url = `http://127.0.0.1:${server.address().port}/`

    await page.goto(url)
    await page.waitForFunction('window.__ready === true')
    const searchHitTarget = await tapCenter(page, 'assistant-task-search-button', touch)
    const searchOpened = await page.locator('[data-testid="assistant-task-search-modal"]').isVisible()
    check(`${name}: Search receives the pointer and opens its modal`, searchOpened, `hit=${searchHitTarget}`)

    await page.goto(url)
    await page.waitForFunction('window.__ready === true')
    const initialToggleLabel = await page
        .locator('[data-testid="assistant-quick-actions-toggle"]')
        .getAttribute('aria-label')
    const moreHitTarget = await tapCenter(page, 'assistant-quick-actions-toggle', touch)
    const overflowShown = await page.locator('[data-testid="overflow-action"]').isVisible()
    const toggleLabel = await page.locator('[data-testid="assistant-quick-actions-toggle"]').getAttribute('aria-label')
    check(
        `${name}: More receives the pointer and expands the actions`,
        overflowShown && toggleLabel !== initialToggleLabel,
        `hit=${moreHitTarget} label=${toggleLabel}`
    )

    await context.close()
}

async function main() {
    build()
    const server = await serve()
    const { chromium } = loadPlaywright()
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })

    await runCase(browser, server, { name: 'desktop', viewport: { width: 900, height: 500 }, touch: false })
    await runCase(browser, server, { name: 'mobile', viewport: { width: 360, height: 640 }, touch: true })

    await browser.close()
    server.close()
    const failures = checks.filter(result => !result.ok)
    console.log(`\n${checks.length - failures.length}/${checks.length} checks passed`)
    process.exit(failures.length ? 1 : 0)
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
