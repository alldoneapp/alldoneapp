const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const { PNG } = require(process.env.PNGJS_MODULE || 'pngjs')
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

fs.writeFileSync(
    path.join(output, 'index.html'),
    `<!doctype html><html><head><meta charset="utf-8">
<style>
@font-face {font-family:Roboto-Regular;src:url('/font.ttf')}
@font-face {font-family:Roboto-Medium;src:url('/medium.ttf')}
@font-face {font-family:alldone;src:url('/icons.ttf')}
body {margin:16px;background:white}
.ql-editor {min-height:300px;caret-color:rgb(255,0,0)}
</style></head><body><div id="root"></div><script src="/harness.js"></script></body></html>`
)

// Look for the browser's PAINTED native caret, not just a non-null Quill range.
// Red is used only in the fixture so pixels cannot be confused with the blue tag.
async function assertCaret(page, index, name, move = true, screenshotPath) {
    if (move) await page.evaluate(index => window.editor.setSelection(index, 0), index)
    await page.waitForTimeout(30)
    const state = await page.evaluate(() => window.caret())
    assert.deepEqual(state.selection, { index, length: 0 }, name)
    assert(state.focus, `${name}: no editor focus`)
    assert(state.editable, `${name}: native selection is not editable`)
    assert(!state.native.insideTaskContent, `${name}: native selection inside noneditable task content`)
    assert(state.bounds.height > 0, `${name}: no caret geometry`)
    if (process.argv.includes('--geometry-only')) return
    for (let sample = 0; sample < 8; sample++) {
        const bytes = await page.screenshot({
            caret: 'initial',
            clip: { x: 0, y: 0, width: page.viewportSize().width, height: 120 },
        })
        const png = PNG.sync.read(bytes)
        let pixels = 0
        const { left, top, height } = state.bounds
        for (let y = Math.max(0, Math.floor(top - 6)); y < Math.min(png.height, top + height + 6); y++) {
            for (let x = Math.max(0, Math.floor(left - 6)); x < Math.min(png.width, left + 6); x++) {
                const i = (y * png.width + x) * 4
                // Scaled/subpixel carets blend with white. Require red hue,
                // allowing that antialiasing without matching the tan avatar.
                if (
                    png.data[i] > 245 &&
                    png.data[i + 1] < 215 &&
                    png.data[i + 2] < 215 &&
                    Math.abs(png.data[i + 1] - png.data[i + 2]) < 5
                )
                    pixels++
            }
        }
        if (pixels >= 10) {
            if (screenshotPath) fs.writeFileSync(screenshotPath, bytes)
            return
        }
        await page.waitForTimeout(100)
    }
    await page.screenshot({ path: path.join(output, 'failure.png'), caret: 'initial' })
    throw new Error(`${name}: native caret not painted (${JSON.stringify(state)})`)
}

async function settleTaskGeometry(page) {
    // react-native-web reports accessory widths through ResizeObserver, then
    // React applies title truncation. Check the final layout, not that first
    // transient frame. A retained placeholder still fails after this deadline.
    await page
        .waitForFunction(
            () => {
                if (window.editor.root.querySelector('[data-deferred-embed]')) return false
                const geometry = window.taskGeometry()
                return geometry.tag.right + 1 >= geometry.paintedRight
            },
            null,
            { timeout: 1500 }
        )
        .catch(error => {
            if (error.name !== 'TimeoutError') throw error
        })
    return page.evaluate(() => window.taskGeometry())
}

