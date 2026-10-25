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
        if (req.url === '/medium-font.ttf') {
            res.setHeader('Content-Type', 'font/ttf')
            res.end(fs.readFileSync(path.join(root, 'assets/fonts/Roboto-Medium.ttf')))
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
        await page.getByRole('button', { name: 'Aufnehmen', exact: true }).first().click()
        await page.getByRole('button', { name: 'Bildschirm-/Tab-Audio', exact: true }).first().click()
        assert.equal(await page.evaluate(() => window.microphoneClicks), 1)
        assert.equal(await page.evaluate(() => window.screenClicks), 1)
        assert.equal(await page.getByRole('button', { name: 'Diktieren', exact: true }).count(), 0)
        assert.equal(await page.getByRole('status').count(), 5)
        assert((await page.getByRole('status').nth(1).textContent()).includes('offline'))
        assert((await page.getByRole('status').nth(4).textContent()).includes('Transkriptionsdienst'))
        await page.getByRole('status').first().getByRole('button').click()
        await page.getByRole('status').nth(1).getByRole('button').last().click()
        assert.equal(await page.evaluate(() => window.stopClicks), 1)
        assert.equal(await page.evaluate(() => window.retryClicks), 1)
        await page.evaluate(() => document.fonts.ready)
        for (const width of [1061, 390, 320]) {
            await page.setViewportSize({ width, height: 844 })
            const layout = await page.getByRole('status').evaluateAll(elements =>
                elements.map(element => {
                    const rect = element.getBoundingClientRect()
                    return {
                        font: getComputedStyle(element).fontFamily,
                        buttonFont: getComputedStyle(element.querySelector('button')).fontFamily,
                        overflow: element.scrollWidth > element.clientWidth,
                        toolbarGap: element.nextElementSibling.getBoundingClientRect().top - rect.bottom,
                        controlsInside: Array.from(element.querySelectorAll('button')).every(button => {
                            const bounds = button.getBoundingClientRect()
                            return bounds.right <= rect.right && bounds.bottom <= rect.bottom
                        }),
                    }
                })
            )
            for (const status of layout) {
                assert(status.font.includes('Roboto-Regular'), `status font at ${width}px`)
                assert(status.buttonFont.includes('Roboto-Medium'), `button font at ${width}px`)
                assert.equal(status.overflow, false, `status overflow at ${width}px`)
                assert(status.toolbarGap >= 8, `toolbar overlap at ${width}px`)
                assert(status.controlsInside, `controls outside status at ${width}px`)
            }
        }
        await page.setViewportSize({ width: 1200, height: 1100 })
        fs.mkdirSync(path.join(root, 'docs/images'), { recursive: true })
        await page.screenshot({ path: path.join(root, 'docs/images/meeting-microphone-status.png'), fullPage: true })
        console.log(
            'PASS real recording controls and status: German states, Stop, Retry, fonts and responsive geometry at 1061/390/320px; isolated-component screenshot saved'
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
