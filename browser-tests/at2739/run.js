const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const fixture = path.join(__dirname, '../anna-workspace')
const baseline = process.argv.includes('--baseline')
const output = path.join(__dirname, '.build', baseline ? 'baseline' : '')

async function geometry(page, name) {
    const toolbar = page.locator('.anna-composer-toolbar')
    const buttons = toolbar.locator('[aria-label="Dictate"], [role="button"], button')
    const boxes = await buttons.evaluateAll(nodes =>
        nodes.map(node => {
            const icon = node.firstElementChild.getBoundingClientRect()
            return {
                label: node.getAttribute('aria-label'),
                ...node.getBoundingClientRect().toJSON(),
                iconCenter: icon.y + icon.height / 2,
            }
        })
    )
    console.log(
        `${name}: ${boxes.map(box => `${box.label} ${box.width}x${box.height} center=${box.y + box.height / 2}, icon=${box.iconCenter}`).join('; ')}`
    )
    if (baseline) return
    assert.equal(boxes.length, name.endsWith('offline') ? 3 : 4, 'available controls remain in the toolbar')
    const field = await page.locator('.anna-composer-field').boundingBox()
    const input = await page.locator('.anna-rich-composer').boundingBox()
    const center = boxes[0].y + boxes[0].height / 2
    assert(input.y + input.height <= boxes[0].y, 'toolbar remains below the input as it expands')
    for (const box of boxes) {
        assert.equal(box.width, 40, `${box.label}: full 40px touch width`)
        assert.equal(box.height, 40, `${box.label}: full 40px touch height`)
        assert(Math.abs(box.y + box.height / 2 - center) <= 1, `${box.label}: target is vertically centered`)
        assert(Math.abs(box.iconCenter - center) <= 1, `${box.label}: icon is vertically centered`)
        assert(box.x >= field.x && box.x + box.width <= field.x + field.width, 'control stays inside composer')
        assert(box.y >= field.y && box.y + box.height <= field.y + field.height, 'toolbar stays below input')
    }
    const plusIndex = boxes.findIndex(box => box.label === 'Select kind of file to add')
    if (plusIndex) assert.equal(boxes[1].x - boxes[0].x - boxes[0].width, 8, 'left controls retain 8px spacing')
    const [plus, phone, send] = boxes.slice(plusIndex)
    assert.equal(send.x - phone.x - phone.width, 8, 'right controls retain 8px spacing')
    assert(plus.x + plus.width + 8 <= phone.x, 'left and right controls do not overlap')
    assert(await page.locator('.anna-conversation').evaluate(node => node.scrollWidth <= node.clientWidth))
}

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
                `harnessEntry=${path.join(fixture, 'harness.entry.js')}`,
                '--env',
                `harnessSetup=${path.join(fixture, 'webpack.setup.js')}`,
                '--env',
                `harnessOut=${output}`,
            ],
            { cwd: root, stdio: 'inherit' }
        )
    }
    const server = http.createServer((req, res) => {
        const file = path.join(output, path.basename(req.url.split('?')[0]))
        if (fs.existsSync(file) && fs.statSync(file).isFile()) {
            res.setHeader('Content-Type', file.endsWith('.ttf') ? 'font/ttf' : 'application/javascript')
            res.end(fs.readFileSync(file))
        } else {
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(
                '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;height:100%;width:100%;overflow:hidden}#root{display:flex}</style></head><body><div id="root"></div><script src="/harness.js"></script></body></html>'
            )
        }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let browser
    try {
        const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
        browser = await chromium.launch({ args: ['--no-sandbox'] })
        const measurements = [
            [1440, 900],
            [1024, 768],
            [390, 844],
            [320, 568],
            [568, 320],
        ]
        for (const [width, height] of measurements) {
            const page = await browser.newPage({ viewport: { width, height }, hasTouch: width <= 760 })
            page.setDefaultTimeout(15000)
            const errors = []
            page.on('pageerror', error => errors.push(error.message))
            await page.route('**/*', route =>
                route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort()
            )
            await page.goto(`http://127.0.0.1:${server.address().port}/?assistant=1`)
            const input = page.getByLabel('Message Carl Code Mentor')
            await input.waitFor()
            await page.evaluate(() => document.fonts.ready)
            const toolbar = page.locator('.anna-composer-toolbar')
            const send = toolbar.getByRole('button', { name: 'Send message', exact: true })
            const attachment = toolbar.getByRole('button', { name: 'Select kind of file to add' })
            const menu = page.getByText('Select kind of file to add', { exact: true })
            await geometry(page, `${width}x${height} empty`)
            const emptyInputHeight = (await page.locator('.anna-rich-composer').boundingBox()).height
            assert(await send.isDisabled(), 'empty draft cannot send')
            if (width === 390 || width === 1440) {
                await page.screenshot({
                    path: path.join(output, `${width}-${baseline ? 'before' : 'after'}-empty.png`),
                })
            }
            await input.fill('Eine kurze Nachricht')
            await geometry(page, `${width}x${height} single line`)
            assert(!(await send.isDisabled()), 'text enables send')
            await input.press('End')
            await input.press('Shift+Enter')
            await input.press('h')
            assert((await input.innerText()).includes('\n'), 'Shift+Enter inserts a new line')
            await input.fill(Array.from({ length: 20 }, (_, i) => `Zeile ${i + 1}: Mehrzeilige Nachricht`).join('\n'))
            await page.waitForFunction(
                emptyHeight =>
                    document.querySelector('.anna-rich-composer').getBoundingClientRect().height > emptyHeight,
                emptyInputHeight
            )
            await geometry(page, `${width}x${height} multiline`)
            if (width === 390 || width === 1440) {
                await page.screenshot({
                    path: path.join(output, `${width}-${baseline ? 'before' : 'after'}-multiline.png`),
                })
            }
            if (!baseline) {
                // This point used to be empty wrapper space, outside the 24px button.
                const box = await attachment.boundingBox()
                if (width <= 760) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height - 3)
                else await attachment.click({ position: { x: box.width / 2, y: box.height - 3 } })
                await menu.waitFor()
                await page.keyboard.press('Escape')
                await menu.waitFor({ state: 'hidden' })
                await attachment.focus()
                await page.keyboard.press('Enter')
                await menu.waitFor()
                await page.keyboard.press('Escape')
                await menu.waitFor({ state: 'hidden' })
                assert((await input.innerText()).includes('Zeile 20'), 'picker preserves multiline draft')
                await page.context().setOffline(true)
                await page.waitForFunction(() => {
                    const node = document.querySelector('.anna-composer-attachment [role="button"]')
                    return node.disabled || node.getAttribute('aria-disabled') === 'true'
                })
                assert(await send.isDisabled(), 'offline send guard is retained')
                await geometry(page, `${width}x${height} offline`)
            }
            assert.deepEqual(errors, [], 'no browser runtime errors')
            await page.close()
        }
        console.log(
            baseline
                ? 'Baseline measurements captured'
                : 'PASS: composer alignment, spacing, hit targets, multiline input, pointer/keyboard picker and offline state'
        )
    } finally {
        if (browser) await browser.close()
        await new Promise(resolve => server.close(resolve))
    }
}
main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
