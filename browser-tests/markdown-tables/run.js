// Run with Node 22. PLAYWRIGHT_MODULE may point to the bundled desktop runtime.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = path.resolve(__dirname, '../..')
const output = path.join(__dirname, '.build')
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
    { cwd: path.join(root, 'web-bundler'), stdio: 'inherit' }
)
const html =
    '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:16px;font-family:Arial}#editor{height:auto;min-height:400px}.ql-editor{margin:0}</style><div id="editor"></div><script src="/harness.js"></script>'
const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/harness.js' ? 'application/javascript' : 'text/html')
    res.end(req.url === '/harness.js' ? fs.readFileSync(path.join(output, 'harness.js')) : html)
})
;(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const browser = await chromium.launch({
        headless: true,
        ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
    })
    try {
        for (const mobile of [false, true]) {
            const context = await browser.newContext({
                viewport: { width: mobile ? 390 : 1280, height: 844 },
                isMobile: mobile,
                hasTouch: mobile,
                permissions: ['clipboard-read', 'clipboard-write'],
            })
            const page = await context.newPage()
            page.setDefaultTimeout(10000)
            const errors = []
            page.on('pageerror', error => errors.push(error.message))
            await page.goto(`http://127.0.0.1:${server.address().port}`)
            await page.waitForFunction(() => !!window.editor)
            const first = page.locator('[data-row="1"][data-column="0"]')
            if (mobile) await first.tap()
            else await first.click()
            let input = page.locator('.ql-table-cell-input')
            await input.fill('**Alicia**')
            await input.press('Tab')
            assert.equal(await input.inputValue(), 'Open')
            assert.equal(await page.evaluate(() => tableValue().rows[1][0]), '**Alicia**')
            await input.fill('Ready')
            await input.press('Enter')
            await page.evaluate(() => editor.history.undo())
            assert.equal(await page.evaluate(() => tableValue().rows[1][1]), 'Open')
            await page.evaluate(() => editor.history.redo())
            assert.equal(await page.evaluate(() => tableValue().rows[1][1]), 'Ready')
            await first.click()
            await input.fill('Draft')
            await input.pressSequentially(' typing')
            assert.equal(await input.inputValue(), 'Draft typing')
            await input.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z')
            assert.notEqual(await input.inputValue(), 'Draft typing')
            await input.press('Escape')
            assert.equal(await page.evaluate(() => tableValue().rows[1][0]), '**Alicia**')
            await first.click()
            await input.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
            await page.evaluate(() => navigator.clipboard.writeText('Pasted cell text'))
            await input.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V')
            await page.waitForFunction(
                () => document.querySelector('.ql-table-cell-input').value === 'Pasted cell text'
            )
            assert.deepEqual(await page.evaluate(() => documentClipboardEvents), [])
            await input.press('Enter')
            assert.equal(await page.evaluate(() => tableValue().rows[1][0]), 'Pasted cell text')
            await first.click()
            await page.locator('[data-table-action="add-column"]').click()
            assert.equal(await page.evaluate(() => tableValue().rows[0].length), 3)
            await page.locator('[data-table-action="remove-column"]').click()
            assert.equal(await page.evaluate(() => tableValue().rows[0].length), 2)
            await page.locator('[data-table-action="add-row"]').focus()
            await page.locator('[data-table-action="add-row"]').press('Enter')
            assert.equal(await page.evaluate(() => tableValue().rows.length), 4)
            await page.locator('[data-table-action="remove-row"]').click()
            assert.equal(await page.evaluate(() => tableValue().rows.length), 3)
            await page.locator('[data-table-action="align-center"]').click()
            assert.equal(await page.evaluate(() => tableValue().alignments[1]), 'center')
            await input.press('Enter')
            assert.equal(await page.evaluate(() => editor.getText()), 'Before the table\nAfter the table\n')
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
            await page.screenshot({ path: path.join(output, mobile ? 'mobile.png' : 'desktop.png'), fullPage: true })
            assert.deepEqual(errors, [])
            console.log(
                `${mobile ? 'Mobile touch' : 'Desktop'}: inline edit, Tab, undo/redo, Escape, native paste, row/column controls and alignment passed`
            )
            await context.close()
        }
    } finally {
        await browser.close()
        server.close()
    }
})().catch(error => {
    console.error(error)
    server.close()
    process.exitCode = 1
})
