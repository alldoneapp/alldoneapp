const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createRequire } = require('node:module')

const root = path.resolve(__dirname, '../..')
const buildDir = process.env.HARNESS_OUTPUT || path.join(__dirname, '.build')
const baseline = process.argv.includes('--baseline')

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
                '--env',
                `harnessSetup=${path.join(__dirname, 'webpack.setup.js')}`,
            ],
            { cwd: root, stdio: 'inherit' }
        )
    }
    const server = http.createServer((req, res) => {
        if (req.url.startsWith('/?') || req.url === '/') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(
                '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}</style><div id="root"></div><script src="/harness.js"></script>'
            )
        } else {
            const file = path.join(buildDir, path.basename(req.url))
            if (!fs.existsSync(file)) {
                res.writeHead(404)
                res.end()
                return
            }
            res.setHeader('Content-Type', 'application/javascript')
            res.end(fs.readFileSync(file))
        }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let browser
    try {
        const browserRequire = createRequire(path.join(process.env.PLAYWRIGHT_HOME || root, 'package.json'))
        const { chromium } = browserRequire('playwright')
        let launch = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }
        if (process.env.CHROMIUM_EXECUTABLE_PATH) launch.executablePath = process.env.CHROMIUM_EXECUTABLE_PATH
        else {
            try {
                const packaged = browserRequire('@sparticuz/chromium').default
                launch = { ...launch, executablePath: await packaged.executablePath(), args: packaged.args }
            } catch {
                /* Use Playwright's installed Chromium. */
            }
        }
        browser = await chromium.launch(launch)
        const page = await browser.newPage()
        const errors = []
        page.on('pageerror', error => {
            errors.push(error.message)
            console.error(error.message)
        })
        await page.route('**/*', route =>
            route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort()
        )
        const cases = [
            { width: 819, query: '', name: 'screenshot', sameRow: true },
            { width: 1440, query: 'expanded', name: 'desktop-expanded', sameRow: true },
            { width: 1052, query: '', name: 'compact-flag-with-space', sameRow: true },
            { width: 640, query: '', name: 'narrow-desktop' },
            { width: 390, query: '', name: 'mobile' },
            { width: 320, query: 'extras', name: 'small-mobile-extra-tags' },
            { width: 1440, query: 'expanded&extras', name: 'desktop-extra-tags' },
            {
                width: 819,
                query: `name=${encodeURIComponent('Sehr langes Projekt '.repeat(20))}`,
                name: 'long-project',
            },
            { width: 819, query: `name=${'UnbrokenProjectName'.repeat(30)}`, name: 'unbroken-project' },
            { width: 320, query: `name=${'UnbrokenProjectName'.repeat(30)}`, name: 'mobile-long-project' },
            { width: 819, query: 'shared', name: 'shared-viewer', sameRow: true },
            { width: 819, query: 'language=en', name: 'english', sameRow: true },
            { width: 690, query: 'language=es', name: 'spanish-narrow' },
            { width: 1440, query: 'contentWidth=480&language=es', name: 'spanish-narrow-container' },
            { width: 1440, query: 'contentWidth=480', name: 'desktop-narrow-container' },
            { width: 240, query: '', name: 'very-small-mobile' },
            { width: 1440, query: 'private&contentWidth=480', name: 'private-participant-avatars' },
            { width: 320, query: 'private', name: 'mobile-private-participant-avatars' },
        ]
        for (const testCase of cases) {
            await page.setViewportSize({ width: testCase.width, height: 950 })
            await page.goto(`http://127.0.0.1:${server.address().port}/?${testCase.query}`)
            await page.getByTestId('header-note').waitFor()
            await page.evaluate(
                async fonts => {
                    for (const [family, bytes] of fonts) {
                        document.fonts.add(await new FontFace(family, new Uint8Array(bytes)).load())
                    }
                    await document.fonts.ready
                    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
                    window.open = () => {
                        window.__newWindowOpened = true
                    }
                },
                ['Roboto-Medium', 'Roboto-Regular', 'alldone'].map(family => [
                    family,
                    Array.from(fs.readFileSync(path.join(root, `assets/fonts/${family}.ttf`))),
                ])
            )
            const geometry = await page.evaluate(() => {
                const rect = node => {
                    const { x, y, width, height } = node.getBoundingClientRect()
                    return { x, y, width, height, right: x + width, bottom: y + height }
                }
                return [...document.querySelectorAll('[data-testid^="header-"]')].map(header => {
                    const row = header.lastElementChild.firstElementChild
                    const tags = row.firstElementChild
                    const actions = row.lastElementChild
                    const primary = tags.firstElementChild
                    const tagNodes =
                        primary?.children.length === 2
                            ? [...primary.children, ...[...tags.children].slice(1)]
                            : [...tags.children]
                    return {
                        type: header.dataset.testid,
                        header: rect(header),
                        tags: tagNodes.map(rect),
                        actions: [...actions.children].map(rect),
                        actionGroup: rect(actions),
                        overflow: [...header.querySelectorAll('*')]
                            .filter(
                                node =>
                                    node.getBoundingClientRect().right > header.getBoundingClientRect().right + 1 &&
                                    getComputedStyle(node).position !== 'fixed'
                            )
                            .map(node => node.textContent.slice(0, 50)),
                    }
                })
            })
            await page.screenshot({
                path: path.join(buildDir, `${baseline ? 'before' : 'after'}-${testCase.name}.png`),
            })
            console.log(
                JSON.stringify({
                    name: testCase.name,
                    width: testCase.width,
                    headers: geometry.map(row => ({
                        type: row.type,
                        tagRows: [...new Set(row.tags.map(tag => tag.y))].length,
                        actions: row.actions.length,
                        overflow: row.overflow,
                    })),
                })
            )
            if (baseline) continue
            assert.deepEqual(errors, [], 'No browser runtime errors')
            assert.equal(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                true,
                testCase.name
            )
            for (const row of geometry) {
                assert.deepEqual(row.overflow, [], `${testCase.name}: ${row.type} stays inside header`)
                if (testCase.sameRow && row.tags.length > 1)
                    assert.equal(row.tags[0].y, row.tags[1].y, `${testCase.name}: ${row.type} tags share a row`)
                for (const tag of row.tags)
                    for (const action of row.actions) {
                        assert.ok(
                            tag.right <= action.x + 1 ||
                                action.right <= tag.x + 1 ||
                                tag.bottom <= action.y + 1 ||
                                action.bottom <= tag.y + 1,
                            `${testCase.name}: ${row.type} tags/actions never overlap`
                        )
                    }
            }
            const noteButtons = page
                .getByTestId('header-note')
                .locator(':scope > div:last-child > div > div:last-child > div')
            const count = await noteButtons.count()
            assert.equal(count, testCase.query.includes('shared') ? 2 : 4, 'All permitted actions remain available')
            for (let i = 0; i < count; i++) {
                const button = noteButtons.nth(i)
                await button.scrollIntoViewIfNeeded()
                assert.equal(
                    await button.evaluate(node => {
                        const r = node.getBoundingClientRect()
                        return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
                    }),
                    true,
                    'Action is hit-testable'
                )
            }
            await noteButtons.first().click()
            assert.equal(await page.evaluate(() => window.__copied), true)
            await noteButtons.last().click()
            assert.equal(await page.evaluate(() => window.__newWindowOpened), true)
        }
        // Resize an already mounted DV across the responsive breakpoints.
        await page.goto(`http://127.0.0.1:${server.address().port}/`)
        for (const width of [1440, 320, 819]) {
            await page.setViewportSize({ width, height: 950 })
            await page.waitForTimeout(100)
            assert.equal(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                true,
                `resize to ${width}`
            )
        }
        assert.deepEqual(errors, [])
        console.log(baseline ? 'Baseline captured' : `${cases.length} browser scenarios and live resizing passed`)
    } finally {
        if (browser) await browser.close()
        await new Promise(resolve => server.close(resolve))
    }
}
main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
