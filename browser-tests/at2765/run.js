// Node 22. Requires playwright (NODE_PATH may point at an external install) and Chromium.
// Run: node browser-tests/at2765/run.js
const path = require('path')
const fs = require('fs')
const http = require('http')
const assert = require('node:assert/strict')
const { execFileSync } = require('child_process')
const { chromium } = require('playwright')
const root = path.resolve(__dirname, '../..')
const output = path.join(__dirname, '.build')

async function main() {
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
        ],
        { cwd: root, stdio: 'inherit' }
    )
    const server = http.createServer((req, res) => {
        if (req.url.startsWith('/harness.js')) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
            res.end(fs.readFileSync(path.join(output, 'harness.js')))
        } else if (req.url.startsWith('/fonts/')) {
            res.setHeader('Content-Type', 'font/ttf')
            res.end(fs.readFileSync(path.join(output, 'fonts', path.basename(req.url))))
        } else
            res.end(
                '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><script defer src="/harness.js"></script>'
            )
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let browser
    try {
        browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
        for (const width of [390, 1280]) {
            const page = await browser.newPage({ viewport: { width, height: 700 }, locale: 'de-DE' })
            const errors = []
            page.on('pageerror', error => errors.push(error.message))
            await page.goto(`http://127.0.0.1:${server.address().port}`)
            const status = page.getByRole('status')
            await status.waitFor()
            await page.evaluate(() => document.fonts.ready)
            assert.match(await status.textContent(), /Verbindung mit Anna wird hergestellt/)
            const ring = page.getByTestId('voice-call-connecting-ring')
            const before = await ring.evaluate(node => getComputedStyle(node).transform)
            await page.waitForTimeout(200)
            const after = await ring.evaluate(node => getComputedStyle(node).transform)
            assert.notEqual(after, before, 'The ring must actually rotate')
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
            if (width === 390) await page.screenshot({ path: path.join(output, 'connecting.png') })
            await page.emulateMedia({ reducedMotion: 'reduce' })
            await page.waitForFunction(() => document.getAnimations().length === 0)
            assert.match(await status.textContent(), /Verbindung mit Anna wird hergestellt/)
            assert.deepEqual(errors, [])
            console.log(`PASS ${width}px: animated connection, German copy, no overflow, live reduced-motion change`)
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
