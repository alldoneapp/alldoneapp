const fs = require('fs')
const http = require('http')
const path = require('path')
const assert = require('node:assert/strict')
const { execFileSync } = require('child_process')
let playwright
try {
    playwright = require('playwright')
} catch (_) {
    playwright = require(path.join(process.env.PLAYWRIGHT_HOME || '/home/user/repro', 'node_modules/playwright'))
}
const { chromium } = playwright
const root = path.resolve(__dirname, '../..')
const out = path.join(__dirname, '.build')
const circleSize = 24
execFileSync(
    path.join(root, 'web-bundler/node_modules/.bin/webpack'),
    [
        '--config',
        path.join(root, 'browser-tests/webpack.harness.js'),
        '--mode',
        'development',
        '--env',
        `harnessEntry=${path.join(__dirname, 'harness.entry.js')}`,
        '--env',
        `harnessOut=${out}`,
    ],
    { cwd: root, stdio: 'inherit' }
)
fs.writeFileSync(
    out + '/index.html',
    `<!doctype html><html><head><style>@font-face{font-family:alldone;src:url(/alldone.ttf)}html,body,#root{height:100%;margin:0;box-sizing:border-box}#root{display:flex}</style></head><body><div id="root"></div><script src="/harness.js"></script></body></html>`
)
async function main() {
    const server = http.createServer((req, res) => {
        const name = req.url === '/' ? 'index.html' : path.basename(req.url.split('?')[0]) || 'index.html'
        res.setHeader(
            'Content-Type',
            name.endsWith('.js') ? 'application/javascript' : name.endsWith('.ttf') ? 'font/ttf' : 'text/html'
        )
        res.end(fs.readFileSync(name.endsWith('.ttf') ? root + '/assets/fonts/' + name : out + '/' + name))
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let browser
    try {
        browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
        const page = await browser.newPage()
        const errors = []
        page.on('pageerror', error => errors.push(error.message))
        for (const [name, width, height, left, right, bottom, query, contentLeft] of [
            ['desktop-expanded', 1366, 768, 0, 0, 0, '', 263],
            ['desktop-collapsed', 1366, 768, 0, 0, 0, 'collapsed', 56],
            ['compact-collapsed', 700, 768, 0, 0, 0, 'collapsed', 56],
            ['compact-expanded-mobile', 700, 768, 0, 0, 0, '', 0],
            ['anonymous-desktop', 1366, 768, 0, 0, 0, 'anonymous', 0],
            ['anna-desktop', 1366, 768, 0, 0, 0, 'anna=1', 0],
            ['phone', 390, 844, 0, 0, 0, '', 0],
            ['phone-safe-area', 390, 844, 0, 0, 34, '', 0],
            ['landscape-safe-area', 700, 390, 44, 44, 21, '', 0],
            ['wide-landscape-safe-area', 844, 390, 44, 44, 21, '', 263],
        ]) {
            await page.setViewportSize({ width, height })
            // Install simulated device insets before the first React render,
            // so the real safe-area cache measures this device on first use.
            await page.route('**/*', async route => {
                if (route.request().resourceType() !== 'document') return route.continue()
                await route.fulfill({
                    contentType: 'text/html',
                    body: fs
                        .readFileSync(out + '/index.html', 'utf8')
                        .replace(
                            '</style>',
                            `body{padding-left:${left}px;padding-right:${right}px}[data-safe-area-inset-probe]{padding-left:${left}px!important;padding-right:${right}px!important;padding-bottom:${bottom}px!important}</style>`
                        ),
                })
            })
            await page.goto(`http://127.0.0.1:${server.address().port}/?${query}&anna=${query === 'anna=1' ? 1 : 0}`)
            await page.unroute('**/*')
            const loader = page.getByTestId('loading-data-spinner')
            await loader.waitFor({ state: 'visible' })
            await page.evaluate(() => document.fonts.ready)
            const bounds = await loader.boundingBox()
            const plus = await page.getByTestId('reference-add-task-button').boundingBox()
            const circle = await loader.locator(':scope > div').boundingBox()
            assert.equal(circle.width, circleSize)
            assert.equal(circle.height, circleSize)
            assert.equal(bounds.y + bounds.height / 2, plus.y + plus.height / 2)
            assert.equal(bounds.y + bounds.height / 2, height - 52 - bottom)
            assert.equal(await loader.evaluate(node => getComputedStyle(node).pointerEvents), 'none')
            assert.equal(bounds.x, contentLeft + 24 + left)
            const content = await page.locator('#main-content').boundingBox()
            assert.equal(bounds.x, content.x + 24)
            assert.equal(bounds.width, circleSize)
            assert.equal(
                await loader.evaluate(node => {
                    const icon = [...node.querySelectorAll('*')].find(child => child.style.fontFamily === 'alldone')
                    const bounds = icon.getBoundingClientRect()
                    if (!bounds.width || !bounds.height) throw new Error('Spinner glyph has no painted dimensions')
                    return getComputedStyle(icon).fontSize
                }),
                '16px'
            )
            await loader.evaluate(node => {
                const behind = document.createElement('button')
                const rect = node.getBoundingClientRect()
                behind.style.cssText = `position:fixed;left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px;z-index:9999`
                behind.addEventListener('click', () => (window.__clickThrough = true))
                document.body.appendChild(behind)
            })
            await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
            assert.equal(await page.evaluate(() => window.__clickThrough), true)
            await page.evaluate(() => document.querySelector('button').remove())
            await page.screenshot({ path: out + '/' + 'after-' + name + '.png' })
            await page.evaluate(() => {
                const scroll = [...document.querySelectorAll('div')].find(
                    node => getComputedStyle(node).overflowY === 'auto' && node.scrollHeight > node.clientHeight
                )
                scroll.scrollTop = 300
            })
            assert.deepEqual(await loader.boundingBox(), bounds)
            console.log(
                JSON.stringify({
                    name,
                    circleSize,
                    contentLeft,
                    x: circle.x,
                    centerY: circle.y + circle.height / 2,
                    plusCenterY: plus.y + plus.height / 2,
                    scrolling: 'fixed',
                    clicks: 'pass through',
                })
            )
        }
        assert.deepEqual(errors, [])
    } finally {
        if (browser) await browser.close()
        await new Promise(resolve => server.close(resolve))
    }
}
main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
