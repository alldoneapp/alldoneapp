const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const output = path.join(__dirname, '.build')
const baseline = process.argv.includes('--baseline')

async function measure(page, width, long, mobile, expectedBadges = long ? 13 : 5) {
    const geometry = await page.evaluate(() => {
        const header = document.getElementById('goal_container_p1_g1').getBoundingClientRect().toJSON()
        const tags = document.getElementById('social_tags_p1_g1')
        const buttons = [...tags.querySelectorAll('button, [tabindex="0"]')].map(node => ({
            label: node.textContent || node.getAttribute('aria-label'),
            ...node.getBoundingClientRect().toJSON(),
        }))
        return {
            header,
            buttons,
            next: document.getElementById('following-task').getBoundingClientRect().toJSON(),
            documentOverflows: document.documentElement.scrollWidth > window.innerWidth,
        }
    })
    console.log(
        `${width}px ${long ? 'long' : 'normal'}: header ${geometry.header.height}px; ${geometry.buttons.length} badges`
    )
    if (baseline) {
        console.log(
            `  left overflow: ${Math.max(0, geometry.header.x - Math.min(...geometry.buttons.map(badge => badge.x)))}px`
        )
        return geometry
    }
    assert.equal(geometry.buttons.length, expectedBadges, 'all badges stay visible without a summary toggle')
    assert(!geometry.documentOverflows, 'page must not scroll horizontally')
    for (const badge of geometry.buttons) {
        assert(badge.width > 0 && badge.height > 0, `${badge.label}: badge is visible`)
        assert(badge.x >= geometry.header.x, `${badge.label}: no overflow to the left`)
        assert(badge.right <= geometry.header.right + 1, `${badge.label}: no overflow to the right`)
        assert(badge.y >= geometry.header.y && badge.bottom <= geometry.header.bottom + 1, 'badge is inside header')
        assert(badge.bottom <= geometry.next.y + 1, 'following task must remain below the badges')
    }
    for (let i = 0; i < geometry.buttons.length; i++) {
        for (const other of geometry.buttons.slice(i + 1)) {
            const badge = geometry.buttons[i]
            assert(
                badge.right <= other.x + 1 ||
                    other.right <= badge.x + 1 ||
                    badge.bottom <= other.y + 1 ||
                    other.bottom <= badge.y + 1,
                'badges do not overlap each other'
            )
        }
    }
    if (mobile) {
        const title = await page.locator('#social_text_p1_g1').boundingBox()
        assert(
            geometry.buttons.every(badge => badge.y >= title.y + title.height),
            'mobile badges sit below title'
        )
        if (width <= 360 || long) {
            assert(new Set(geometry.buttons.map(badge => badge.y)).size > 1, 'narrow badges wrap into multiple lines')
        }
    }
    return geometry
}

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
                `harnessSetup=${path.join(__dirname, 'setup.js')}`,
                '--env',
                `harnessOut=${output}`,
            ],
            { cwd: root, stdio: 'inherit' }
        )
    }
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
            res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
                ${['Roboto-Regular', 'Roboto-Medium', 'Roboto-Bold', 'alldone'].map(font => `@font-face{font-family:'${font}';src:url('/fonts/${font}.ttf');}`).join('')}
                body{margin:0;background:#F8F7FF;font-family:'Roboto-Regular'}
            </style><title>AT-2744 mobile goal badges</title><script defer src="/harness.js"></script>`)
        }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let browser
    try {
        const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
        browser = await chromium.launch({ args: ['--no-sandbox'] })
        for (const width of [320, 360, 390, 430, 600, 818, 1280]) {
            for (const long of width <= 430 ? [false, true] : [false]) {
                const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width <= 818 })
                const errors = []
                page.on('pageerror', error => {
                    errors.push(error.message)
                    console.error(error.stack)
                })
                if (process.env.HARNESS_DEBUG) page.on('console', message => console.log(message.text().slice(0, 500)))
                await page.route('**/*', route =>
                    route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort()
                )
                await page.goto(`http://127.0.0.1:${server.address().port}/?${long ? 'long=1' : ''}`)
                await page.getByText('Dynamisch', { exact: true }).waitFor()
                await page.evaluate(() => document.fonts.ready)
                await page.waitForTimeout(150)
                const geometry = await measure(page, width, long, width <= 430)
                if (width === 390 || width === 1280) {
                    const name = `${width}-${long ? 'long' : 'normal'}-${baseline ? 'before' : 'after'}`
                    await page.screenshot({ path: path.join(output, `${name}.png`) })
                    fs.writeFileSync(path.join(output, `${name}.json`), JSON.stringify(geometry, null, 2))
                }
                if (!baseline && width === 390 && !long) {
                    // Real badge handlers and popup triggers must survive the flow change.
                    await page.getByText('130', { exact: true }).click()
                    assert.deepEqual(await page.evaluate(() => window.__navigation), [
                        '/projects/p1/goals/g1/tasks/open',
                    ])
                    await page.getByText('196', { exact: true }).click()
                    assert(
                        (await page.evaluate(() => window.__actions)).some(action => action.type === 'Switch project')
                    )
                    for (const label of ['Dynamisch', '90%']) {
                        await page.getByText(label, { exact: true }).click()
                        await page.getByText('Close fixture popup', { exact: true }).click()
                        await page.getByText('Close fixture popup', { exact: true }).waitFor({ state: 'hidden' })
                    }
                    const avatar = page.locator('#social_tags_p1_g1 [tabindex="0"]').last()
                    await avatar.click()
                    await page.getByText('Close fixture popup', { exact: true }).click()
                    await page.getByText('Close fixture popup', { exact: true }).waitFor({ state: 'hidden' })
                    await page.getByText('31.10.2026', { exact: true }).click()
                    await page.getByText('Next Update', { exact: true }).click()
                    assert.equal(
                        await page.evaluate(() => window.__edits),
                        1,
                        'badge clicks must not open goal editing'
                    )
                    // Same mounted row must switch between phone and desktop and back.
                    await page.setViewportSize({ width: 1280, height: 900 })
                    await page.waitForTimeout(150)
                    await measure(page, 1280, false, false)
                    await page.setViewportSize({ width: 320, height: 900 })
                    await page.waitForTimeout(150)
                    await measure(page, 320, false, true)
                }
                if (!baseline && width === 390 && long) {
                    await page.getByRole('button', { name: /Fokusbereich:/ }).click()
                    await page.getByText('Close fixture popup', { exact: true }).click()
                    await page.getByText('Close fixture popup', { exact: true }).waitFor({ state: 'hidden' })
                }
                if (!baseline && width === 320 && long) {
                    await page.goto(`http://127.0.0.1:${server.address().port}/?long=1&organize=1`)
                    await page.getByText('Dynamisch', { exact: true }).waitFor()
                    await page.evaluate(() => document.fonts.ready)
                    await measure(page, width, true, true)
                    await page.goto(`http://127.0.0.1:${server.address().port}/?reminder=1`)
                    await page.getByText('Dynamisch', { exact: true }).waitFor()
                    await page.evaluate(() => document.fonts.ready)
                    await measure(page, width, false, true, 6)
                    const date = page.locator('#social_tags_p1_g1 [tabindex="0"]').nth(3)
                    await date.click()
                    await page.getByText('Close fixture popup', { exact: true }).click()
                    await page.getByText('Close fixture popup', { exact: true }).waitFor({ state: 'hidden' })
                }
                assert.deepEqual(errors, [], 'no browser runtime errors')
                await page.close()
            }
        }
        console.log(
            baseline
                ? 'Baseline captured'
                : 'PASS: mobile bounds, wrapping, long labels, multiple assignees, desktop, resize and badge actions'
        )
    } finally {
        if (browser) await browser.close()
        await new Promise(resolve => server.close(resolve))
    }
}
main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
