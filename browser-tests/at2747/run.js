const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

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
            `harnessSetup=${path.join(__dirname, 'setup.js')}`,
            '--env',
            `harnessOut=${output}`,
        ],
        { cwd: root, stdio: 'inherit' }
    )
    const server = http.createServer((req, res) => {
        const pathname = req.url.split('?')[0]
        if (pathname.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript')
            res.end(fs.readFileSync(path.join(output, path.basename(pathname))))
        } else if (pathname === '/alldone.ttf' || pathname === '/Roboto-Regular.ttf') {
            res.setHeader('Content-Type', 'font/ttf')
            res.end(fs.readFileSync(path.join(root, 'assets/fonts', path.basename(pathname))))
        } else {
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(
                `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@font-face{font-family:alldone;src:url('/alldone.ttf')}@font-face{font-family:Roboto-Regular;src:url('/Roboto-Regular.ttf')}body{margin:0;font-family:Roboto-Regular}</style><div id="root"></div><script defer src="/harness.js"></script>`
            )
        }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let browser
    try {
        browser = await require(process.env.PLAYWRIGHT_MODULE || 'playwright').chromium.launch({
            args: ['--no-sandbox'],
        })
        const address = `http://127.0.0.1:${server.address().port}/`
        for (const [name, width, mobile, expanded, anonymous, anna, left] of [
            ['desktop', 1280, false, true, false, false, 287],
            ['collapsed-sidebar', 1024, false, false, false, false, 80],
            ['mobile', 390, true, true, false, false, 24],
            ['small-phone', 320, true, true, false, false, 24],
            ['anonymous', 1280, false, true, true, false, 24],
            ['anna', 1280, false, true, false, true, 24],
        ]) {
            const page = await browser.newPage({ viewport: { width, height: 800 } })
            const errors = []
            page.on('pageerror', error => errors.push(error.message))
            page.on('console', message => {
                if (message.type() === 'error') console.error(message.text())
            })
            page.on('requestfailed', request => console.error(request.url(), request.failure()?.errorText))
            await page.route('**/*', route =>
                route.request().url().startsWith(address) ? route.continue() : route.abort()
            )
            await page.goto(address + (anna ? '?anna=1' : ''))
            await page.waitForFunction(() => !!window.noteLoadingFixture)
            await page.evaluate(() =>
                Promise.all([document.fonts.load('16px alldone'), document.fonts.load('16px "Roboto-Regular"')])
            )
            const clockTime = new Date('2026-10-13T00:00:00Z')
            await page.clock.install({ time: clockTime })
            await page.clock.pauseAt(clockTime)
            await page.evaluate(
                ({ mobile, expanded, anonymous }) =>
                    window.noteLoadingFixture.update({
                        smallScreenNavigation: mobile,
                        loggedUser: { isAnonymous: anonymous, sidebarExpanded: expanded },
                        isLoadingNoteData: true,
                    }),
                { mobile, expanded, anonymous }
            )
            const spinner = page.getByTestId('loading-data-spinner')
            await page.clock.runFor(299)
            assert.equal(await spinner.count(), 0, 'no flash before delay')
            await page.clock.runFor(1)
            await spinner.waitFor()
            const bounds = await spinner.boundingBox()
            assert.deepEqual(bounds, { x: left, y: 736, width: 24, height: 24 })
            assert.equal(await spinner.evaluate(node => getComputedStyle(node).pointerEvents), 'none')
            await page.getByRole('button', { name: 'Editor action' }).click()
            await page.screenshot({ path: path.join(output, `${name}.png`) })
            // Hand off from the cold load to the cached-content comparison:
            // both sources share one indicator, and completion never leaks it.
            await page.evaluate(() => {
                window.noteLoadingFixture.sync()
                window.noteLoadingFixture.update({ isLoadingNoteData: false })
            })
            await page.clock.runFor(500)
            assert.equal(await spinner.count(), 1)
            await page.evaluate(() => window.noteLoadingFixture.finish())
            await page.clock.runFor(1)
            assert.equal(await spinner.count(), 0)
            assert.deepEqual(errors, [])
            await page.close()
        }
        console.log('PASS: 6 browser layouts; compact geometry, delay, note/sync handoff, completion, pointer events')
    } finally {
        await browser?.close()
        await new Promise(resolve => server.close(resolve))
    }
}
main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
