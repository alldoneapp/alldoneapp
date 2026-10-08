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
    const server = http.createServer((req, res) => {
        if (req.url === '/regular.ttf') {
            res.setHeader('Content-Type', 'font/ttf')
            res.end(fs.readFileSync(path.join(root, 'assets/fonts/Roboto-Regular.ttf')))
            return
        }
        res.setHeader('Content-Type', req.url === '/harness.js' ? 'application/javascript' : 'text/html')
        res.end(
            req.url === '/harness.js'
                ? fs.readFileSync(path.join(output, 'harness.js'))
                : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>@font-face{font-family:Roboto-Regular;src:url(/regular.ttf)}body{font-family:Roboto-Regular}</style></head><body style="margin:0"><div id="root"></div><script src="/harness.js"></script></body></html>'
        )
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let browser
    try {
        const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
        browser = await chromium.launch({ args: ['--no-sandbox'] })
        for (const width of [420, 390, 320]) {
            const page = await browser.newPage({ viewport: { width, height: 720 } })
            const errors = []
            page.on('pageerror', error => {
                errors.push(error.message)
                console.error(error.stack)
            })
            await page.route('**/*', route =>
                new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()
            )
            await page.goto(`http://127.0.0.1:${server.address().port}`)
            const input = page.getByRole('textbox', { name: 'Message Anna' })
            await input.waitFor()
            await page.evaluate(() => document.fonts.ready)
            await input.pressSequentially('hello')
            assert.equal(await page.evaluate(() => window.__draft), 'hello', 'native typing preserves text and caret')
            await page.getByRole('button', { name: 'Send message' }).click()
            for (const [name, expected] of [
                ['Task', '/projects/conversation-project/tasks/task-1/editor'],
                ['Goal', '/projects/conversation-project/goals/goal-1/editor'],
                ['Note', '/projects/other-project/notes/note-1/editor'],
                ['Chat', '/projects/conversation-project/chats/chat-1/editor'],
                ['Contact', '@KarlMENTION_SPACE_CODEContact#contact-1'],
                ['Assistant', '@CarlMENTION_SPACE_CODECode#assistant-1'],
            ]) {
                await input.fill('@')
                await page.locator('[data-picker]').waitFor()
                const popup = await page.locator('.react-tiny-popover-container').boundingBox()
                assert(popup.x >= 0 && popup.x < width, 'mention popup stays in the assistant chat')
                if (name === 'Task') await page.screenshot({ path: path.join(output, `picker-${width}.png`) })
                await page.getByRole('button', { name, exact: true }).click()
                await page.locator('[data-picker]').waitFor({ state: 'detached' })
                assert((await page.evaluate(() => window.__draft)).includes(expected), `${name} reference identity`)
                if (name === 'Note') await page.screenshot({ path: path.join(output, `reference-${width}.png`) })
                await page.getByRole('button', { name: 'Dictate', exact: true }).click()
                assert((await page.evaluate(() => window.__draft)).includes(expected), `${name} survives dictation`)
                await page.getByRole('button', { name: 'Send message' }).click()
                assert(
                    (await page.evaluate(() => window.__sent.at(-1))).includes(expected),
                    `${name} sent reference identity`
                )
                assert.equal(await input.textContent(), '')
            }
            const sentBefore = await page.evaluate(() => window.__sent.length)
            await input.fill('@')
            await page.locator('[data-picker]').waitFor()
            await input.press('Enter')
            await page.locator('[data-picker]').waitFor({ state: 'detached' })
            assert.equal(await page.evaluate(() => window.__sent.length), sentBefore, 'Enter selects without sending')
            assert(
                !(await page.evaluate(() => window.__draft.trim())).includes('\n'),
                'Enter selection adds no newline'
            )
            await input.press('Enter')
            assert.equal(await page.evaluate(() => window.__sent.length), sentBefore + 1)
            await input.pressSequentially('First line')
            await input.press('Shift+Enter')
            await input.press('a')
            assert.equal(
                await page.evaluate(() => window.__draft.trim()),
                'First line\na',
                'Shift+Enter adds one newline'
            )
            const geometry = await input.boundingBox()
            assert(geometry.x >= 0 && geometry.x + geometry.width <= width, 'editor fits narrow conversation')
            await page.screenshot({ path: path.join(output, `composer-${width}.png`) })
            await input.fill('@')
            await page.locator('[data-picker]').waitFor()
            await page.evaluate(() => window.__disable(true))
            await page.waitForFunction(
                () => document.querySelector('.ql-editor').getAttribute('contenteditable') === 'false'
            )
            await page.locator('[data-picker]').waitFor({ state: 'detached' })
            assert.equal(await page.evaluate(() => window.__draft.trim()), '@', 'voice lock preserves draft')
            assert.deepEqual(errors, [])
            console.log(
                `PASS ${width}px: all five tabs, assistant reference, dictation, Enter selection/send, multiline, voice lock`
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
