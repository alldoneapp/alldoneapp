const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

async function main() {
    const root = path.resolve(__dirname, '../..')
    const output = path.join(__dirname, '.build')
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
            { cwd: root, stdio: 'inherit' }
        )
    }
    const server = http.createServer((req, res) => {
        if (/^\/fonts\/(Roboto-(?:Regular|Medium|Bold)|alldone)\.ttf$/.test(req.url)) {
            res.setHeader('Content-Type', 'font/ttf')
            res.end(fs.readFileSync(path.join(root, 'assets', req.url)))
            return
        }
        res.setHeader('Content-Type', req.url === '/harness.js' ? 'application/javascript' : 'text/html')
        res.end(
            req.url === '/harness.js'
                ? fs.readFileSync(path.join(output, 'harness.js'))
                : `<!doctype html><meta charset="utf-8"><style>
            ${['Roboto-Regular', 'Roboto-Medium', 'Roboto-Bold', 'alldone'].map(font => `@font-face{font-family:'${font}';src:url('/fonts/${font}.ttf');}`).join('')}
            html,body{margin:0;min-height:100%;}*{flex-basis:auto!important;}
            </style><meta name="viewport" content="width=device-width, initial-scale=1"><title>AT-2726</title><script defer src="/harness.js"></script>`
        )
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let browser
    try {
        const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
        browser = await chromium.launch({ args: ['--no-sandbox'] })
        for (const touch of [false, true]) {
            const page = await browser.newPage({
                viewport: touch ? { width: 390, height: 844 } : { width: 1280, height: 900 },
                hasTouch: touch,
                isMobile: touch,
            })
            const errors = []
            page.on('pageerror', error => {
                errors.push(error.message)
                console.error('page error:', error.message)
            })
            if (process.env.HARNESS_DEBUG) {
                page.on('requestfailed', request => console.error(request.url(), request.failure()))
                page.on('response', response => console.log('response:', response.status(), response.url()))
            }
            const url = `http://127.0.0.1:${server.address().port}`
            const load = async () => {
                await page.goto(url)
                await page.locator('#milestone [tabindex="0"]').waitFor({ timeout: 10000 })
            }
            const clickRow = () =>
                touch
                    ? page.locator('#milestone [tabindex="0"]').tap()
                    : page.locator('#milestone [tabindex="0"]').click()
            const swipe = async (selector, synthesizeClick = false) => {
                if (synthesizeClick)
                    await page.evaluate(
                        ({ selector, touch }) => {
                            // After Hammer's real release handler, replay a compatibility
                            // click in that same browser turn, even when Chromium's touch
                            // slop would normally suppress it for a drag.
                            window.addEventListener(
                                touch ? 'touchend' : 'mouseup',
                                () => {
                                    window.__events.push({ type: 'synthesized-click' })
                                    document
                                        .querySelector(`${selector} [tabindex="0"]`)
                                        .dispatchEvent(
                                            new MouseEvent('click', { bubbles: true, cancelable: true, view: window })
                                        )
                                },
                                { once: true }
                            )
                        },
                        { selector, touch }
                    )
                const box = await page.locator(`${selector} [tabindex="0"]`).first().boundingBox()
                const start = { x: box.x + box.width - 24, y: box.y + box.height / 2 }
                const distance = Math.min(320, box.width - 48)
                const cdp = touch ? await page.context().newCDPSession(page) : null
                if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
                else {
                    await page.mouse.move(start.x, start.y)
                    await page.mouse.down()
                }
                for (let step = 1; step <= 18; step++) {
                    const point = { x: start.x - (distance * step) / 18, y: start.y }
                    if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] })
                    else await page.mouse.move(point.x, point.y)
                    await page.waitForTimeout(10)
                }
                // The reminder background must actually be exposed before release.
                const moved = await page.locator(selector).evaluate(node =>
                    [...node.querySelectorAll('*')].some(child => {
                        const transform = getComputedStyle(child).transform
                        return transform.startsWith('matrix(') && Number(transform.slice(7, -1).split(',')[4]) < -80
                    })
                )
                assert.equal(moved, true, 'No real swipe translation occurred')
                if (touch) {
                    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
                    await cdp.detach()
                } else await page.mouse.up()
            }
            await load()
            await clickRow()
            await page.locator('#goals').waitFor()
            assert.equal(await page.evaluate(() => window.__state().showSwipeDueDatePopup.visible), false)
            await load()
            await swipe('#milestone')
            await page.waitForTimeout(600)
            const state = await page.evaluate(() => window.__state())
            console.log(
                `${touch ? 'touch' : 'mouse'} release:`,
                JSON.stringify({
                    popup: state.showSwipeDueDatePopup,
                    navigationCount: state.navigationCount,
                    events: await page.evaluate(() => window.__events),
                })
            )
            assert.equal(state.navigationCount, 0, 'Swipe navigated to Goals')
            assert.equal(state.showSwipeDueDatePopup.visible, true, 'Popup did not open')
            assert.deepEqual(state.showSwipeDueDatePopup.data, { projectId: 'p1', isProjectPostpone: true })
            await page.getByText(/^Tomorrow/).waitFor({ state: 'visible' })
            // A rendered Redux flag alone is insufficient: the actual picker
            // must be visible and hit-testable above its transparent overlay.
            const picker = await page.getByText(/^Tomorrow/).boundingBox()
            assert.ok(picker && picker.width > 0 && picker.height > 0)
            if (process.env.HARNESS_SCREENSHOTS) {
                const screenshots = path.join(__dirname, 'screenshots')
                fs.mkdirSync(screenshots, { recursive: true })
                await page.screenshot({ path: path.join(screenshots, `${touch ? 'phone' : 'desktop'}.png`) })
            }
            assert.equal(await page.locator('#goals').count(), 0)
            const milestoneDate = state.openMilestonesByProjectInTasks.p1[0].date
            if (touch) await page.getByText(/^Tomorrow/).tap()
            else await page.getByText(/^Tomorrow/).click()
            await page.waitForFunction(() => !window.__state().showSwipeDueDatePopup.visible)
            assert.equal(await page.evaluate(() => window.__writes.length), 1)
            const write = await page.evaluate(() => window.__writes[0])
            assert.equal(write.projectId, 'p1')
            assert.equal(write.mode, 'date')
            assert.equal(
                await page.evaluate(date => {
                    const tomorrow = new Date()
                    tomorrow.setDate(tomorrow.getDate() + 1)
                    return new Date(date).toDateString() === tomorrow.toDateString()
                }, write.date),
                true,
                'Tomorrow did not select tomorrow’s date'
            )
            assert.equal(
                await page.evaluate(() => window.__state().openMilestonesByProjectInTasks.p1[0].date),
                milestoneDate
            )
            await clickRow()
            await page.locator('#goals').waitFor()
            assert.equal(await page.evaluate(() => window.__state().navigationCount), 1)
            console.log(
                `PASS ${touch ? 'touch' : 'mouse'}: swipe/release, visible date picker, project date choice, unchanged milestone and normal click`
            )
            await load()
            await swipe('#project')
            await page.getByText(/^Tomorrow/).waitFor({ state: 'visible' })
            assert.deepEqual(
                await page.evaluate(() => window.__state().showSwipeDueDatePopup.data),
                state.showSwipeDueDatePopup.data
            )
            assert.deepEqual(errors, [])
            console.log(`PASS ${touch ? 'touch' : 'mouse'} project-row control opens the same picker`)
            await load()
            await swipe('#milestone', true)
            await page.getByText(/^Tomorrow/).waitFor({ state: 'visible' })
            // Mobile sheets ignore opening-gesture replays for 750 ms.
            // Dismiss as a deliberate user tap after that existing grace.
            await page.waitForTimeout(850)
            assert.equal(await page.evaluate(() => window.__state().navigationCount), 0)
            assert.equal(
                await page.evaluate(() => window.__events.filter(event => event.type === 'synthesized-click').length),
                1
            )
            if (process.env.HARNESS_DEBUG)
                console.log(
                    'dismiss target:',
                    await page.evaluate(() => ({
                        target: document.elementFromPoint(12, 12)?.outerHTML.slice(0, 500),
                        events: window.__events,
                    }))
                )
            const close = page
                .getByText('Project tasks reminder', { exact: true })
                .locator('..')
                .locator('..')
                .locator('[tabindex="0"]')
            if (touch) await close.tap()
            else await close.click()
            if (process.env.HARNESS_DEBUG) console.log('after dismissal:', await page.evaluate(() => window.__events))
            await page.waitForFunction(() => !window.__state().showSwipeDueDatePopup.visible)
            assert.equal(await page.evaluate(() => window.__writes.length), 0)
            // Reopen and dismiss on the same instance: the guard must not leave
            // this row permanently blocked after its first swipe.
            await swipe('#milestone')
            await page.getByText(/^Tomorrow/).waitFor({ state: 'visible' })
            await page.waitForTimeout(850)
            if (touch) await page.touchscreen.tap(12, 12)
            else await page.mouse.click(12, 12)
            await page.waitForFunction(() => !window.__state().showSwipeDueDatePopup.visible)
            await clickRow()
            await page.locator('#goals').waitFor()
            assert.equal(await page.evaluate(() => window.__state().navigationCount), 1)
            assert.deepEqual(errors, [])
            console.log(
                `PASS ${touch ? 'touch' : 'mouse'}: synthesized click, close button, outside dismissal, repeated swipe and restored navigation`
            )
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
