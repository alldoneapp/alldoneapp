const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

async function main() {
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
    const server = http.createServer((req, res) => {
        res.setHeader('Content-Type', req.url === '/harness.js' ? 'application/javascript' : 'text/html')
        res.end(
            req.url === '/harness.js'
                ? fs.readFileSync(path.join(output, 'harness.js'))
                : '<!doctype html><title>Alldone fixture</title><script defer src="/harness.js"></script>'
        )
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let browser
    try {
        const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
        browser = await chromium.launch({ args: ['--no-sandbox'] })
        const page = await browser.newPage()
        const errors = []
        page.on('pageerror', error => errors.push(error.message))
        const base = `http://127.0.0.1:${server.address().port}`
        const cdp = await page.context().newCDPSession(page)
        const entries = async () => (await cdp.send('Page.getNavigationHistory')).entries
        const check = async (pathname, title) => {
            await page.waitForFunction(expected => window.location.pathname === expected, pathname)
            assert.equal(await page.title(), title)
            assert.equal(await page.locator('output').textContent(), pathname)
        }
        const list = '/projects/p1/user/u1/tasks/open'
        const note = '/projects/p1/notes/n1/editor'
        const listTitle = 'Alldone.app - Product - Karsten - Tasks'
        const noteTitle = 'Alldone.app - Product - Workflow Feature - Editor'
        await page.goto(base + list)
        await check(list, listTitle)

        // Reproduce the old ordering in Chromium's own navigation entries.
        await page.evaluate(() => {
            document.title = 'Workflow Feature'
            history.pushState(null, '', '/old-order-note')
        })
        assert.equal((await entries()).find(entry => entry.url === base + list).title, 'Workflow Feature')
        console.log('PASS reproduction: old title-before-URL ordering mislabels the task-list entry')

        await page.goto(base + list)
        await page.click('#note')
        await check(note, noteTitle)
        const currentEntries = await entries()
        assert.equal(currentEntries.at(-2).title, listTitle)
        assert.equal(currentEntries.at(-1).title, noteTitle)
        await page.click('#properties')
        await check('/projects/p1/notes/n1/properties', 'Alldone.app - Product - Workflow Feature - Properties')
        await page.goBack()
        await check(note, noteTitle)
        await page.goForward()
        await check('/projects/p1/notes/n1/properties', 'Alldone.app - Product - Workflow Feature - Properties')
        await page.click('#next')
        await check('/projects/p1/notes/n2/editor', 'Alldone.app - Product - Release plan - Editor')
        await page.click('#close')
        await check(list, listTitle)
        await page.goBack()
        await check('/projects/p1/notes/n2/editor', 'Alldone.app - Product - Release plan - Editor')
        await page.goForward()
        await check(list, listTitle)
        await page.click('#goal')
        await check('/projects/p1/goals/g1', 'Alldone.app - Product - Goal details')
        assert.equal((await entries()).at(-2).title, listTitle)
        console.log('PASS open, tabs, note-to-note, close, Back/Forward and goal title/URL pairing')

        await page.goto(base + note + '?assistant=1')
        await check(note, noteTitle)
        assert.equal(new URL(page.url()).search, '?assistant=1')
        const length = (await entries()).length
        await page.reload()
        await check(note, noteTitle)
        assert.equal((await entries()).length, length)
        await page.click('#next')
        assert.equal(new URL(page.url()).search, '?assistant=1')
        await page.goBack()
        await check(note, noteTitle)
        await page.goForward()
        await check('/projects/p1/notes/n2/editor', 'Alldone.app - Product - Release plan - Editor')
        assert.deepEqual(errors, [])
        console.log('PASS direct deep link, reload, assistant mode and title restoration without duplicate entries')
    } finally {
        if (browser) await browser.close()
        await new Promise(resolve => server.close(resolve))
    }
}
main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
