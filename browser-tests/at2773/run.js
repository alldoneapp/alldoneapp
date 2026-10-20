// PLAYWRIGHT_MODULE may point to an external install; no app dependency changes.
const path = require('path')
const fs = require('fs')
const http = require('http')
const assert = require('node:assert/strict')
const { execFileSync } = require('child_process')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = path.resolve(__dirname, '../..')
const output = path.join(__dirname, '.build')
const gap = page =>
    page.locator('.anna-messages').evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)
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
        if (req.url.startsWith('/harness.js')) {
            res.setHeader('Content-Type', 'application/javascript')
            res.end(fs.readFileSync(path.join(output, 'harness.js')))
        } else if (req.url.startsWith('/fonts/'))
            res.end(fs.readFileSync(path.join(output, 'fonts', path.basename(req.url))))
        else
            res.end(
                '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script defer src="/harness.js"></script>'
            )
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let browser
    try {
        browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
        for (const width of [1280, 390]) {
            const page = await browser.newPage({ viewport: { width, height: 800 }, hasTouch: width === 390 })
            const errors = []
            page.on('pageerror', error => errors.push(error.message))
            await page.goto(`http://127.0.0.1:${server.address().port}`)
            await page.waitForFunction(() => !!window.motionHarness)
            await page.evaluate(() => document.fonts.ready)
            await page.waitForTimeout(450)
            assert.ok((await gap(page)) <= 2, 'Initial history must land at the bottom')
            // A large persisted chunk should produce multiple visible prefixes, bounded in time.
            const samples = await page.evaluate(async () => {
                const answer = document.querySelector('[data-answer]')
                const samples = []
                window.motionHarness.append('A thoughtful response with clear steps. '.repeat(50))
                for (let i = 0; i < 18; i++) {
                    await new Promise(requestAnimationFrame)
                    samples.push({
                        length: answer.textContent.length,
                        top: document.querySelector('.anna-messages').scrollTop,
                    })
                }
                return samples
            })
            assert.ok(new Set(samples.map(item => item.length)).size >= 3, 'Text must be revealed in several paints')
            assert.ok(
                new Set(samples.map(item => item.top)).size >= 4,
                `Scrolling must move through intermediate positions: ${JSON.stringify(samples)}`
            )
            await page.waitForTimeout(650)
            assert.ok((await gap(page)) <= 2, 'Long streamed answer must settle at the bottom')
            const log = page.locator('.anna-messages')
            await log.hover()
            await page.mouse.wheel(0, -450)
            await page.waitForTimeout(250)
            const top = await log.evaluate(node => node.scrollTop)
            await page.evaluate(() => window.motionHarness.append('\n\nMore streamed content. '.repeat(30)))
            await page.waitForTimeout(400)
            assert.ok(
                Math.abs((await log.evaluate(node => node.scrollTop)) - top) <= 1,
                'Streaming must preserve the reader position'
            )
            await page.getByRole('button', { name: 'Latest messages' }).click()
            await page.waitForTimeout(650)
            assert.ok((await gap(page)) <= 2)
            await page.evaluate(() => window.motionHarness.resize())
            await page.waitForTimeout(650)
            assert.ok((await gap(page)) <= 2, 'Composer resizing must preserve follow')
            if (width === 390) {
                const session = await page.context().newCDPSession(page)
                const before = await log.evaluate(node => node.scrollTop)
                await session.send('Input.dispatchTouchEvent', {
                    type: 'touchStart',
                    touchPoints: [{ x: 180, y: 170 }],
                })
                for (const y of [200, 240, 290, 350, 410]) {
                    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 180, y }] })
                    await page.waitForTimeout(20)
                }
                await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
                await page.evaluate(async () => {
                    const node = document.querySelector('.anna-messages')
                    let previous = node.scrollTop,
                        stable = 0
                    for (let i = 0; i < 180 && stable < 10; i++) {
                        await new Promise(requestAnimationFrame)
                        stable = Math.abs(node.scrollTop - previous) < 0.1 ? stable + 1 : 0
                        previous = node.scrollTop
                    }
                })
                const position = await log.evaluate(node => node.scrollTop)
                assert.ok(position < before - 30, 'A real touch swipe must move into history')
                await page.evaluate(() => window.motionHarness.append(' More after touch.'.repeat(20)))
                await page.waitForTimeout(400)
                assert.ok(
                    Math.abs((await log.evaluate(node => node.scrollTop)) - position) <= 1,
                    `Touch scrolling must retain control: before=${position}, after=${await log.evaluate(node => node.scrollTop)}`
                )
                await page.getByRole('button', { name: 'Latest messages' }).click()
                await page.waitForTimeout(650)
                await session.detach()
            }
            await page.evaluate(() =>
                window.motionHarness.replace(
                    '# Polished response\n\n**Markdown stays formatted.**\n\n| Step | State |\n| --- | --- |\n| Review | Ready |\n\n```js\nconst calm = true;'
                )
            )
            await page.waitForTimeout(300)
            assert.ok((await page.getByText('const calm = true;', { exact: false }).count()) > 0)
            await page.evaluate(() => {
                window.motionHarness.append('\n```\n\nFinished.')
                window.motionHarness.finish()
            })
            await page.waitForTimeout(400)
            assert.ok((await page.getByText('Finished.', { exact: false }).count()) > 0)
            await page.emulateMedia({ reducedMotion: 'reduce' })
            await page.waitForTimeout(100)
            await page.evaluate(() => window.motionHarness.resize())
            await page.waitForTimeout(50)
            assert.equal(await page.evaluate(() => document.getAnimations().length), 0)
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
            assert.equal(await page.locator('[aria-label="Draft"]').textContent(), 'Keep this draft')
            fs.mkdirSync(path.join(__dirname, 'screenshots'), { recursive: true })
            await page.screenshot({ path: path.join(__dirname, 'screenshots', `${width}.png`) })
            assert.deepEqual(errors, [])
            console.log(
                `PASS ${width}px: paced streaming, fluid follow, reader control, resize, markdown, reduced motion, draft retained`
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
