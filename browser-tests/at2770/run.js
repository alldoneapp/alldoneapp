// Node 22; Playwright and Chromium may be supplied externally through NODE_PATH
// and PLAYWRIGHT_BROWSERS_PATH. No login, production requests or real reloads.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { chromium } = require('playwright')
const root = path.resolve(__dirname, '../..')
const output = path.join(__dirname, '.build')

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
                `harnessOut=${output}`,
                '--env',
                `harnessSetup=${path.join(__dirname, 'setup.js')}`,
            ],
            { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=1536' } }
        )
    }
    const server = http.createServer((req, res) => {
        if (req.url === '/') {
            res.setHeader('Content-Type', 'text/html')
            return res.end(
                '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script src="/harness.js"></script>'
            )
        }
        const file = path.resolve(output, '.' + req.url)
        if (!file.startsWith(output + path.sep) || !fs.existsSync(file)) {
            res.writeHead(404)
            return res.end()
        }
        res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : 'font/ttf')
        res.end(fs.readFileSync(file))
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let browser
    try {
        browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
        for (const width of [390, 1440]) {
            const page = await browser.newPage({ viewport: { width, height: 900 } })
            page.setDefaultTimeout(10000)
            const errors = []
            page.on('pageerror', error => {
                errors.push(error.message)
                console.error(error.message)
            })
            await page.goto(`http://127.0.0.1:${server.address().port}`)
            const start = page.getByTestId('startNewDayButton')
            await start.waitFor()
            const original = await start.elementHandle()
            for (const layout of ['split', 'chat', 'alldone', 'split']) {
                await page.evaluate(layout => window.layout(layout), layout)
                if (layout === 'chat') {
                    await page.waitForFunction(
                        () =>
                            getComputedStyle(
                                document
                                    .querySelector('[data-testid="startNewDayButton"]')
                                    .closest('[data-testid="workspace-overlay-layer"]')
                            ).visibility === 'hidden'
                    )
                    assert.equal(await start.isVisible(), false)
                } else {
                    await start.waitFor({ state: 'visible' })
                    assert.equal(await start.count(), 1)
                    assert(
                        await original.evaluate(
                            node => node === document.querySelector('[data-testid="startNewDayButton"]')
                        )
                    )
                    const box = await start.boundingBox()
                    assert(box.x >= (layout === 'split' ? Math.floor(width * 0.4) : 0))
                    assert(box.x + box.width <= width + 1)
                }
            }
            await page.screenshot({ path: path.join(output, `new-day-${width}.png`) })
            await start.click()
            await start.waitFor({ state: 'detached' })
            // AT-2789: drive the real global host in every layout. Browser
            // clicks also verify that no hidden workspace/scrim intercepts them.
            let clicks = 0
            for (const dialog of ['mandatory', 'optional', 'timeout']) {
                await page.evaluate(name => window.dialog(name), dialog)
                const reload =
                    dialog === 'mandatory'
                        ? page.getByTestId('refreshMandatory')
                        : page.getByText('Reload', { exact: true })
                await reload.waitFor({ state: 'attached' })
                await reload.waitFor()
                const originalReload = await reload.elementHandle()
                for (const layout of ['split', 'chat', 'alldone', 'chat']) {
                    await page.evaluate(layout => window.layout(layout), layout)
                    await reload.waitFor({ state: 'visible' })
                    assert.equal(await reload.count(), 1)
                    assert(await originalReload.evaluate(node => node.isConnected))
                    const box = await reload.boundingBox()
                    assert(box.x >= 0 && box.x + box.width <= width + 1)
                    assert(box.y >= 0 && box.y + box.height <= 901)
                    await reload.click()
                    assert.equal(await page.evaluate(() => window.reloadClicks), ++clicks)
                }
                if (dialog === 'optional') {
                    await page.screenshot({ path: path.join(output, `chat-reload-${width}.png`) })
                    await reload.locator('..').locator('..').locator('[tabindex="0"]').last().click()
                    await reload.waitFor({ state: 'detached' })
                    await page.evaluate(() => window.layout('alldone'))
                    assert.equal(await reload.count(), 0)
                }
            }
            await page.evaluate(() => window.layout('split'))
            await page.evaluate(() => window.dialog('confirmation'))
            await page.getByText('Confirm browser check', { exact: true }).waitFor()
            await page.getByText('Ok', { exact: true }).click()
            await page.getByText('Confirm browser check', { exact: true }).waitFor({ state: 'detached' })
            assert.deepEqual(errors, [])
            console.log(
                `PASS ${width}px: one persistent New Day instance, New Day pane scope, Start new day, mandatory/optional/timeout reload in split/chat/normal layouts, optional dismissal, confirmation dismissal; no runtime errors`
            )
            await page.close()
        }
    } finally {
        await browser?.close()
        await new Promise(resolve => server.close(resolve))
    }
}
main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
