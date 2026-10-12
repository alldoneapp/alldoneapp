const path = require('path')
const fs = require('fs')
const http = require('http')
const assert = require('assert/strict')
const { execFileSync } = require('child_process')
const { chromium } = require('playwright')
const ROOT = path.resolve(__dirname, '../..')
const BUILD = path.join(__dirname, '.build')
execFileSync(
    path.join(ROOT, 'web-bundler/node_modules/.bin/webpack'),
    [
        '--config',
        path.join(ROOT, 'browser-tests/webpack.harness.js'),
        '--mode',
        'development',
        '--no-cache',
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
    '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/harness.js"></script></body></html>'
)
const server = http.createServer()
async function main() {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || undefined })
    try {
        for (const width of [1440, 390]) {
            const context = await browser.newContext({ viewport: { width, height: 900 } })
            // Supply only the app assets while offline, like a precached app shell.
            // No server messages or callable responses are supplied during reload.
            await context.route('**/*', route => {
                const pathname = new URL(route.request().url()).pathname
                const file = path.join(BUILD, pathname === '/' ? 'index.html' : pathname)
                if (!file.startsWith(BUILD + path.sep) || !fs.existsSync(file)) return route.abort()
                return route.fulfill({
                    path: file,
                    contentType: file.endsWith('.html') ? 'text/html' : 'application/javascript',
                })
            })
            const page = await context.newPage()
            page.setDefaultTimeout(15000)
            const errors = []
            page.on('pageerror', error => {
                errors.push(error.message)
                console.error(error.message)
            })
            const origin = `http://127.0.0.1:${server.address().port}`
            await page.goto(origin)
            console.log(`Mounted ${width}px harness`)
            await page.waitForFunction(() => document.querySelectorAll('[data-message]').length === 100)
            await page.getByLabel('Draft').fill('Draft saved while offline')
            await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
            await context.setOffline(true)
            await page.goto(`${origin}/?hold=1`)
            await page.getByRole('status').filter({ hasText: 'Offline' }).waitFor()
            const paint = await page.evaluate(() => window.__firstPaint)
            assert.equal(paint.messages, 100, 'Both days must render 50 saved messages on the first commit')
            assert.ok(!paint.text.includes('Loading'), 'Cached startup must not show an empty loading transcript')
            assert.deepEqual(
                await page.evaluate(() => window.__calls),
                [],
                'Offline startup must not invoke a callable'
            )
            assert.equal(await page.getByLabel('Draft').inputValue(), 'Draft saved while offline')
            assert.equal(await page.getByRole('button', { name: 'Send' }).isDisabled(), true)
            await page.getByLabel('Draft').fill('Updated offline draft')
            await page.screenshot({ path: path.join(BUILD, `offline-${width}.png`) })
            await context.setOffline(false)
            await page.getByRole('status').filter({ hasText: 'Online' }).waitFor()
            assert.equal(
                await page.locator('[data-message]').count(),
                100,
                'Keep saved messages while reconnect is pending'
            )
            await page.evaluate(() => {
                window.__release()
                window.__replaceToday('Authoritative edit')
            })
            await page.getByText('Authoritative edit', { exact: true }).waitFor()
            assert.equal(await page.locator('[data-message]').count(), 51)
            await page.evaluate(() => window.__replaceToday(''))
            await page.waitForFunction(() => document.querySelectorAll('[data-message]').length === 50)
            await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
            await context.setOffline(true)
            await page.reload()
            await page.getByRole('status').filter({ hasText: 'Offline' }).waitFor()
            assert.equal(
                (await page.evaluate(() => window.__firstPaint)).messages,
                50,
                'Server deletion must persist offline'
            )
            assert.equal(await page.getByLabel('Draft').inputValue(), 'Updated offline draft')
            await page.evaluate(() => window.__switchAccount())
            await page.waitForFunction(() => document.querySelectorAll('[data-message]').length === 0)
            assert.equal(
                await page.getByLabel('Draft').inputValue(),
                '',
                'Account change must not leak the previous draft'
            )
            assert.deepEqual(errors, [])
            console.log(
                `PASS ${width}px: cached first paint, offline reload/draft, reconnect edits/deletions, account isolation`
            )
            await context.close()
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
