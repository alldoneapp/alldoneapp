const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const buildDir = path.join(__dirname, '.build')

async function main() {
    if (!process.argv.includes('--skip-build')) {
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
                `harnessOut=${buildDir}`,
            ],
            { cwd: root, stdio: 'inherit' }
        )
    }
    const html =
        '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script src="/harness.js"></script></body></html>'
    const server = http.createServer((req, res) => {
        if (req.url === '/') {
            res.setHeader('Content-Type', 'text/html')
            res.end(html)
            return
        }
        const file = path.join(buildDir, path.basename(req.url))
        if (!fs.existsSync(file)) {
            res.writeHead(404)
            res.end()
            return
        }
        res.setHeader('Content-Type', 'application/javascript')
        res.end(fs.readFileSync(file))
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let browser
    try {
        const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
        browser = await chromium.launch({ args: ['--no-sandbox'] })
        for (const width of [1280, 390, 320]) {
            const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 600 })
            const errors = []
            page.on('pageerror', error => {
                errors.push(error.message)
                console.error(error.stack)
            })
            // A UI fixture must never read or write production data.
            await page.route(/https?:\/\/(?!127\.0\.0\.1)/, route => route.abort())
            await page.goto(`http://127.0.0.1:${server.address().port}/`)
            await page.waitForFunction(() => window.__ready)
            for (let index = 0; index < 3; index++) {
                console.log(`${width}px: opening add-task form ${index + 1}`)
                // Dispatch the burst in one browser turn, before React can
                // disable/hide the trigger or mount an overlay over it.
                await page.getByRole('button', { name: 'Add task', exact: true }).evaluate(button => {
                    button.click()
                    button.click()
                })
                await page.locator('.ql-editor').waitFor({ state: 'visible', timeout: 5000 })
                assert.equal(await page.locator('.ql-editor').count(), 1)
                assert.deepEqual(await page.evaluate(() => window.__taskCreationState()), { editors: 1, popups: 1 })
                await page.locator('.ql-editor').fill(`Draft ${index}`)
                await page.waitForTimeout(500)
                await page.keyboard.press('Escape')
                await page.locator('.ql-editor').waitFor({ state: 'detached', timeout: 5000 })
                assert.deepEqual(errors, [])
                assert.deepEqual(await page.evaluate(() => window.__taskCreationState()), { editors: 0, popups: 0 })
            }
            console.log(`PASS ${width}px: three double-press/type/close cycles, one editor and balanced locks`)
            await page.close()
        }
    } finally {
        if (browser) await browser.close()
        await new Promise(resolve => server.close(resolve))
    }
}
main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
