const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const output = path.join(__dirname, '.build')

async function measure(page) {
    return page.evaluate(() => {
        const editor = document.querySelector('.ql-editor')
        const frame = editor.closest('[id^="ql-scroll-boundary-"]')
        const controls = document.querySelector('[data-testid="assistant-message-controls"]')
        const rect = element => element.getBoundingClientRect().toJSON()
        const buttons = [...frame.querySelectorAll('[aria-label][tabindex], button')].map(rect)
        const placeholder = getComputedStyle(editor, '::before')
        const style = getComputedStyle(editor)
        const field = rect(frame)
        const text = rect(editor)
        const placeholderRight = text.right - parseFloat(style.paddingRight)
        return {
            field,
            text,
            buttons,
            placeholderRight,
            placeholderWhiteSpace: placeholder.whiteSpace,
            paddingRight: style.paddingRight,
            lineHeight: getComputedStyle(editor.firstElementChild).lineHeight,
            controlsDirection: getComputedStyle(controls).flexDirection,
            controls: [...controls.querySelectorAll('[aria-label][tabindex], button')].map(rect),
            overflow: document.documentElement.scrollWidth > window.innerWidth,
            placeholder: editor.getAttribute('data-placeholder'),
            placeholderLineHeight: placeholder.lineHeight,
            placeholderLetterSpacing: placeholder.letterSpacing,
            fontReady: [...document.fonts].every(font => font.status === 'loaded'),
            hasVisibleGlyphs: (() => {
                const canvas = document.createElement('canvas')
                const context = canvas.getContext('2d')
                context.font = '16px Roboto-Regular'
                return context.measureText('Neue Nachricht …').width > 100
            })(),
        }
    })
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
                `harnessEntry=${path.join(__dirname, 'harness.entry.js')}`,
                '--env',
                `harnessSetup=${path.join(__dirname, 'setup.js')}`,
                '--env',
                `harnessOut=${output}`,
            ],
            { cwd: root, stdio: 'inherit' }
        )
    }
    const server = http.createServer((req, res) => {
        const file = path.join(output, req.url.split('?')[0].replace(/^\/+/, ''))
        if (fs.existsSync(file) && fs.statSync(file).isFile()) {
            res.setHeader('Content-Type', file.endsWith('.ttf') ? 'font/ttf' : 'application/javascript; charset=utf-8')
            res.end(fs.readFileSync(file))
        } else {
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(
                '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/harness.js"></script></body></html>'
            )
        }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let browser
    try {
        const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
        browser = await chromium.launch({ args: ['--no-sandbox'] })
        for (const board of [false, true]) {
            for (const [width, height] of [
                [320, 568],
                [360, 640],
                [375, 667],
                [390, 520],
                [430, 600],
                [1440, 900],
            ]) {
                const name = `${board ? 'board' : 'card'}-${width}`
                const page = await browser.newPage({ viewport: { width, height } })
                const errors = []
                page.on('pageerror', error => {
                    errors.push(error.stack || error.message)
                    console.error(error.stack || error.message)
                })
                await page.goto(`http://127.0.0.1:${server.address().port}/?${board ? 'board' : ''}`)
                try {
                    await page.locator('.ql-editor').waitFor({ state: 'attached' })
                } catch (error) {
                    console.error(errors)
                    throw error
                }
                await page.evaluate(() => document.fonts.ready)
                await page.waitForTimeout(300)
                const empty = await measure(page)
                console.log(`${name} empty: ${JSON.stringify(empty)}`)
                await page.screenshot({ path: path.join(output, `after-${name}.png`) })
                {
                    assert(!empty.overflow, `${name}: no horizontal overflow`)
                    assert(empty.fontReady && empty.hasVisibleGlyphs, `${name}: fonts actually render`)
                    assert.equal(empty.lineHeight, '24px')
                    assert.equal(empty.placeholderLineHeight, empty.lineHeight)
                    assert.equal(empty.placeholderLetterSpacing, 'normal')
                    assert.equal(empty.placeholder, width < 640 ? 'Neue Nachricht …' : 'Starte einen neuen Chat')
                    assert.equal(empty.controls.length, 2, `${name}: voice/send both present`)
                    assert(empty.controls.every(button => button.width >= 40 && button.height === 40))
                    assert.equal(empty.controlsDirection, 'row')
                    assert.equal(empty.controls[0].y, empty.controls[1].y)
                    assert(empty.text.bottom <= empty.field.bottom - 2, `${name}: placeholder is not clipped`)
                    assert(empty.controls[0].x > empty.field.right, `${name}: actions stay beside the field`)
                    assert(
                        empty.placeholderRight <= Math.min(...empty.buttons.map(button => button.x)) - 3,
                        `${name}: placeholder clears inline controls`
                    )
                }
                const editor = page.locator('.ql-editor')
                await editor.fill(
                    'Bitte plane meine nächste Woche und fasse die wichtigsten offenen Aufgaben in allen Projekten zusammen. '.repeat(
                        8
                    )
                )
                await page.waitForTimeout(350)
                const long = await measure(page)
                console.log(`${name} long: ${long.field.height}px field, ${long.text.height}px content`)
                await page.screenshot({ path: path.join(output, `long-${name}.png`) })
                {
                    assert(!long.overflow, `${name}: long text does not widen page`)
                    assert.equal(long.controlsDirection, width < 640 ? 'row' : 'column')
                    assert(long.controls[0].x > long.field.right, `${name}: actions remain beside the field`)
                    if (width < 640) assert.equal(long.controls[0].y, long.controls[1].y)
                    assert(long.text.height > long.field.height, `${name}: long text really wraps and scrolls`)
                    assert.equal(long.lineHeight, '24px')
                    assert(long.field.height <= 120, `${name}: text height remains capped`)
                }
                await editor.fill('Erste Zeile\nZweite Zeile')
                await page.waitForTimeout(200)
                const multiline = await measure(page)
                assert(multiline.field.height >= 56, `${name}: two lines fit with padding`)
                assert.equal(multiline.lineHeight, '24px')
                await page.screenshot({ path: path.join(output, `multiline-${name}.png`) })
                if (width === 390) {
                    const textBeforeResize = await editor.innerText()
                    await page.setViewportSize({ width: 1440, height: 900 })
                    await page.waitForTimeout(200)
                    assert.equal((await measure(page)).placeholder, 'Starte einen neuen Chat')
                    await page.setViewportSize({ width, height })
                    await page.waitForTimeout(200)
                    assert.equal((await measure(page)).controlsDirection, 'row')
                    assert.equal(await editor.innerText(), textBeforeResize)
                }
                await editor.fill('Hallo Anna')
                await page.waitForTimeout(200)
                await page.locator('[aria-label="Senden"]').click()
                await page.waitForTimeout(200)
                {
                    assert.equal(await editor.innerText(), '\n', `${name}: send clears editor`)
                    assert.deepEqual(await page.evaluate(() => window.__sent), ['Hallo Anna'])
                    assert.deepEqual(errors, [], `${name}: no runtime errors`)
                    assert.equal((await measure(page)).controlsDirection, 'row')
                }
                console.log(`${name}: PASS`)
                await page.close()
            }
        }
    } finally {
        await browser?.close()
        await new Promise(resolve => server.close(resolve))
    }
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
