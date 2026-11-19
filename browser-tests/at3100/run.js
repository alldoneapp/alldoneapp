/**
 * AT-3100 — search in the assistant switch popup ("Assistent wechseln"), in real Chromium.
 *
 * jsdom has no layout, so the "search stays visible while the list scrolls" requirement can only
 * be checked here. Also covers filtering, group hiding, the empty state, clearing, Enter and
 * Escape on the real react-native-web TextInput, on desktop (popover) and phone (bottom sheet).
 *
 *   node browser-tests/at3100/run.js [--skip-build]
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const buildDir = path.join(__dirname, '.build')

const SEARCH = '[data-testid="assistant-switch-search"]'

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
                `harnessOut=${buildDir}`,
            ],
            { cwd: root, stdio: 'inherit' }
        )
    }
    const html =
        '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script src="/harness.js"></script></body></html>'
    const server = http.createServer((req, res) => {
        if (req.url === '/') {
            res.setHeader('Content-Type', 'text/html')
            res.end(html)
            return
        }
        const file = path.join(buildDir, path.basename(req.url))
        if (!fs.existsSync(file)) {
            res.writeHead(404)
            res.end()
            return
        }
        res.setHeader('Content-Type', 'application/javascript')
        res.end(fs.readFileSync(file))
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let browser
    try {
        const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
        browser = await chromium.launch({ args: ['--no-sandbox'] })
        for (const width of [1280, 390]) {
            const page = await browser.newPage({ viewport: { width, height: 700 }, hasTouch: width < 600 })
            const errors = []
            page.on('pageerror', error => {
                errors.push(error.message)
                console.error(error.stack)
            })
            // A UI fixture must never read or write production data.
            await page.route(/https?:\/\/(?!127\.0\.0\.1)/, route => route.abort())
            await page.goto(`http://127.0.0.1:${server.address().port}/`)
            await page.waitForFunction(() => window.__ready)

            // The popup card: the innermost element holding both the title and the field (the
            // trigger button also shows "Anna Alldone", so rows are counted inside the card only).
            const card = () =>
                page
                    .locator('div', { has: page.locator(SEARCH) })
                    .filter({ hasText: 'Switch assistant' })
                    .last()
            const rows = () =>
                card().locator(
                    'text=/^(Anna|Ricky|Connor|Judy|Sarah|JTL Assistant|Alldone Consulting COO|Lenny|Marty|Paul)/'
                )
            const open = async () => {
                await page.getByTestId('assistant-line-switch-button').click()
                await page.locator(SEARCH).waitFor({ state: 'visible', timeout: 5000 })
            }

            await open()
            const search = page.locator(SEARCH)
            assert.equal(await search.getAttribute('placeholder'), 'Search assistants')
            assert.equal(await search.getAttribute('aria-label'), 'Search assistants')
            assert.equal(await search.evaluate(node => node === document.activeElement), false, 'not autofocused')
            assert.equal(await rows().count(), 11)

            // Sticky search: scroll the list to the bottom, the field must not move. Wait out
            // the sheet's slide-in first; it moves the whole card.
            await page.waitForTimeout(600)
            const before = await search.boundingBox()
            const scrolled = await page.evaluate(selector => {
                const field = document.querySelector(selector)
                const scrollers = [...document.querySelectorAll('div')].filter(
                    node =>
                        node.scrollHeight > node.clientHeight + 20 &&
                        ['auto', 'scroll'].includes(getComputedStyle(node).overflowY)
                )
                const list = scrollers.find(
                    node => node.textContent.includes('Paul Product Manager') && !node.contains(field)
                )
                if (!list) return null
                list.scrollTop = list.scrollHeight
                return { top: list.scrollTop, height: list.clientHeight }
            }, SEARCH)
            assert.ok(scrolled && scrolled.top > 0, `the list scrolls (${JSON.stringify(scrolled)})`)
            await page.waitForTimeout(100)
            const after = await search.boundingBox()
            assert.deepEqual(after, before, 'search field stays put while the list scrolls')
            assert.ok(after.y >= 0 && after.y + after.height <= 700, 'search field is on screen')
            await page.getByText('Paul Product Manager').waitFor({ state: 'visible' })

            // Case-insensitive, grouped, empty groups hidden.
            await search.fill('mARTY')
            assert.equal(await rows().count(), 2)
            for (const header of ['Alldone Consulting', 'Alldone Team']) {
                assert.equal(await page.getByText(header, { exact: true }).count(), 1, header)
            }
            for (const header of ['Privat', 'JTL Software - Project Juno']) {
                assert.equal(await page.getByText(header, { exact: true }).count(), 0, header)
            }

            // Empty state, then the clear button restores everything.
            await search.fill('zzz')
            assert.equal(await rows().count(), 0)
            await page.getByText('No assistants found').waitFor({ state: 'visible' })
            await page.getByRole('button', { name: 'Clear' }).click()
            assert.equal(await search.inputValue(), '')
            assert.equal(await rows().count(), 11)
            assert.equal(await page.getByText('No assistants found').count(), 0)

            // Escape clears the query first and leaves the popup open.
            await search.fill('judy')
            assert.equal(await rows().count(), 1)
            await search.press('Escape')
            assert.equal(await search.inputValue(), '')
            assert.equal(await rows().count(), 11)

            // Enter picks the first match and closes.
            await search.fill('marty')
            await search.press('Enter')
            await search.waitFor({ state: 'detached', timeout: 5000 })
            assert.deepEqual(await page.evaluate(() => window.__active), {
                projectId: 'p-consulting',
                assistantId: 'p-consulting-a2',
            })

            // Reopening starts with an empty search and the full list.
            await open()
            assert.equal(await page.locator(SEARCH).inputValue(), '')
            assert.equal(await rows().count(), 11)

            // Clicking a filtered row selects exactly that row.
            await page.locator(SEARCH).fill('paul')
            await page.getByText('Paul Product Manager').click()
            await page.locator(SEARCH).waitFor({ state: 'detached', timeout: 5000 })
            assert.deepEqual(await page.evaluate(() => window.__active), {
                projectId: 'p-team',
                assistantId: 'p-team-a0',
            })

            await page.screenshot({ path: path.join(buildDir, `at3100-${width}.png`) })
            assert.deepEqual(errors, [])
            console.log(`PASS ${width}px`)
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
