const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const output = process.env.HARNESS_OUTPUT || path.join(__dirname, '.build')
const results = []

async function measure(page, count, expanded = false, milestone = true) {
    const geometry = await page.evaluate(() => {
        const group = document.getElementById('social_tags_p1_g1')
        return {
            header: document.getElementById('goal_container_p1_g1').getBoundingClientRect().toJSON(),
            buttons: [...(group?.querySelectorAll('button, [tabindex="0"]') || [])].map(n => ({
                label: n.textContent,
                ...n.getBoundingClientRect().toJSON(),
            })),
            scroll: document.getElementById('expanded_goal_tags_p1_g1')?.getBoundingClientRect().toJSON(),
            next: document.getElementById('following-task').getBoundingClientRect().toJSON(),
            documentOverflows: document.documentElement.scrollWidth > innerWidth,
        }
    })
    assert(!geometry.documentOverflows, 'no horizontal page overflow')
    assert.equal(geometry.buttons.length, count, 'expected tags present')
    assert.equal(!!geometry.scroll, expanded, 'second row only after click')
    if (expanded) {
        const summary = await page.getByLabel('Tags', { exact: true }).boundingBox()
        assert(geometry.scroll.y >= summary.y + summary.height, 'expanded tags below summary')
        assert.equal(new Set(geometry.buttons.map(b => Math.round(b.y))).size, 1, 'one expanded row')
        assert(
            geometry.scroll.x >= geometry.header.x && geometry.scroll.right <= geometry.header.right + 1,
            'scroll viewport inside card'
        )
    }
    for (const badge of geometry.buttons) {
        assert(badge.width > 0 && badge.height > 0)
        assert(
            badge.y >= geometry.header.y && badge.bottom <= geometry.header.bottom + 1,
            'badge within card vertically'
        )
        assert(badge.bottom <= geometry.next.y + 1, 'no overlap with following task')
        if (!expanded)
            assert(badge.x >= geometry.header.x && badge.right <= geometry.header.right + 1, 'desktop bounds')
    }
    assert.equal(
        await page.getByText('31.10.2026', { exact: true }).count(),
        milestone ? 1 : 0,
        'milestone is separate, never duplicated'
    )
    return geometry
}

async function mobileCheck(page, width, query, count, milestone = true) {
    const summary = page.getByLabel('Tags', { exact: true })
    await summary.waitFor()
    await page.evaluate(() => document.fonts.ready)
    assert.equal(await summary.getAttribute('aria-expanded'), 'false')
    assert.equal((await summary.innerText()).match(/\d+$/)?.[0], String(count), 'count excludes milestone')
    const collapsed = await measure(page, 0, false, milestone)
    if (milestone) {
        const date = await page.getByText('31.10.2026', { exact: true }).boundingBox()
        const bounds = await summary.boundingBox()
        assert(
            Math.abs(date.y + date.height / 2 - bounds.y - bounds.height / 2) <= 1,
            'date and summary centered on first tag row'
        )
        assert(date.x >= collapsed.header.x && bounds.x + bounds.width <= collapsed.header.right + 1)
    }
    const name = `${width}-${query || 'normal'}`.replace(/[^a-z0-9-]/gi, '-')
    await page.screenshot({ path: path.join(output, `${name}-collapsed.png`) })
    if (query.includes('organize')) {
        results.push({ name, status: 'passed', collapsed })
        return
    }
    await summary.click()
    assert.equal(await summary.getAttribute('aria-expanded'), 'true')
    const expanded = await measure(page, count, true, milestone)
    assert(expanded.header.height > collapsed.header.height, 'card grows after expansion')
    assert.equal(await page.evaluate(() => window.__edits), 0, 'summary never edits goal')
    await page.screenshot({ path: path.join(output, `${name}-expanded.png`) })
    await summary.click()
    assert.equal(
        (await measure(page, 0, false, milestone)).header.height,
        collapsed.header.height,
        'collapse restores height'
    )
    results.push({ name, status: 'passed', collapsed, expanded })
}

