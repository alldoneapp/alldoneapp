/**
 * AT-3028: clicking the blank line under "Starte einen neuen Chat" starts typing.
 *
 *   node browser-tests/at3028/run.js [--skip-build]
 *
 * Needs `web-bundler/node_modules` and Playwright with Chromium (set PLAYWRIGHT_MODULE to a
 * Playwright module path when it is installed elsewhere). Checks, in real Chromium:
 *   - at rest the editor is exactly the two lines of the field, and its natural height (what
 *     auto-expand measures) is unchanged, so the resting composer does not grow;
 *   - the blank second line IS the contenteditable (control: with the old 24px min-height it is
 *     not, which was the bug);
 *   - a mouse click and a touch tap there focus the editor and typing lands in it;
 *   - a click on the field's padding edge focuses it with the caret after existing text;
 *   - +, Vorlagen, mic, call and send keep their clicks and never focus the editor.
 */
const path = require('path')
const http = require('http')
const fs = require('fs')
const assert = require('assert/strict')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>AT-3028</title>
<style>html,body,#root{margin:0;height:100%;width:100%;font-family:Arial}</style>
</head><body><div id="root"></div><script src="/harness.js"></script></body></html>`

if (!process.argv.includes('--skip-build')) {
    execFileSync(
        path.join(ROOT, 'web-bundler', 'node_modules', '.bin', 'webpack'),
        [
            '--config',
            path.join(ROOT, 'browser-tests', 'webpack.harness.js'),
            '--mode',
            'development',
            '--env',
            `harnessEntry=${path.join(__dirname, 'harness.entry.js')}`,
            '--env',
            `harnessOut=${BUILD_DIR}`,
        ],
        { cwd: path.join(ROOT, 'web-bundler'), stdio: 'inherit' }
    )
}
fs.writeFileSync(path.join(BUILD_DIR, 'index.html'), HTML)

const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')

const serve = () =>
    new Promise(resolve => {
        const server = http.createServer((req, res) => {
            const url = req.url.split('?')[0]
            const file = path.join(BUILD_DIR, url === '/' ? 'index.html' : url)
            if (!file.startsWith(BUILD_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
                res.writeHead(404).end()
                return
            }
            const type = file.endsWith('.html')
                ? 'text/html'
                : file.endsWith('.js')
                  ? 'application/javascript'
                  : 'application/octet-stream'
            res.setHeader('Content-Type', type)
            res.end(fs.readFileSync(file))
        })
        server.listen(0, '127.0.0.1', () => resolve(server))
    })

const box = (page, testId) => page.locator(`[data-testid="${testId}"]`).first().boundingBox()
const editorFocused = page => page.evaluate(() => document.activeElement === window.quill.root)
const editorText = page => page.evaluate(() => window.quill.getText().replace(/\n$/, ''))
const blur = page => page.evaluate(() => document.activeElement && document.activeElement.blur())
const reset = page =>
    page.evaluate(() => {
        window.quill.setText('')
        document.activeElement && document.activeElement.blur()
        window.toolbarPresses = []
    })

// The middle of the field's second text line: frame top + 4px padding + one 24px line + half.
const blankLinePoint = async page => {
    const frame = await box(page, 'input-frame')
    return { x: frame.x + frame.width / 2, y: frame.y + 4 + 24 + 12 }
}

const hitsEditor = (page, { x, y }) =>
    page.evaluate(([px, py]) => window.quill.root.contains(document.elementFromPoint(px, py)), [x, y])

async function main() {
    const server = await serve()
    const url = `http://127.0.0.1:${server.address().port}/`
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    try {
        const page = await browser.newPage({ viewport: { width: 800, height: 400 } })
        page.on('pageerror', error => {
            throw error
        })
        await page.goto(url)
        await page.waitForSelector('[data-testid="ready"]', { state: 'attached' })

        // 1. Resting geometry: the editor fills the two lines, its natural height is unchanged.
        const geometry = await page.evaluate(() => {
            const frame = document.querySelector('[data-testid="input-frame"]').getBoundingClientRect()
            const editor = window.quill.root.getBoundingClientRect()
            return {
                frameHeight: frame.height,
                editorHeight: editor.height,
                scrollHeight: window.quill.root.scrollHeight,
                editorTopOffset: editor.top - frame.top,
            }
        })
        assert.equal(geometry.frameHeight, 56, 'resting field is 56px')
        assert.equal(geometry.editorHeight, 48, 'editor fills both resting lines')
        assert.equal(geometry.scrollHeight, 48, 'auto-expand measures 48 (+8 padding = the 56px minimum)')
        assert.equal(geometry.editorTopOffset, 4, 'editor starts after the 4px padding')

        // 2. The blank line is the editor itself.
        const blank = await blankLinePoint(page)
        assert.ok(await hitsEditor(page, blank), 'the blank second line is the contenteditable')

        // 3. Mouse click on the blank line focuses and typing lands in the editor.
        await reset(page)
        await page.mouse.click(blank.x, blank.y)
        assert.ok(await editorFocused(page), 'click on the blank line focuses the editor')
        await page.keyboard.type('Hallo')
        assert.equal(await editorText(page), 'Hallo')

        // 4. Padding edge: focuses with the caret after the existing text.
        await blur(page)
        const frame = await box(page, 'input-frame')
        await page.mouse.click(frame.x + frame.width / 2, frame.y + 1)
        assert.ok(await editorFocused(page), 'click on the top padding edge focuses the editor')
        await page.keyboard.type('!')
        assert.equal(await editorText(page), 'Hallo!', 'caret is placed after the existing text')

        await blur(page)
        await page.mouse.click(frame.x + 2, frame.y + frame.height / 2)
        assert.ok(await editorFocused(page), 'click on the left padding edge focuses the editor')

        // Already focused + padding click keeps the caret where the user put it.
        await page.evaluate(() => window.quill.setSelection(0, 0))
        await page.mouse.click(frame.x + frame.width / 2, frame.y + frame.height - 1)
        await page.keyboard.type('>')
        assert.equal(await editorText(page), '>Hallo!', 'a focused composer keeps its caret')

        // 5. Toolbar controls keep their clicks and never focus the editor.
        for (const control of ['attach', 'templates', 'mic', 'call', 'send']) {
            await reset(page)
            await page.locator(`[data-testid="${control}"]`).click()
            assert.deepEqual(await page.evaluate(() => window.toolbarPresses), [control], `${control} is pressed`)
            assert.equal(await editorFocused(page), false, `${control} does not focus the editor`)
        }

        // The toolbar background and the composer box padding are not part of the field.
        await reset(page)
        const toolbar = await box(page, 'assistant-composer-toolbar')
        await page.mouse.click(toolbar.x + toolbar.width / 2, toolbar.y + toolbar.height / 2)
        assert.equal(await editorFocused(page), false, 'empty toolbar space does not focus the editor')

        // 6. Touch: a tap on the blank line focuses the editor natively.
        const touchContext = await browser.newContext({ hasTouch: true, viewport: { width: 800, height: 400 } })
        const touchPage = await touchContext.newPage()
        await touchPage.goto(url)
        await touchPage.waitForSelector('[data-testid="ready"]', { state: 'attached' })
        const touchBlank = await blankLinePoint(touchPage)
        await touchPage.touchscreen.tap(touchBlank.x, touchBlank.y)
        assert.ok(await editorFocused(touchPage), 'tap on the blank line focuses the editor')
        await touchContext.close()

        // Control: with the pre-fix 24px min-height the blank line was dead frame.
        await reset(page)
        await page.addStyleTag({
            content: "[data-testid='assistant-composer-row'] .ql-editor { min-height: 24px !important; }",
        })
        assert.equal(await hitsEditor(page, blank), false, 'control: the old CSS leaves the blank line outside')

        console.log('AT-3028 browser test passed')
    } finally {
        await browser.close()
        server.close()
    }
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
