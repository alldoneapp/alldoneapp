const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { execFileSync } = require('node:child_process')
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64'
)

async function main() {
    const root = path.resolve(__dirname, '../..')
    const output = path.join(__dirname, '.build')
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
                `harnessOut=${output}`,
                '--env',
                `harnessSetup=${path.join(__dirname, 'setup.js')}`,
            ],
            { cwd: root, stdio: 'inherit' }
        )
    const server = http.createServer((req, res) => {
        const pathname = req.url.split('?')[0]
        if (pathname === '/image.png') {
            res.setHeader('Content-Type', 'image/png')
            res.end(PNG)
            return
        }
        if (/^\/fonts\/(Roboto-(?:Regular|Medium|Bold)|alldone)\.ttf$/.test(pathname)) {
            res.setHeader('Content-Type', 'font/ttf')
            res.end(fs.readFileSync(path.join(root, 'assets', pathname)))
            return
        }
        if (pathname.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript')
            res.end(fs.readFileSync(path.join(output, path.basename(pathname))))
            return
        }
        res.setHeader('Content-Type', 'text/html')
        res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
            ${['Roboto-Regular', 'Roboto-Medium', 'Roboto-Bold', 'alldone'].map(font => `@font-face{font-family:'${font}';src:url('/fonts/${font}.ttf');}`).join('')}
            body{margin:0;font-family:'Roboto-Regular'}*{flex-basis:auto!important;}
        </style><title>AT-2741</title>${fs
            .readdirSync(output)
            .filter(name => name.endsWith('.js') && !name.endsWith('.chunk.js'))
            .sort(name => (name.startsWith('runtime') ? -1 : 1))
            .map(name => `<script defer src="/${name}"></script>`)
            .join('')}`)
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let browser
    try {
        const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
        browser = await chromium.launch({ args: ['--no-sandbox'] })
        for (const mobile of [false, true]) {
            const page = await browser.newPage({
                viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
                isMobile: mobile,
                hasTouch: mobile,
            })
            const errors = []
            page.on('pageerror', error => {
                if (error.message !== 'Event') {
                    errors.push(error.message)
                    console.error(error.message)
                }
            })
            if (process.env.HARNESS_DEBUG)
                page.on('console', message => {
                    if (message.type() === 'error') console.error(message.text().slice(0, 500))
                })
            await page.goto(`http://127.0.0.1:${server.address().port}`)
            const editor = page.locator('.ql-editor')
            await page.evaluate(() => document.fonts.ready)
            await editor.waitFor()
            await page.waitForTimeout(1200)
            assert.equal(await page.evaluate(() => window.__writes.length), 0, 'Mount must not write')
            assert.equal(await page.getByText(/^(Save|Ok)$/).count(), 0)
            await editor.fill('Autosaved text')
            await page.waitForFunction(() => window.__writes.at(-1) === 'Autosaved text')
            await editor.press('End')
            await editor.press('Enter')
            await page.keyboard.insertText('Second line')
            await page.waitForFunction(() => window.__writes.at(-1)?.includes('Second line'))
            assert.ok(await editor.innerText().then(text => text.includes('\nSecond line')))
            // A real file drop must upload and persist immediately, without another keystroke.
            await page.evaluate(base64 => {
                const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
                const files = new DataTransfer()
                files.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }))
                document
                    .querySelector('.ql-editor')
                    .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: files }))
            }, PNG.toString('base64'))
            await page.waitForFunction(() => window.__writes.at(-1)?.includes('dropped.png'))
            assert.equal(await page.evaluate(() => window.__writes.at(-1).includes('blob:')), false)
            assert.equal(await page.evaluate(() => window.__uploads.length), 2)
            await editor.press('End')
            await page.keyboard.insertText(' after image')
            await page.waitForFunction(() => window.__writes.at(-1)?.includes('after image'))
            assert.equal(
                await page.evaluate(() => window.__uploads.length),
                2,
                'Typing must not upload the image again'
            )
            // The real picker goes through the same autosave path.
            await page.getByRole('button', { name: 'Select kind of file to add' }).click()
            const choosing = page.waitForEvent('filechooser')
            await page.getByText('File or image', { exact: true }).click()
            const chooser = await choosing
            await chooser.setFiles({ name: 'picked.png', mimeType: 'image/png', buffer: PNG })
            await page.waitForFunction(() => window.__writes.at(-1)?.includes('picked.png'))
            assert.equal(await page.evaluate(() => window.__uploads.length), 4)
            // Failed writes preserve the editor content and are recoverable after remount.
            await page.evaluate(() => {
                window.__failWrite = true
            })
            await editor.fill('Draft retained after failure')
            await page.getByText('Could not save. Your draft is kept in this session. Please try again.').waitFor()
            await page.evaluate(() => window.__setVisible(false))
            await editor.waitFor({ state: 'detached' })
            await page.evaluate(() => window.__setVisible(true))
            await editor.waitFor()
            assert.equal(await editor.innerText(), 'Draft retained after failure')
            await page.evaluate(() => {
                window.__failWrite = false
            })
            await page.getByText('Try again', { exact: true }).click()
            await page.waitForFunction(() => window.__writes.at(-1) === 'Draft retained after failure')
            await editor.fill('Blur saves immediately')
            await page.locator('#outside').click()
            await page.waitForFunction(() => window.__writes.at(-1) === 'Blur saves immediately')
            if (process.env.HARNESS_SCREENSHOTS) {
                fs.mkdirSync(path.join(__dirname, 'screenshots'), { recursive: true })
                await page.screenshot({
                    path: path.join(__dirname, 'screenshots', `${mobile ? 'mobile' : 'desktop'}.png`),
                })
            }
            assert.deepEqual(errors, [])
            console.log(
                `PASS ${mobile ? 'mobile' : 'desktop'}: real Quill, text debounce, multiline Enter, drop, picker, upload reuse, failure recovery, blur`
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