async function main() {
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
                `harnessSetup=${path.join(__dirname, 'setup.js')}`,
                '--env',
                `harnessOut=${output}`,
            ],
            { cwd: root, stdio: 'inherit' }
        )
    const server = http.createServer((req, res) => {
        const pathname = req.url.split('?')[0]
        if (/^\/fonts\/(Roboto-(?:Regular|Medium|Bold)|alldone)\.ttf$/.test(pathname)) {
            res.setHeader('Content-Type', 'font/ttf')
            res.end(fs.readFileSync(path.join(root, 'assets', pathname)))
        } else if (pathname.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript')
            res.end(fs.readFileSync(path.join(output, path.basename(pathname))))
        } else {
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(
                `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${['Roboto-Regular', 'Roboto-Medium', 'Roboto-Bold', 'alldone'].map(f => `@font-face{font-family:'${f}';src:url('/fonts/${f}.ttf');}`).join('')}body{margin:0;background:#F8F7FF;font-family:'Roboto-Regular'}</style><title>AT-2744</title><script defer src="/harness.js"></script>`
            )
        }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let browser
    try {
        browser = await require(process.env.PLAYWRIGHT_MODULE || 'playwright').chromium.launch({
            args: ['--no-sandbox'],
        })
        const address = `http://127.0.0.1:${server.address().port}/`
        async function open(width, query = '') {
            const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width <= 818 })
            page.errors = []
            page.on('pageerror', e => page.errors.push(e.message))
            await page.route('**/*', r => (r.request().url().startsWith(address) ? r.continue() : r.abort()))
            await page.goto(address + '?' + query)
            return page
        }
        for (const width of process.argv.includes('--desktop-only')
            ? [900, 1024, 1280]
            : [320, 360, 375, 390, 430, 600, 818, 900, 1024, 1280]) {
            for (const long of width <= 430 || width >= 900 ? [false, true] : [false]) {
                const page = await open(width, long ? 'long=1' : '')
                if (width <= 818) await mobileCheck(page, width, long ? 'long' : '', long ? 12 : 4)
                else {
                    await page.getByText('Dynamisch', { exact: true }).waitFor()
                    await page.evaluate(() => document.fonts.ready)
                    const geometry = await measure(page, long ? 13 : 5)
                    const name = `${width}-${long ? 'long' : 'normal'}-desktop`
                    const png = await page.screenshot({ path: path.join(output, `${name}.png`) })
                    if (process.env.DESKTOP_BASELINE)
                        assert(
                            png.equals(fs.readFileSync(path.join(process.env.DESKTOP_BASELINE, `${name}.png`))),
                            'desktop pixel-identical to master'
                        )
                    results.push({ name, status: 'passed', geometry })
                }
                assert.deepEqual(page.errors, [], 'no runtime errors')
                await page.close()
            }
        }
        if (process.argv.includes('--desktop-only')) {
            console.log('PASS: 6 desktop baselines captured')
            return
        }
        for (const [query, count, milestone] of [
            ['reminder=1', 5, true],
            ['long=1&organize=1', 12, true],
            ['backlog=1', 4, false],
        ]) {
            const page = await open(320, query)
            await mobileCheck(page, 320, query, count, milestone)
            assert.deepEqual(page.errors, [])
            await page.close()
        }
        const page = await open(320, 'long=1&reminder=1')
        await page.getByLabel('Tags', { exact: true }).click()
        const close = async () => {
            await page.getByText('Close fixture popup', { exact: true }).click()
            await page.getByText('Close fixture popup', { exact: true }).waitFor({ state: 'hidden' })
        }
        await page.getByText('130', { exact: true }).click()
        assert.deepEqual(await page.evaluate(() => window.__navigation), ['/projects/p1/goals/g1/tasks/open'])
        await page.getByText('196', { exact: true }).click()
        assert((await page.evaluate(() => window.__actions)).some(a => a.type === 'Switch project'))
        await page.getByText('31.10.2026', { exact: true }).click()
        assert.equal((await page.evaluate(() => window.__actions)).filter(a => a.type === 'Switch project').length, 2)
        await page.getByText('Dynamisch', { exact: true }).click()
        await close()
        await page.getByRole('button', { name: /Fokusbereich:/ }).click()
        await close()
        const tags = page.locator('#social_tags_p1_g1 [tabindex="0"], #social_tags_p1_g1 button')
        for (let index = (await tags.count()) - 8; index < (await tags.count()); index++) {
            await tags.nth(index).click()
            await close()
        }
        await tags.nth((await tags.count()) - 9).click()
        await close()
        await page.getByText('90%', { exact: true }).click()
        await close()
        assert.equal(await page.evaluate(() => window.__edits), 0, 'badge clicks never edit goal')
        await page.getByText('Next Update:', { exact: false }).click()
        assert.equal(await page.evaluate(() => window.__edits), 1)
        results.push({ name: 'badge-actions-and-eight-avatars', status: 'passed' })
        await page.getByLabel('Tags', { exact: true }).click()
        await page.setViewportSize({ width: 1280, height: 900 })
        await page.getByText('Dynamisch', { exact: true }).waitFor()
        await measure(page, 14)
        await page.setViewportSize({ width: 375, height: 900 })
        await page.getByLabel('Tags', { exact: true }).waitFor()
        assert.equal(await page.getByLabel('Tags', { exact: true }).getAttribute('aria-expanded'), 'false')
        await measure(page, 0)
        results.push({ name: 'mounted-desktop-mobile-resize', status: 'passed' })
        assert.deepEqual(page.errors, [])
        fs.writeFileSync(
            path.join(output, 'results.json'),
            JSON.stringify({ results, passed: results.length }, null, 2)
        )
        console.log(
            `PASS: ${results.length} Playwright scenarios; collapse/expand, milestone, overflow, desktop, badge actions`
        )
    } finally {
        if (browser) await browser.close()
        await new Promise(resolve => server.close(resolve))
    }
}
main().catch(e => {
    console.error(e)
    process.exitCode = 1
})