async function main() {
    const server = http.createServer((request, response) => {
        const file =
            request.url === '/harness.js'
                ? path.join(output, 'harness.js')
                : request.url === '/font.ttf'
                  ? path.join(root, 'assets/fonts/Roboto-Regular.ttf')
                  : request.url === '/medium.ttf'
                    ? path.join(root, 'assets/fonts/Roboto-Medium.ttf')
                    : request.url === '/icons.ttf'
                      ? path.join(root, 'assets/fonts/alldone.ttf')
                      : path.join(output, 'index.html')
        response.setHeader(
            'Content-Type',
            file.endsWith('.js') ? 'application/javascript' : file.endsWith('.ttf') ? 'font/ttf' : 'text/html'
        )
        response.end(fs.readFileSync(file))
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
        for (const engine of (process.env.BROWSERS || 'chromium').split(',')) {
            const browser = await playwright[engine].launch({ args: engine === 'chromium' ? ['--no-sandbox'] : [] })
            try {
                for (const viewport of [
                    { width: 1280, height: 720 },
                    { width: 390, height: 664 },
                ]) {
                    const page = await browser.newPage({ viewport })
                    const errors = []
                    page.on('pageerror', error => errors.push(error.message))
                    if (process.env.HARNESS_DEBUG) page.on('console', message => console.log(message.text()))
                    await page.route('**/*', route =>
                        new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()
                    )
                    await page.goto(`http://127.0.0.1:${server.address().port}`)
                    await page
                        .waitForFunction(() => window.__ready, null, { timeout: 10000 })
                        .catch(error => {
                            throw new Error(`${error.message}\nPage errors: ${errors.join('\n')}`)
                        })
                    await page.evaluate(() => document.fonts.ready)
                    assert(
                        await page.evaluate(() => [...document.fonts].every(font => font.status === 'loaded')),
                        'Fixture fonts must load'
                    )
                    const prefix = `${engine} ${viewport.width}px`
                    // The production note enables deferral BEFORE creating the blots.
                    // Also retain eager coverage so the two paths cannot diverge again.
                    for (const deferred of [false, true]) {
                        for (const [shape, positions] of [
                            ['reported', [3, 4, 5]],
                            ['text', [2, 3]],
                            ['alone', [0, 1]],
                            ['adjacent', [0, 1, 2]],
                            ['lines', [3, 4]],
                        ]) {
                            const original = await page.evaluate(
                                ({ shape, deferred }) => window.fixture(shape, deferred),
                                { shape, deferred }
                            )
                            const geometry = await settleTaskGeometry(page)
                            if (geometry.tag.right + 1 < geometry.paintedRight) {
                                await page.evaluate(index => window.editor.setSelection(index, 0), positions[1])
                                await page.screenshot({
                                    path: path.join(output, 'failure-overflow.png'),
                                    caret: 'initial',
                                    clip: { x: 0, y: 0, width: viewport.width, height: 120 },
                                })
                            }
                            assert(
                                geometry.tag.right + 1 >= geometry.paintedRight,
                                `${prefix} ${shape} deferred=${deferred}: row overflows Quill tag ${JSON.stringify(geometry)}`
                            )
                            if (geometry.next && Math.abs(geometry.next.top - geometry.tag.top) < 2) {
                                assert(
                                    geometry.next.left + 1 >= geometry.paintedRight,
                                    `${prefix} ${shape}: following text overlaps rendered date/avatar`
                                )
                            }
                            for (const index of positions) {
                                await assertCaret(
                                    page,
                                    index,
                                    `${prefix} ${shape} deferred=${deferred} at ${index}`,
                                    true,
                                    shape === 'alone' || shape === 'reported'
                                        ? path.join(output, `${engine}-${viewport.width}-${shape}-${index}.png`)
                                        : null
                                )
                            }
                            for (const index of positions) {
                                await page.evaluate(index => window.editor.setSelection(index, 0), index)
                                const { bounds } = await page.evaluate(() => window.caret())
                                await page.mouse.click(
                                    bounds.left +
                                        (index === positions[positions.length - 1]
                                            ? 2
                                            : index === positions[0]
                                              ? 0.5
                                              : 1),
                                    bounds.top + bounds.height / 2
                                )
                                await assertCaret(page, index, `${prefix} click ${shape} at ${index}`, false)
                            }
                            assert.deepEqual(await page.evaluate(() => window.editor.getContents()), original)
                            console.log(
                                `PASS ${prefix}: ${process.argv.includes('--geometry-only') ? 'caret geometry' : 'painted caret'} ${shape} deferred=${deferred} ${positions.join(', ')}, unchanged content`
                            )
                        }
                    }
                    if (process.argv.includes('--visibility-only')) {
                        await page.close()
                        continue
                    }
                    const reported = await page.evaluate(() => window.fixture('reported'))
                    await page.waitForFunction(() => !window.editor.root.querySelector('[data-deferred-embed]'))
                    assert(
                        await page
                            .locator('.ql-taskTagFormat img')
                            .evaluate(img => img.complete && img.naturalWidth > 0),
                        'The avatar image must load, not just reserve an empty box'
                    )
                    if (viewport.width > 600) await page.getByText('06.10.2026', { exact: true }).waitFor()
                    const next = await page.evaluate(() => window.taskGeometry().next)
                    await page.mouse.click(next.left + 2, next.top + next.height / 2)
                    await assertCaret(page, 4, `${prefix} click first following character`, false)
                    // At the boundary Chromium may use Quill's editable right
                    // guard; one arrow into the text must use its actual node.
                    await page.keyboard.press('ArrowRight')
                    await assertCaret(page, 5, `${prefix} native following text`, false)
                    assert.equal((await page.evaluate(() => window.caret())).native.text, 'adada')
                    await page.keyboard.press('ArrowLeft')
                    await page.keyboard.type('X')
                    assert.equal(await page.evaluate(() => window.editor.getContents().ops[2].insert), 'Xadada')
                    await page.keyboard.press('Backspace')
                    assert.deepEqual(await page.evaluate(() => window.editor.getContents()), reported)
                    await page.evaluate(() => window.editor.history.clear())
                    await page.keyboard.press('Delete')
                    assert.equal(await page.evaluate(() => window.editor.getContents().ops[2].insert), 'dada')
                    assert.equal(await page.locator('.ql-taskTagFormat').count(), 1)
                    await page.keyboard.press('Control+z')
                    assert.deepEqual(await page.evaluate(() => window.editor.getContents()), reported)
                    // Native undo may park before or after the restored character.
                    const undoIndex = await page.evaluate(() => window.editor.getSelection().index)
                    assert([4, 5].includes(undoIndex), 'Undo must keep the caret beside the restored text')
                    await assertCaret(page, undoIndex, `${prefix} undo following text`, false)

                    // Real mouse selection of only the following text must not
                    // hit the overlapping task or open its popup.
                    const end = await page.evaluate(() => {
                        const text = window.editor.root.querySelector('.ql-taskTagFormat').nextSibling
                        const range = document.createRange()
                        range.setStart(text, 4)
                        range.setEnd(text, 5)
                        const rect = range.getBoundingClientRect()
                        return { right: rect.right, top: rect.top, height: rect.height }
                    })
                    await page.mouse.move(next.left + 2, next.top + next.height / 2)
                    await page.mouse.down()
                    await page.mouse.move(end.right - 0.5, end.top + end.height / 2, { steps: 12 })
                    await page.mouse.up()
                    assert.deepEqual(await page.evaluate(() => window.editor.getSelection()), { index: 4, length: 5 })
                    assert.equal(await page.evaluate(() => document.getSelection().toString()), 'adada')
                    assert.equal(await page.getByRole('button', { name: 'Close task fixture' }).count(), 0)
                    assert.deepEqual(await page.evaluate(() => window.editor.getContents()), reported)
                    await page.keyboard.press('ArrowLeft')
                    await assertCaret(page, 4, `${prefix} collapse following selection`, false)
                    await page.evaluate(() => window.editor.setSelection(0, 3))
                    await page.keyboard.press('ArrowRight')
                    await assertCaret(page, 3, `${prefix} collapse preceding selection`, false)
                    // Selection spanning prose and the chip must remain atomic
                    // in the saved Delta, like the user's highlighted screenshot.
                    await page.evaluate(() => window.editor.setSelection(2, 0))
                    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight')
                    assert.deepEqual(await page.evaluate(() => window.editor.getSelection()), { index: 2, length: 4 })
                    assert.deepEqual(await page.evaluate(() => window.editor.getContents()), reported)
                    await page.evaluate(() => window.editor.setSelection(4, 0))
                    for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight')
                    assert.deepEqual(await page.evaluate(() => window.editor.getSelection()), { index: 4, length: 5 })
                    assert.equal(await page.evaluate(() => document.getSelection().toString()), 'adada')
                    await page.keyboard.type('Y')
                    assert.equal(await page.evaluate(() => window.editor.getContents().ops[2].insert), 'Y')
                    await page.keyboard.press('Control+z')
                    assert.deepEqual(await page.evaluate(() => window.editor.getContents()), reported)
                    await page.evaluate(() => window.editor.setSelection(3, 0))
                    for (const index of [4, 5]) {
                        await page.keyboard.press('ArrowRight')
                        await assertCaret(page, index, `${prefix} reported right ${index}`, false)
                    }
                    for (const index of [4, 3]) {
                        await page.keyboard.press('ArrowLeft')
                        await assertCaret(page, index, `${prefix} reported left ${index}`, false)
                    }
                    await page.evaluate(() => {
                        window.editor.history.clear()
                        window.editor.setSelection(4, 0)
                    })
                    await page.keyboard.press('Backspace')
                    assert.equal(await page.locator('.ql-taskTagFormat').count(), 0)
                    assert.equal(await page.evaluate(() => window.editor.getText()), 'dasadada\n')
                    await page.keyboard.press('Control+z')
                    assert.deepEqual(await page.evaluate(() => window.editor.getContents()), reported)
                    await page.waitForFunction(() => !window.editor.root.querySelector('[data-deferred-embed]'))
                    await assertCaret(page, 4, `${prefix} undo task at reported boundary`, false)

                    // Native and Quill rectangles are viewport coordinates;
                    // exercise a translated/scaled ancestor rather than adding
                    // offsets to the caret calculation in application code.
                    await page.evaluate(() => {
                        const root = document.getElementById('root')
                        root.style.transformOrigin = '0 0'
                        root.style.transform = 'translate(23px, 6px) scale(0.85)'
                        window.fixture('reported')
                    })
                    await page.waitForFunction(() => !window.editor.root.querySelector('[data-deferred-embed]'))
                    await assertCaret(page, 4, `${prefix} transformed boundary`)
                    const transformed = await page.evaluate(() => window.taskGeometry())
                    await page.mouse.click(
                        transformed.next.left + 2,
                        transformed.next.top + transformed.next.height / 2
                    )
                    await assertCaret(page, 4, `${prefix} transformed click`, false)
                    await page.evaluate(() => document.getElementById('root').removeAttribute('style'))
                    console.log(
                        `PASS ${prefix}: reported click/drag/Shift selection, typing, text/task delete and keyboard undo, transformed ancestor`
                    )

                    const original = await page.evaluate(() => window.fixture('text'))
                    await page.evaluate(() => window.editor.setSelection(1, 0))
                    for (const index of [2, 3, 4]) {
                        await page.keyboard.press('ArrowRight')
                        assert.deepEqual(await page.evaluate(() => window.editor.getSelection()), { index, length: 0 })
                        await assertCaret(page, index, `${prefix} ArrowRight ${index}`, false)
                    }
                    for (const index of [3, 2, 1]) {
                        await page.keyboard.press('ArrowLeft')
                        assert.deepEqual(await page.evaluate(() => window.editor.getSelection()), { index, length: 0 })
                        await assertCaret(page, index, `${prefix} ArrowLeft ${index}`, false)
                    }
                    await page.evaluate(() => window.editor.setSelection(2, 0))
                    await page.keyboard.press('Shift+ArrowRight')
                    assert.deepEqual(await page.evaluate(() => window.editor.getSelection()), { index: 2, length: 1 })
                    await page.evaluate(() => window.fixture('adjacent'))
                    for (const index of [1, 2]) {
                        await page.keyboard.press('ArrowRight')
                        await assertCaret(page, index, `${prefix} adjacent ArrowRight ${index}`, false)
                    }
                    for (const index of [1, 0]) {
                        await page.keyboard.press('ArrowLeft')
                        await assertCaret(page, index, `${prefix} adjacent ArrowLeft ${index}`, false)
                    }
                    await page.evaluate(() => window.editor.setSelection(1, 0))
                    await page.keyboard.type('X')
                    assert.equal(await page.evaluate(() => window.editor.getContents().ops[1].insert), 'X')
                    assert.equal(await page.locator('.ql-taskTagFormat').count(), 2)
                    for (const index of [2, 3]) {
                        await page.evaluate(() => window.fixture('text'))
                        await page.evaluate(index => window.editor.setSelection(index, 0), index)
                        await page.keyboard.type('X')
                        assert.equal(await page.evaluate(() => window.editor.getText()), 'ABXCD\n')
                        const edited = await page.evaluate(() => window.editor.getContents().ops)
                        assert.equal(edited[0].insert, index === 2 ? 'ABX' : 'AB')
                        assert.equal(edited[2].insert, index === 2 ? 'CD\n' : 'XCD\n')
                        assert.equal(await page.locator('.ql-taskTagFormat').count(), 1)
                        await page.keyboard.press('Backspace')
                        assert.deepEqual(await page.evaluate(() => window.editor.getContents()), original)
                    }
                    for (const [index, key] of [
                        [2, 'Delete'],
                        [3, 'Backspace'],
                    ]) {
                        await page.evaluate(() => window.fixture('text'))
                        await page.evaluate(index => window.editor.setSelection(index, 0), index)
                        await page.keyboard.press(key)
                        assert.equal(await page.locator('.ql-taskTagFormat').count(), 0)
                        assert.equal(await page.evaluate(() => window.editor.getText()), 'ABCD\n')
                        await page.evaluate(() => window.editor.history.undo())
                        assert.deepEqual(await page.evaluate(() => window.editor.getContents()), original)
                    }
                    for (const index of [2, 3]) {
                        await page.evaluate(() => window.fixture('text'))
                        await page.evaluate(index => window.editor.setSelection(index, 0), index)
                        await page.keyboard.press('Enter')
                        assert.equal(await page.evaluate(() => window.editor.getText()), 'AB\nCD\n')
                        assert.equal(await page.locator('.ql-taskTagFormat').count(), 1)
                        await page.evaluate(() => window.editor.history.undo())
                        assert.deepEqual(await page.evaluate(() => window.editor.getContents()), original)
                    }
                    await page.evaluate(() => window.fixture('alone'))
                    await page.waitForFunction(() => !window.editor.root.querySelector('[data-deferred-embed]'))
                    await page.locator('.ql-taskTagFormat [tabindex="0"]').nth(1).click()
                    await page.getByRole('button', { name: 'Close date fixture' }).click()
                    await assertCaret(page, 1, `${prefix} after date popup`)
                    await page
                        .locator('.ql-taskTagFormat')
                        .getByText('Get Karla an estimate an usage uptake for 2027 and then discuss next steps', {
                            exact: true,
                        })
                        .click()
                    await page.getByRole('button', { name: 'Close task fixture' }).click()
                    await assertCaret(page, 0, `${prefix} after popup before`)
                    await assertCaret(page, 1, `${prefix} after popup after`)
                    // An offscreen row retains its lightweight placeholder until find activates it.
                    await page.evaluate(() => {
                        window.editor.container.style.marginTop = '1800px'
                        window.fixture('alone', true)
                    })
                    await page.keyboard.press('Control+f')
                    await page.evaluate(() => {
                        window.editor.container.style.marginTop = ''
                        window.scrollTo(0, 0)
                    })
                    await assertCaret(page, 0, `${prefix} deferred before`)
                    await assertCaret(page, 1, `${prefix} deferred after`)
                    await page.screenshot({
                        path: path.join(output, `${engine}-${viewport.width}.png`),
                        caret: 'initial',
                    })
                    const protectedContent = await page.evaluate(() => {
                        const original = window.editor.getContents()
                        window.editor.enable(false)
                        return {
                            original,
                            guardsEditable: window.editor.root.querySelector('.ql-taskTagFormat').isContentEditable,
                            taskEditable:
                                window.editor.root.querySelector('.ql-taskTagFormat > span').isContentEditable,
                        }
                    })
                    assert.equal(protectedContent.guardsEditable, false)
                    assert.equal(protectedContent.taskEditable, false)
                    await page.keyboard.type('X')
                    assert.deepEqual(await page.evaluate(() => window.editor.getContents()), protectedContent.original)
                    assert.deepEqual(errors, [], errors.join('\n'))
                    console.log(
                        `PASS ${prefix}: navigation, selection, editing, atomic delete/undo, popup, deferred tag`
                    )
                    await page.close()
                }
            } finally {
                await browser.close()
            }
        }
    } finally {
        server.close()
    }
}
main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
