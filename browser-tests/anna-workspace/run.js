const path = require('path')
const fs = require('fs')
const http = require('http')
const assert = require('assert/strict')
const { execFileSync } = require('child_process')
const ROOT = path.resolve(__dirname, '../..')
const BUILD = path.join(__dirname, '.build')
execFileSync(
    path.join(ROOT, 'web-bundler/node_modules/.bin/webpack'),
    [
        '--config',
        path.join(ROOT, 'browser-tests/webpack.harness.js'),
        '--mode',
        'development',
        '--env',
        `harnessEntry=${path.join(__dirname, 'harness.entry.js')}`,
        '--env',
        `harnessOut=${BUILD}`,
        '--env',
        `harnessSetup=${path.join(__dirname, 'webpack.setup.js')}`,
    ],
    { cwd: path.join(ROOT, 'web-bundler'), stdio: 'inherit' }
)
fs.writeFileSync(
    path.join(BUILD, 'index.html'),
    '<!doctype html><html><head><title>Launch | Alldone</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body,#root{margin:0;height:100%;width:100%;overflow:hidden}#root{display:flex}</style></head><body><div id="root"></div><script src="/harness.js"></script></body></html>'
)
const server = http.createServer((req, res) => {
    const file = path.join(BUILD, req.url === '/' || !req.url.includes('.') ? 'index.html' : req.url)
    if (!file.startsWith(BUILD) || !fs.existsSync(file)) {
        res.writeHead(404).end()
        return
    }
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : 'application/javascript')
    res.end(fs.readFileSync(file))
})
async function main() {
    const { chromium } = require('playwright')
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const browser = await chromium.launch({
        headless: true,
        ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}),
    })
    try {
        for (const width of [1440, 1024, 390]) {
            const page = await browser.newPage({ viewport: { width, height: 900 } })
            const errors = []
            page.on('pageerror', error => errors.push(error.message))
            await page.goto(`http://127.0.0.1:${server.address().port}/`)
            await page.getByLabel('Message Anna').fill('Unsent conversation draft')
            if (width <= 760) await page.locator('.anna-mobile-tabs').getByText('Workspace', { exact: true }).click()
            await page.getByLabel('Workspace draft').fill('Unsaved workspace edit')
            await page.screenshot({ path: path.join(BUILD, `workspace-${width}.png`) })
            const workspace = await page.getByLabel('Workspace draft').elementHandle()
            const chat = await page.getByLabel('Message Anna').elementHandle()
            await page.getByText('Alldone fullscreen', { exact: true }).click()
            assert.equal(await workspace.inputValue(), 'Unsaved workspace edit')
            await page.getByText('Zoom out to assistant', { exact: true }).click()
            if (width <= 760) await page.locator('.anna-mobile-tabs').getByText('Chat', { exact: true }).click()
            assert.equal(await chat.inputValue(), 'Unsent conversation draft')
            assert.equal(await workspace.inputValue(), 'Unsaved workspace edit')
            const geometry = await page.evaluate(() => ({
                width: document.documentElement.clientWidth,
                scrollWidth: document.documentElement.scrollWidth,
                chat: document.querySelector('.anna-conversation').getBoundingClientRect().toJSON(),
                workspace: document.querySelector('.anna-stage').getBoundingClientRect().toJSON(),
            }))
            assert.ok(geometry.scrollWidth <= geometry.width + 1, JSON.stringify(geometry))
            if (width > 760) assert.ok(geometry.chat.right <= geometry.workspace.left, 'Desktop panes overlap')
            else assert.equal(await page.locator('.anna-stage').getAttribute('aria-hidden'), 'true')
            await page.screenshot({ path: path.join(BUILD, `chat-${width}.png`) })
            assert.deepEqual(errors, [])
            console.log(`PASS ${width}px: mounted editors survive zoom; no overflow or runtime errors`)
            await page.close()
        }
    } finally {
        await browser.close()
        server.close()
    }
}
main().catch(error => {
    console.error(error)
    server.close()
    process.exitCode = 1
})
