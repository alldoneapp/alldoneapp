const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const output = path.join(__dirname, '.build')

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
                `harnessOut=${output}`,
                '--env',
                `harnessSetup=${path.join(__dirname, 'setup.js')}`,
            ],
            { cwd: root, stdio: 'inherit' }
        )
    }
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>@font-face{font-family:alldone;src:url('/icons.ttf')}
        @font-face{font-family:Roboto-Regular;src:url('/regular.ttf')}
        @font-face{font-family:Roboto-Medium;src:url('/medium.ttf')}
        @font-face{font-family:Roboto-Bold;src:url('/bold.ttf')}
        body{margin:16px;font-family:Roboto-Regular}
        #root{max-width:800px}</style></head><body><div id="root"></div><script src="/harness.js"></script></body></html>`
    const server = http.createServer((req, res) => {
        const fonts = {
            '/icons.ttf': 'alldone.ttf',
            '/regular.ttf': 'Roboto-Regular.ttf',
            '/medium.ttf': 'Roboto-Medium.ttf',
            '/bold.ttf': 'Roboto-Bold.ttf',
        }
        const file = fonts[req.url] ? path.join(root, 'assets/fonts', fonts[req.url]) : path.join(output, 'harness.js')
        res.setHeader(
            'Content-Type',
            fonts[req.url] ? 'font/ttf' : req.url === '/harness.js' ? 'application/javascript' : 'text/html'
        )
        res.end(fonts[req.url] || req.url === '/harness.js' ? fs.readFileSync(file) : html)
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let browser
    try {
        const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
        browser = await chromium.launch({ args: ['--no-sandbox'] })
        for (const width of [1280, 390, 320]) {
            const page = await browser.newPage({ viewport: { width, height: 720 }, hasTouch: width < 600 })
            const errors = []
            page.on('pageerror', error => {
                errors.push(error.message)
                console.error(error.stack)
            })
            await page.route('**/*', route =>
                new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()
            )
            const url = `http://127.0.0.1:${server.address().port}/`
            await page.goto(url)
            const plus = page.getByRole('button', { name: 'Select kind of file to add', exact: true })
            await plus.waitFor()
            await page.waitForFunction(() => window.__editor)
            await page.evaluate(() => document.fonts.ready)
            const geometry = await page.evaluate(() => {
                const editor = window.__editor.root
                const plus = document.querySelector('[aria-label="Select kind of file to add"]')
                const mic = document.querySelector('[aria-label="Dictate"]')
                const a = plus.getBoundingClientRect(),
                    b = mic.getBoundingClientRect()
                return {
                    plusRight: a.right,
                    micLeft: b.left,
                    plusTop: a.top,
                    micTop: b.top,
                    padding: parseFloat(getComputedStyle(editor).paddingRight),
                    micWidth: b.width,
                }
            })
            assert(geometry.micWidth >= 24, 'dictation mic must be present')
            assert(
                geometry.plusRight <= geometry.micLeft,
                `plus and microphone must not overlap: ${JSON.stringify(geometry)}`
            )
            assert(Math.abs(geometry.plusTop - geometry.micTop) <= 1, 'plus and microphone must align')
            assert.equal(geometry.padding, 62, 'text must reserve space for both controls')
            await page.screenshot({ path: path.join(output, `composer-${width}.png`) })

            // A file selected after the menu has blurred the editor must retain the original caret.
            await page.evaluate(() => {
                window.__editor.setText('Before After')
                window.__editor.setSelection(7, 0)
            })
            await plus.click()
            await page.getByText('File or image', { exact: true }).waitFor()
            await page.waitForTimeout(400)
            await page.screenshot({ path: path.join(output, `menu-${width}.png`) })
            const chooser = page.waitForEvent('filechooser')
            await page.getByText('File or image', { exact: true }).click()
            await (
                await chooser
            ).setFiles({ name: 'review document.pdf', mimeType: 'application/pdf', buffer: Buffer.from('fixture') })
            await page.waitForFunction(() =>
                window.__editor.getContents().ops.some(op => op.insert?.attachment?.text === 'review_document.pdf')
            )
            const ops = await page.evaluate(() => window.__editor.getContents().ops)
            assert.equal(ops[0].insert, 'Before ')
            assert(ops.some(op => typeof op.insert === 'string' && op.insert.includes('After')))
            assert(await page.evaluate(() => window.__message.includes('review_document.pdf')))
            await page.waitForTimeout(400)
            await plus.click()
            await page.getByText('Record a video', { exact: true }).waitFor()
            await page.getByText('Screen recording', { exact: true }).waitFor()
            await page.keyboard.press('Escape')
            await page.waitForTimeout(400)
            await page.goto(`${url}?no-mic`)
            await plus.waitFor()
            assert.equal(await page.locator('.ql-editorWithAttachment').count(), 1)
            await page.goto(`${url}?readonly`)
            await page.waitForFunction(() => window.__editor)
            assert.equal(await plus.count(), 0)
            await page.goto(`${url}?ordinary`)
            await page.waitForFunction(() => window.__editor)
            assert.equal(await plus.count(), 0)
            assert.deepEqual(errors, [])
            console.log(
                `PASS ${width}px: aligned controls, responsive menu, file insertion at caret, disabled/ordinary inputs`
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
