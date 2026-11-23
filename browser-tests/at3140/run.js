/**
 * AT-3140 browser-level test — deleting the text line under an image keeps the image.
 *
 * Drop an image into the chat composer, type on the line below it, select that text back to the
 * start of its line with Shift+Home and delete it: the image must stay. The image renders as a
 * full-width block, so it is visually a line of its own, but it is an INLINE embed in the same
 * Quill line as the text after it. While its span stayed inline, Chromium put that line's start
 * BEFORE the embed, so the selection Shift+Home made also covered the image and Backspace removed
 * it. Deliberately selecting the image (extending past the line start, Shift+Up) must still delete
 * it. Line-boundary caret movement is layout-driven, which jsdom does not have, so this lives here
 * and not in Jest (the Jest half is textLineDeleteKeepsMedia.test.js).
 *
 * Everything on the path is real: CustomTextInput3 with ChatInput's formats, quill2Setup's
 * GatedUploader, the drop → appManagedFileUpload → insertFilesAsAttachments insertion, the REAL
 * customImageFormat / videoFormat blots and the app's styles.css.
 *
 * Requirements (not part of CI's Jest jobs):
 *   nvm use 22
 *   (cd web-bundler && npm install)
 *   npx playwright install chromium
 * Usage:
 *   node browser-tests/at3140/run.js [--skip-build] [--unfixed]
 *
 * `--unfixed` neutralises the AT-3140 CSS rule in the page and expects the defect to reproduce,
 * which proves the cases below can fail.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const output = path.join(__dirname, '.build')
const UNFIXED = process.argv.includes('--unfixed')

// Restores the pre-AT-3140 rendering of the embed span (inline, inheriting the line height).
const UNFIXED_CSS = `.ql-textInputContainer > .ql-editor .ql-customImageFormat,
.ql-textInputContainer > .ql-editor .ql-videoFormat { display: inline !important; line-height: inherit !important; }`

const TEXT = 'hello world'

const html = `<!doctype html><html><head><meta charset="utf-8"><title>AT-3140 image survives text-line delete</title>
<style>@font-face{font-family:alldone;src:url('/icons.ttf')}
@font-face{font-family:Roboto-Regular;src:url('/regular.ttf')}
body{margin:16px;font-family:Roboto-Regular}</style>
${UNFIXED ? `<style>${UNFIXED_CSS}</style>` : ''}
</head><body><div id="root"></div><script src="/harness.js"></script></body></html>`

function build() {
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

function serve() {
    const fonts = { '/icons.ttf': 'alldone.ttf', '/regular.ttf': 'Roboto-Regular.ttf' }
    const server = http.createServer((req, res) => {
        if (fonts[req.url]) {
            res.setHeader('Content-Type', 'font/ttf')
            res.end(fs.readFileSync(path.join(root, 'assets/fonts', fonts[req.url])))
        } else if (req.url === '/harness.js') {
            res.setHeader('Content-Type', 'application/javascript')
            res.end(fs.readFileSync(path.join(output, 'harness.js')))
        } else {
            res.setHeader('Content-Type', 'text/html')
            res.end(html)
        }
    })
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)))
}

// Drop a real file on the editor, the way a drag from the desktop arrives: Quill's own drop
// listener resolves the range and hands the file to the app through GatedUploader.
async function dropMedia(page, kind) {
    await page.evaluate(async kind => {
        const quill = window.__editor
        let file
        if (kind === 'image') {
            const canvas = document.createElement('canvas')
            canvas.width = 320
            canvas.height = 180
            const context = canvas.getContext('2d')
            context.fillStyle = '#4a90d9'
            context.fillRect(0, 0, 320, 180)
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
            file = new File([blob], 'screenshot.png', { type: 'image/png' })
        } else {
            file = new File([new Uint8Array(16)], 'clip.mp4', { type: 'video/mp4' })
        }
        const dataTransfer = new DataTransfer()
        dataTransfer.items.add(file)
        const rect = quill.root.getBoundingClientRect()
        quill.root.dispatchEvent(
            new DragEvent('drop', {
                bubbles: true,
                cancelable: true,
                dataTransfer,
                clientX: rect.left + 4,
                clientY: rect.top + 4,
            })
        )
    }, kind)
    const blot = kind === 'image' ? 'customImageFormat' : 'videoFormat'
    await page.waitForFunction(blot => window.__editor.getContents().ops.some(op => op.insert && op.insert[blot]), blot)
    if (kind === 'image') {
        // CustomImage swaps its placeholder for the picture once Image.getSize resolves.
        await page.waitForFunction(() => !!window.__editor.root.querySelector('.ql-customImageFormat img'))
    }
}

const mediaCount = (page, blot) =>
    page.evaluate(blot => window.__editor.getContents().ops.filter(op => op.insert && op.insert[blot]).length, blot)
const plainText = page =>
    page.evaluate(() =>
        window.__editor
            .getContents()
            .ops.filter(op => typeof op.insert === 'string')
            .map(op => op.insert)
            .join('')
    )
const mediaIndex = (page, blot) =>
    page.evaluate(blot => {
        let index = 0
        for (const op of window.__editor.getContents().ops) {
            if (op.insert && op.insert[blot]) return index
            index += typeof op.insert === 'string' ? op.insert.length : 1
        }
        return -1
    }, blot)

const CASES = [
    {
        name: 'Shift+Home then Backspace deletes only the text line under the image',
        kind: 'image',
        keys: ['Shift+Home', 'Backspace'],
        expectTextRemoved: true,
        expectMedia: 1,
        bug: true,
    },
    {
        name: 'Shift+Home then Delete deletes only the text line under the image',
        kind: 'image',
        keys: ['Shift+Home', 'Delete'],
        expectTextRemoved: true,
        expectMedia: 1,
        bug: true,
    },
    {
        name: 'Shift+Home then typing replaces only the text line under the image',
        kind: 'image',
        keys: ['Shift+Home', 'x'],
        expectTextRemoved: true,
        expectMedia: 1,
        expectTextIncludes: 'x',
        bug: true,
    },
    {
        name: 'Home puts the caret on the text line, after the image',
        kind: 'image',
        keys: ['Home', 'x'],
        expectMedia: 1,
        expectCaretAfterMedia: true,
        bug: true,
    },
    {
        name: 'Shift+Home then Backspace keeps a video above the text line',
        kind: 'video',
        keys: ['Shift+Home', 'Backspace'],
        expectTextRemoved: true,
        expectMedia: 1,
        bug: true,
    },
    {
        name: 'extending the selection past the line start (Shift+Left) still deletes the image',
        kind: 'image',
        keys: ['Shift+Home', 'Shift+ArrowLeft', 'Backspace'],
        expectMedia: 0,
    },
    {
        name: 'selecting up into the image (Shift+Up) still deletes it',
        kind: 'image',
        keys: ['Shift+ArrowUp', 'Backspace'],
        expectMedia: 0,
    },
    {
        name: 'Backspace right after the image (caret at the start of the text line) deletes the image',
        kind: 'image',
        keys: [...Array(TEXT.length + 1).fill('ArrowLeft'), 'Backspace'],
        expectMedia: 0,
    },
]

async function main() {
    if (!process.argv.includes('--skip-build')) build()
    const server = await serve()
    const url = `http://127.0.0.1:${server.address().port}/`
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
    const browser = await chromium.launch({ args: ['--no-sandbox'] })
    let failures = 0
    try {
        // Layout: block rendering must not add empty guard lines around the media.
        {
            const page = await browser.newPage({ viewport: { width: 800, height: 700 } })
            await page.goto(url)
            await page.waitForFunction(() => !!window.__editor)
            await page.evaluate(() => window.__editor.focus())
            await dropMedia(page, 'image')
            await page.keyboard.type(TEXT)
            const geometry = await page.evaluate(() => {
                const span = window.__editor.root.querySelector('.ql-customImageFormat')
                const picture = span.querySelector('img').parentElement.getBoundingClientRect()
                const box = span.getBoundingClientRect()
                return { spanTop: box.top, spanBottom: box.bottom, top: picture.top, bottom: picture.bottom }
            })
            const label = 'the media embed adds no empty line above or below the picture'
            try {
                if (!UNFIXED) {
                    assert.ok(Math.abs(geometry.spanTop - geometry.top) <= 1, JSON.stringify(geometry))
                    assert.ok(Math.abs(geometry.spanBottom - geometry.bottom) <= 1, JSON.stringify(geometry))
                }
                console.log(`ok   ${label}`)
            } catch (error) {
                failures++
                console.log(`FAIL ${label}: ${error.message}`)
            }
            await page.screenshot({ path: path.join(output, 'composer.png') })
            await page.close()
        }

        for (const testCase of CASES) {
            const blot = testCase.kind === 'image' ? 'customImageFormat' : 'videoFormat'
            const page = await browser.newPage({ viewport: { width: 800, height: 700 } })
            const errors = []
            page.on('pageerror', error => errors.push(error.message))
            await page.goto(url)
            await page.waitForFunction(() => !!window.__editor)
            await page.evaluate(() => window.__editor.focus())
            await dropMedia(page, testCase.kind)
            await page.keyboard.type(TEXT)
            const embedIndex = await mediaIndex(page, blot)
            let selection = null
            for (const key of testCase.keys) {
                if (key === 'Backspace' || key === 'Delete' || key === 'x') {
                    selection = await page.evaluate(() => window.__editor.getSelection())
                }
                await page.keyboard.press(key)
            }
            await page.waitForTimeout(50)
            const count = await mediaCount(page, blot)
            const text = await plainText(page)
            const caret = await page.evaluate(() => window.__editor.getSelection())

            // Under --unfixed the bug cases must FAIL (the defect reproduces); everything else
            // must behave the same either way.
            const expectedCount = UNFIXED && testCase.bug ? 1 - testCase.expectMedia : testCase.expectMedia
            const label = `${UNFIXED && testCase.bug ? '[unfixed: defect reproduces] ' : ''}${testCase.name}`
            try {
                if (UNFIXED && testCase.bug && testCase.expectCaretAfterMedia) {
                    assert.ok(caret.index - 1 <= embedIndex, `caret ${JSON.stringify(caret)} embed ${embedIndex}`)
                } else {
                    assert.equal(count, expectedCount, `media count; selection was ${JSON.stringify(selection)}`)
                    if (!UNFIXED || !testCase.bug) {
                        if (testCase.expectTextRemoved)
                            assert.ok(!text.includes(TEXT), `text left: ${JSON.stringify(text)}`)
                        if (testCase.expectTextIncludes) assert.ok(text.includes(testCase.expectTextIncludes))
                        if (testCase.expectCaretAfterMedia) {
                            assert.ok(
                                caret.index - 1 > embedIndex,
                                `caret ${JSON.stringify(caret)} embed ${embedIndex}`
                            )
                        }
                    }
                }
                assert.deepEqual(errors, [])
                console.log(`ok   ${label}`)
            } catch (error) {
                failures++
                console.log(`FAIL ${label}: ${error.message}`)
            }
            await page.close()
        }
    } finally {
        await browser.close()
        await new Promise(resolve => server.close(resolve))
    }
    if (failures) {
        console.log(`\n${failures} failing`)
        process.exit(1)
    }
    console.log('\nall passing')
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
