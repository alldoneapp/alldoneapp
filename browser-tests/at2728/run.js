const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const output = path.join(__dirname, '.build')
const reducedMotion = process.argv.includes('--animated') ? 'no-preference' : 'reduce'

async function checkHeader(card, button) {
    const header = await card.getByTestId('assistant-progress-header').boundingBox()
    const title = await card.getByTestId('assistant-progress-title').boundingBox()
    const actions = await card.getByTestId('assistant-progress-header-actions').boundingBox()
    const animation = await card.getByTestId('assistant-progress-animation').boundingBox()
    const target = await button.boundingBox()
    const outline = await button.getByTestId('stop-assistant-run-content').boundingBox()
    const trail = await card.getByTestId('assistant-progress-trail').boundingBox()
    if (!(await button.isDisabled())) {
        assert.equal(await button.evaluate(node => node.tabIndex), 0, 'Stop remains keyboard focusable')
    }
    assert(title.width > 100, 'German heading has visible glyphs and realistic font metrics')
    const labelWidth = await button.evaluate(node => {
        const range = document.createRange()
        range.selectNodeContents(node.querySelector('[data-testid="stop-assistant-run-content"]').lastElementChild)
        return range.getBoundingClientRect().width
    })
    assert(labelWidth > 20, 'Stop label is rendered with usable fonts')
    assert(target.height >= 44 && target.width >= 44, 'touch target is at least 44px')
    assert(outline.height === 28, 'visible Stop outline is compact')
    assert(target.x + target.width <= animation.x, 'Stop is immediately left of the animation')
    assert(Math.abs(target.y + target.height / 2 - animation.y - animation.height / 2) <= 1, 'controls aligned')
    assert(target.y >= header.y && target.y + target.height <= header.y + header.height, 'Stop is in header')
    assert(
        title.x + title.width <= actions.x || title.y + title.height <= actions.y,
        'title and controls do not overlap, including when the pending label wraps the header'
    )
    assert(header.y + header.height <= trail.y, 'header does not overlap activity steps')
    assert.equal(await card.getByTestId('assistant-progress-header').getByRole('button').count(), 1)
}

