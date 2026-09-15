/**
 * AT-2588 browser regression: the Email & Calendar pointer remains one
 * standard property row at the reported desktop size and responsive widths.
 */
const fs = require('fs')
const http = require('http')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const ENTRY = path.join(__dirname, 'harness.entry.js')
const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>AT-2588</title>
<style>html,body,#root{margin:0;padding:0;background:#fff}</style></head>
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

const closeEnough = (first, second, tolerance = 0.5) => Math.abs(first - second) <= tolerance

function requirePlaywright() {
    try {
        return require('playwright')
    } catch (error) {
        return require(path.join(process.env.PLAYWRIGHT_HOME || '/home/user/repro', 'node_modules', 'playwright'))
    }
}

async function main() {
    build()
    const server = await serve()
    const { chromium } = requirePlaywright()
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    const cases = [
        { name: 'screenshot desktop', viewport: { width: 1993, height: 1280 }, rowWidth: 864 },
        { name: 'responsive desktop', viewport: { width: 1024, height: 768 }, rowWidth: 640 },
        { name: 'mobile property column', viewport: { width: 390, height: 844 }, rowWidth: 358 },
    ]
    const failures = []

    for (const testCase of cases) {
        const page = await browser.newPage({ viewport: testCase.viewport })
        const pageErrors = []
        page.on('pageerror', error => pageErrors.push(error.message))
        await page.goto(`http://127.0.0.1:${server.address().port}/?width=${testCase.rowWidth}`)
        await page.waitForFunction(() => window.__ready && window.__measure && window.__measure())
        const result = await page.evaluate(() => window.__measure())
        await page.close()

        const checks = {
            'row is 56px high': closeEnough(result.row.height, 56),
            'label and link share one center line': closeEnough(result.label.centerY, result.link.centerY),
            'link stays right-aligned': closeEnough(result.link.right, result.row.right),
            'children stay inside the row':
                result.label.top >= result.row.top &&
                result.label.bottom <= result.row.bottom &&
                result.link.top >= result.row.top &&
                result.link.bottom <= result.row.bottom,
            'link is 11px regular text':
                result.fontSize === '11px' &&
                (result.fontWeight === '400' || result.fontWeight === 'normal') &&
                result.fontFamily.includes('Roboto-Regular'),
            'page rendered without errors': pageErrors.length === 0,
        }

        for (const [label, passed] of Object.entries(checks)) {
            console.log(`${passed ? 'PASS' : 'FAIL'}  ${testCase.name}: ${label}`)
            if (!passed) failures.push(`${testCase.name}: ${label} (${JSON.stringify(result)})`)
        }
    }

    await browser.close()
    server.close()

    if (failures.length) {
        console.error(`\n${failures.length} failure(s):\n${failures.map(failure => `- ${failure}`).join('\n')}`)
        process.exit(1)
    }
    console.log('\nPASS: Email & Calendar stays aligned on one 56px row at all tested widths.')
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
