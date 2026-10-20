const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const output = process.env.HARNESS_OUTPUT || path.join(__dirname, '.build')
const baseline = process.argv.includes('--baseline')

async function main() {
    if (!process.argv.includes('--skip-build'))
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
        if (/^\/fonts\/[\w-]+\.ttf$/.test(pathname)) {
            res.setHeader('Content-Type', 'font/ttf')
            res.end(fs.readFileSync(path.join(root, 'assets', pathname)))
        } else if (pathname.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript')
            res.end(fs.readFileSync(path.join(output, path.basename(pathname))))
        } else {
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(
                `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${['Roboto-Regular', 'Roboto-Medium', 'Roboto-Bold', 'alldone'].map(f => `@font-face{font-family:'${f}';src:url('/fonts/${f}.ttf')}`).join('')}body{margin:0}</style><div id="root"></div><script defer src="/harness.js"></script>`
            )
        }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let browser
    try {
        const { createRequire } = require('node:module')
        const browserRequire = createRequire(path.join(process.env.PLAYWRIGHT_HOME || root, 'package.json'))
        let launch = { args: ['--no-sandbox'] }
        if (process.env.CHROMIUM_EXECUTABLE_PATH) launch.executablePath = process.env.CHROMIUM_EXECUTABLE_PATH
        else {
            try {
                const chromium = browserRequire('@sparticuz/chromium').default
                launch = { executablePath: await chromium.executablePath(), args: chromium.args }
            } catch {
                /* Use Playwright's installed Chromium. */
            }
        }
        browser = await browserRequire('playwright').chromium.launch(launch)
        const address = `http://127.0.0.1:${server.address().port}/`
        const results = []
        const context = await browser.newContext({
            viewport: { width: 384, height: 320 },
            hasTouch: true,
            locale: 'de-DE',
        })
        const page = await context.newPage()
        const errors = []
        page.on('requestfailed', r => console.log('Failed request', r.url(), r.failure()))
        page.on('pageerror', e => {
            errors.push(e.message)
            console.error('Browser:', e.message)
        })
        await page.route('**/*', r => (r.request().url().startsWith(address) ? r.continue() : r.abort()))
        for (const width of [320, 360, 384, 390, 430, 600, 768, 1024, 1280, 1440]) {
            for (const query of ['', 'free', 'large&points', 'classic', 'anonymous']) {
                if (baseline && width < 1024 && width !== 384) continue
                if (process.argv.includes('--desktop-only') && width < 1024) continue
                await page.setViewportSize({ width, height: 320 })
                await page.goto(address + '?' + query)
                page.setDefaultTimeout(10000)
                const mobile = page.getByTestId('top-bar-mobile')
                const desktop = page.getByTestId('top-bar-desktop')
                await mobile.or(desktop).waitFor()
                await page.evaluate(async () => {
                    await Promise.all(
                        ['Roboto-Regular', 'Roboto-Medium', 'Roboto-Bold', 'alldone'].map(f =>
                            document.fonts.load(`16px ${f}`)
                        )
                    )
                    await document.fonts.ready
                })
                const isMobile = (await mobile.count()) > 0
                const secondary = mobile.locator('..').locator(':scope > div').nth(1)
                if (isMobile && query !== 'anonymous') {
                    assert.equal((await secondary.boundingBox()).height, 0)
                    // Last button in the real mobile header is the three-dot control.
                    const more = mobile.locator(':scope > div').nth(1).locator('[tabindex="0"]').last()
                    await more.click()
                    if (baseline) await page.waitForTimeout(250)
                    else
                        await page.waitForFunction(
                            () =>
                                document
                                    .querySelector('[data-testid="top-bar-mobile-statistics"]')
                                    .getBoundingClientRect().height >= 36
                        )
                    const buttons = secondary.locator('[tabindex="0"]')
                    const count = width <= 480 ? 4 : 3
                    assert.equal(await buttons.count(), count)
                    const boxes = await buttons.evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().toJSON()))
                    const height = (await secondary.boundingBox()).height
                    if (!baseline) {
                        assert.equal(height, 36, 'one expanded row')
                        assert.equal(new Set(boxes.map(b => Math.round(b.y))).size, 1, 'all four controls share a row')
                        for (let i = 1; i < boxes.length; i++)
                            assert(boxes[i].x >= boxes[i - 1].right - 1, 'no overlap')
                        const next = await page.getByTestId('following-content').boundingBox()
                        assert(
                            boxes.every(b => b.bottom <= next.y),
                            'no overlap with following content'
                        )
                        if (width >= 360 && (query === '' || query === 'classic')) {
                            assert(
                                boxes[0].x >= 0 && boxes[boxes.length - 1].right <= width,
                                'normal counters fit without scrolling'
                            )
                        }
                        for (let i = 0; i < count; i++) {
                            await buttons.nth(i).scrollIntoViewIfNeeded()
                            await buttons.nth(i).click()
                        }
                        const navigation = await page.evaluate(() => window.__navigation)
                        assert.equal(navigation.length, count, 'all existing navigation actions fire')
                        assert(navigation.every(n => n[0] === 'SettingsView'))
                    }
                    await page.screenshot({ path: path.join(output, `${width}-${query || 'premium'}-expanded.png`) })
                    if (!baseline) {
                        await more.click()
                        await page.waitForFunction(
                            () =>
                                document
                                    .querySelector('[data-testid="top-bar-mobile-statistics"]')
                                    .getBoundingClientRect().height === 0
                        )
                    }
                    results.push({ width, query, height })
                } else {
                    if (isMobile)
                        assert.equal(await secondary.count(), 0, 'anonymous viewers have no secondary statistics')
                    const name = `${width}-${query || 'premium'}-header.png`
                    const png = await page.screenshot({ path: path.join(output, name) })
                    if (!isMobile && process.env.DESKTOP_BASELINE) {
                        const original = fs.readFileSync(path.join(process.env.DESKTOP_BASELINE, name))
                        if (!png.equals(original)) {
                            const difference = await page.evaluate(
                                async images => {
                                    const pixels = await Promise.all(
                                        images.map(async data => {
                                            const image = new Image()
                                            image.src = data
                                            await image.decode()
                                            const canvas = document.createElement('canvas')
                                            canvas.width = image.width
                                            canvas.height = image.height
                                            const context = canvas.getContext('2d')
                                            context.drawImage(image, 0, 0)
                                            return context.getImageData(0, 0, image.width, image.height).data
                                        })
                                    )
                                    let count = 0,
                                        maximum = 0
                                    for (let i = 0; i < pixels[0].length; i += 4) {
                                        let changed = false
                                        for (let c = 0; c < 4; c++) {
                                            const delta = Math.abs(pixels[0][i + c] - pixels[1][i + c])
                                            maximum = Math.max(maximum, delta)
                                            changed ||= delta > 0
                                        }
                                        if (changed) count++
                                    }
                                    return { count, maximum }
                                },
                                [png, original].map(bytes => `data:image/png;base64,${bytes.toString('base64')}`)
                            )
                            // Chromium occasionally rounds two shadow-edge pixels by one color step.
                            assert(
                                difference.count <= 2 && difference.maximum <= 1,
                                `desktop changed: ${JSON.stringify(difference)}`
                            )
                        }
                    }
                    results.push({ width, query, desktop: !isMobile })
                }
                assert(
                    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                    'no page overflow'
                )
                assert.deepEqual(errors, [], 'no runtime errors')
                console.log(`PASS ${width} ${query || 'premium'}`)
            }
        }
        if (!baseline) {
            await page.setViewportSize({ width: 384, height: 320 })
            await page.goto(address)
            const mobile = page.getByTestId('top-bar-mobile')
            await mobile.waitFor()
            await mobile.locator(':scope > div').nth(1).locator('[tabindex="0"]').last().click()
            for (const width of [600, 320, 430]) {
                await page.setViewportSize({ width, height: 320 })
                await page.waitForTimeout(250)
                assert.equal(
                    (await page.getByTestId('top-bar-mobile-statistics').boundingBox()).height,
                    36,
                    'expanded height stable during resize'
                )
            }
            await page.setViewportSize({ width: 1280, height: 320 })
            await page.getByTestId('top-bar-desktop').waitFor()
            await page.setViewportSize({ width: 384, height: 320 })
            await mobile.waitFor()
            assert.equal((await page.getByTestId('top-bar-mobile-statistics').boundingBox()).height, 0)
            assert.deepEqual(errors, [])
        }
        fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
        console.log(`PASS: ${results.length} browser cases${baseline ? ' (baseline)' : ''}`)
    } finally {
        await browser?.close()
        await new Promise(resolve => server.close(resolve))
    }
}
main().catch(e => {
    console.error(e)
    process.exitCode = 1
})