async function main() {
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
        const file = path.basename(req.url)
        if (file.endsWith('.ttf')) {
            res.setHeader('Content-Type', 'font/ttf')
            res.end(fs.readFileSync(path.join(root, 'assets/fonts', file)))
        } else if (file.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
            res.end(fs.readFileSync(path.join(output, file)))
        } else {
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(`<!doctype html><html lang="de"><head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width,initial-scale=1">
                <style>
                    @font-face{font-family:Roboto-Regular;src:url(/Roboto-Regular.ttf)}
                    @font-face{font-family:Roboto-Medium;src:url(/Roboto-Medium.ttf)}
                    @font-face{font-family:alldone;src:url(/alldone.ttf)}
                    body{margin:0}#root{max-width:680px;margin:24px auto}
                </style></head><body><div id="root"></div><script src="/harness.js"></script></body></html>`)
        }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let browser
    try {
        const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
        browser = await chromium.launch({
            args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
        })
        for (const width of [1280, 390, 320, 240]) {
            const page = await browser.newPage({ viewport: { width, height: 800 }, reducedMotion })
            page.setDefaultTimeout(10000)
            const errors = []
            page.on('pageerror', error => {
                errors.push(error.message)
                console.error(`Browser error: ${error.message}`)
            })
            await page.goto(`http://127.0.0.1:${server.address().port}`)
            await page.getByTestId('surface-light').getByRole('button', { name: 'Assistent stoppen' }).waitFor()
            await page.evaluate(() => document.fonts.ready)
            if (reducedMotion === 'no-preference') {
                await page.getByTestId('surface-dark').getByTestId('assistant-thinking-3d').locator('canvas').waitFor()
            }
            for (const appearance of ['light', 'dark']) {
                const surface = page.getByTestId(`surface-${appearance}`)
                const card = surface.getByTestId('assistant-progress')
                const button = card.getByRole('button', { name: 'Assistent stoppen' })
                assert.equal(await surface.getByRole('button').count(), 1)
                const bounds = await card.boundingBox()
                const target = await button.boundingBox()
                assert(target.height >= 44 && target.width >= 44, 'touch target is at least 44px')
                assert(target.x >= bounds.x && target.x + target.width <= bounds.x + bounds.width, 'button fits card')
                assert(target.y + target.height < bounds.y + bounds.height, 'button stays inside card')
                assert.equal(await card.getByTestId('assistant-progress-trail').getByRole('button').count(), 0)
                await checkHeader(card, button)
                for (const id of ['anna', 'carl', 'unknown']) {
                    const author = surface.getByTestId(`author-${appearance}-${id}`)
                    const header =
                        appearance === 'light'
                            ? author.locator('.anna-message-author')
                            : author.getByTestId('feed-comment-header')
                    const result = await header.evaluate(node => {
                        const avatar = node.firstElementChild
                        const name = node.children[1]
                        const image = avatar.querySelector('img') || avatar.querySelector('svg')
                        return {
                            name: name.textContent,
                            avatar: avatar.getBoundingClientRect().toJSON(),
                            label: name.getBoundingClientRect().toJSON(),
                            image: image?.getAttribute('src'),
                            fallback: !!avatar.querySelector('svg'),
                        }
                    })
                    assert.equal(
                        result.name,
                        id === 'anna'
                            ? 'Anna Alldone'
                            : id === 'carl'
                              ? 'Carl Code Mentor mit einem sehr langen Assistentennamen'
                              : 'Assistant'
                    )
                    assert(result.avatar.right <= result.label.x, 'avatar precedes name')
                    assert(
                        Math.abs(
                            result.avatar.y + result.avatar.height / 2 - result.label.y - result.label.height / 2
                        ) <= 1,
                        'avatar and name aligned'
                    )
                    assert.equal(result.avatar.width, appearance === 'light' ? 20 : 24)
                    if (id === 'unknown') assert(result.fallback, 'missing photo uses generic SVG')
                    else assert(result.image?.startsWith('data:image/svg+xml'), 'uses actual assistant photo data')
                    assert(result.label.right <= width, 'long names fit viewport')
                }
            }
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no overflow')
            await page.screenshot({ path: path.join(output, `loading-${width}-${reducedMotion}.png`), fullPage: true })
            // Test Enter in the chat and Space in the dark popup, with duplicate protection across both.
            const appearance = width === 390 ? 'dark' : 'light'
            const stop = page.getByTestId(`surface-${appearance}`).getByRole('button', { name: 'Assistent stoppen' })
            await stop.focus()
            await stop.press(width === 390 ? 'Space' : 'Enter')
            await page.waitForFunction(() => window.__cancelRequests?.length === 1)
            for (const surface of ['light', 'dark']) {
                const pending = page.getByTestId(`surface-${surface}`).getByRole('button', { name: 'Wird gestoppt…' })
                await pending.waitFor()
                assert(await pending.isDisabled())
                assert.equal(await pending.getAttribute('aria-busy'), 'true')
                const card = await page
                    .getByTestId(`surface-${surface}`)
                    .getByTestId('assistant-progress')
                    .boundingBox()
                const target = await pending.boundingBox()
                assert(target.x >= card.x && target.x + target.width <= card.x + card.width, 'pending label fits card')
                await checkHeader(page.getByTestId(`surface-${surface}`).getByTestId('assistant-progress'), pending)
            }
            assert(
                await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
                'no pending overflow'
            )
            await page.screenshot({ path: path.join(output, `stopping-${width}-${reducedMotion}.png`), fullPage: true })
            assert.deepEqual(await page.evaluate(() => window.__cancelRequests), [
                {
                    projectId: 'project-1',
                    objectType: 'tasks',
                    objectId: 'task-1',
                    commentId: 'comment-1',
                    runKind: 'chat',
                    runId: 'run-1',
                },
            ])
            assert.deepEqual(errors, [])
            console.log(
                `PASS ${width}px (${reducedMotion}): compact header Stop, no overlap, light/dark containment, keyboard stop and shared pending state`
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
