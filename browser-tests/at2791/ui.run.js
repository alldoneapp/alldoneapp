// Render the real status component, verify its controls and capture the review screenshot.
// Same Playwright setup as run.js; uses the existing app webpack/Babel harness pipeline.
const { chromium } = require('playwright')
const { execFileSync } = require('child_process')
const http = require('http')
const fs = require('fs')
const path = require('path')
const assert = require('assert/strict')
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
            `harnessEntry=${path.join(__dirname, 'ui.entry.js')}`,
            '--env',
            `harnessOut=${output}`,
        ],
        { cwd: root, stdio: 'inherit' }
    )
    const server = http.createServer((req, res) => {
        if (req.url === '/icons.ttf') {
            res.setHeader('Content-Type', 'font/ttf')
            res.end(fs.readFileSync(path.join(root, 'assets/fonts/alldone.ttf')))
            return
        }
        if (req.url === '/review-font.ttf') {
            res.setHeader('Content-Type', 'font/ttf')
            res.end(fs.readFileSync(path.join(root, 'assets/fonts/Roboto-Regular.ttf')))
            return
        }
        res.setHeader(
            'Content-Type',
            req.url === '/harness.js' ? 'application/javascript; charset=utf-8' : 'text/html; charset=utf-8'
        )
        res.end(
            req.url === '/harness.js'
                ? fs.readFileSync(path.join(output, 'harness.js'))
                : '<!doctype html><body><script src="/harness.js"></script></body>'
        )
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let browser
    try {
        browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
        const page = await browser.newPage({ viewport: { width: 1200, height: 640 } })
        page.on('pageerror', error => console.error(error))
        await page.goto(`http://127.0.0.1:${server.address().port}`)
        await page.getByRole('status').first().waitFor()
        await page.getByRole('button', { name: 'Aufnehmen', exact: true }).click()
        await page.getByRole('button', { name: 'Bildschirm-/Tab-Audio', exact: true }).click()
        assert.equal(await page.evaluate(() => window.microphoneClicks), 1)
        assert.equal(await page.evaluate(() => window.screenClicks), 1)
        assert.equal(await page.getByRole('button', { name: 'Diktieren', exact: true }).count(), 0)
        assert.equal(await page.getByRole('status').count(), 4)
        assert((await page.getByRole('status').nth(1).textContent()).includes('automatisch'))
        await page.getByRole('status').first().getByRole('button').click()
        await page.getByRole('status').nth(1).getByRole('button').last().click()
        assert.equal(await page.evaluate(() => window.stopClicks), 1)
        assert.equal(await page.evaluate(() => window.retryClicks), 1)
        await page.evaluate(() => document.fonts.ready)
        fs.mkdirSync(path.join(root, 'docs/images'), { recursive: true })
        await page.screenshot({ path: path.join(root, 'docs/images/meeting-microphone-status.png'), fullPage: true })
        console.log(
            'PASS real recording controls and status: one mic action, screen/tab action, German states, Stop, Retry; isolated-component screenshot saved'
        )
    } finally {
        await browser?.close()
        await new Promise(resolve => server.close(resolve))
    }
}
main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
