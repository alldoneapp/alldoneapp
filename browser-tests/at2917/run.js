/**
 * AT-2917: a narrow Assistant Mode chat pane must never scroll sideways.
 *
 *   node browser-tests/at2917/run.js [--skip-build]
 *
 * Needs `web-bundler/node_modules` and Playwright with Chromium (set PLAYWRIGHT_MODULE to a
 * Playwright module path when it is installed elsewhere). For every chat width it checks:
 *   - `.anna-messages` has no horizontal scroll range, and a sideways trackpad swipe moves nothing;
 *   - no message/notice content ends outside the pane (so nothing is silently clipped either);
 *   - wide code and tables keep their OWN horizontal scrolling instead.
 */
const path = require('path')
const http = require('http')
const fs = require('fs')
const assert = require('assert/strict')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const WIDTHS = [340, 380, 420, 560, 720]

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>AT-2917</title>
<style>html,body,#root{margin:0;height:100%;width:100%;overflow:hidden}#root{display:flex}</style>
</head><body><div id="root"></div><script src="/harness.js"></script></body></html>`

if (!process.argv.includes('--skip-build')) {
    execFileSync(
        path.join(ROOT, 'web-bundler', 'node_modules', '.bin', 'webpack'),
        [
            '--config',
            path.join(ROOT, 'browser-tests', 'webpack.harness.js'),
            '--mode',
            'development',
            '--env',
            `harnessEntry=${path.join(__dirname, 'harness.entry.js')}`,
            '--env',
            `harnessOut=${BUILD_DIR}`,
        ],
        { cwd: path.join(ROOT, 'web-bundler'), stdio: 'inherit' }
    )
}
fs.writeFileSync(path.join(BUILD_DIR, 'index.html'), HTML)

const requirePlaywright = () => {
    if (process.env.PLAYWRIGHT_MODULE) return require(process.env.PLAYWRIGHT_MODULE)
    try {
        return require('playwright')
    } catch (_) {
        return require('/home/user/pw/node_modules/playwright')
    }
}

const serve = () =>
    new Promise(resolve => {
        const server = http.createServer((req, res) => {
            const url = req.url.split('?')[0]
            const file = path.join(BUILD_DIR, url === '/' ? 'index.html' : url)
            if (!file.startsWith(BUILD_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
                res.writeHead(404).end()
                return
            }
            res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : 'application/javascript')
            res.end(fs.readFileSync(file))
        })
        server.listen(0, '127.0.0.1', () => resolve(server))
    })

// Everything inside the log that ends outside the pane, skipping content of an element that
// scrolls on its own (a table scroller) — that one is meant to be wider than the pane.
const measure = () => {
    const log = document.querySelector('.anna-messages')
    const pane = log.getBoundingClientRect()
    const offenders = []
    const visit = node => {
        for (const child of node.children) {
            const rect = child.getBoundingClientRect()
            if (rect.width && (rect.right > pane.right + 0.5 || rect.left < pane.left - 0.5))
                offenders.push({
                    case: child.closest('[data-case]')?.dataset.case || child.className || child.tagName,
                    tag: child.tagName,
                    left: Math.round(rect.left - pane.left),
                    right: Math.round(rect.right - pane.left),
                })
            const style = getComputedStyle(child)
            if (child !== log && /(auto|scroll)/.test(style.overflowX)) continue
            visit(child)
        }
    }
    visit(log)
    const scrollers = Array.from(log.querySelectorAll('*')).filter(
        node => /(auto|scroll)/.test(getComputedStyle(node).overflowX) && node.scrollWidth > node.clientWidth + 1
    )
    // AT-2918: every activity chip stays inside its own row (not just the pane: a chip running
    // under the arrow/timestamp is the same bug), keeps its full text in the title, and a chip
    // too long for one line is ellipsised instead of wrapping or widening the row.
    const chips = Array.from(log.querySelectorAll('.anna-activity-action')).map(chip => {
        const row = chip.closest('.anna-activity-content').getBoundingClientRect()
        const rect = chip.getBoundingClientRect()
        return {
            text: chip.textContent.slice(0, 40),
            inside: rect.left >= row.left - 0.5 && rect.right <= row.right + 0.5,
            titled: chip.getAttribute('title') === chip.textContent,
            oneLine: rect.height <= 17,
            truncated: chip.scrollWidth > chip.clientWidth + 1,
            ellipsis: getComputedStyle(chip).textOverflow === 'ellipsis',
        }
    })
    return {
        chips,
        clientWidth: log.clientWidth,
        scrollWidth: log.scrollWidth,
        offenders: offenders.slice(0, 20),
        innerScrollers: scrollers.length,
    }
}

;(async () => {
    const server = await serve()
    const { chromium } = requirePlaywright()
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined })
    const failures = []
    try {
        for (const width of WIDTHS) {
            const page = await browser.newPage({ viewport: { width: Math.max(1024, width + 400), height: 900 } })
            const errors = []
            page.on('pageerror', error => errors.push(error.message))
            await page.goto(`http://127.0.0.1:${server.address().port}/?width=${width}`)
            await page.waitForSelector('[data-case="table"]')
            // CustomImage sizes itself after Image.getSize resolves.
            await page.waitForFunction(() => document.querySelector('[data-case="image"] img'), null, {
                timeout: 10000,
            })
            await page.waitForTimeout(400)
            await page.screenshot({ path: path.join(BUILD_DIR, `chat-${width}-before.png`) })
            const result = await page.evaluate(measure)
            const log = await page.locator('.anna-messages').boundingBox()
            await page.mouse.move(log.x + log.width / 2, log.y + log.height / 2)
            await page.mouse.wheel(400, 0)
            await page.waitForTimeout(150)
            const scrollLeft = await page.evaluate(() => document.querySelector('.anna-messages').scrollLeft)
            await page.screenshot({ path: path.join(BUILD_DIR, `chat-${width}-after-swipe.png`) })
            console.log(width, JSON.stringify({ ...result, scrollLeft, errors: errors.length }))
            try {
                assert.equal(errors.length, 0, `runtime errors: ${errors.join('; ')}`)
                assert.ok(result.scrollWidth <= result.clientWidth, `horizontal scroll range at ${width}px`)
                assert.equal(scrollLeft, 0, `sideways swipe moved the chat at ${width}px`)
                assert.deepEqual(result.offenders, [], `content outside the pane at ${width}px`)
                assert.ok(result.innerScrollers >= 1, `wide content lost its own scroller at ${width}px`)
                assert.ok(result.chips.length >= 4, `activity chips missing at ${width}px`)
                for (const chip of result.chips) {
                    assert.ok(chip.inside, `chip "${chip.text}" leaves its row at ${width}px`)
                    assert.ok(chip.titled, `chip "${chip.text}" lost its full text at ${width}px`)
                    assert.ok(chip.oneLine, `chip "${chip.text}" wraps at ${width}px`)
                    assert.ok(chip.ellipsis, `chip "${chip.text}" has no ellipsis at ${width}px`)
                }
                // ~650px of chip text: shortened in a narrow pane, whole where it fits (720px).
                if (width <= 560)
                    assert.ok(
                        result.chips.some(chip => chip.text.startsWith('Linked to goal') && chip.truncated),
                        `long goal chip was not shortened at ${width}px`
                    )
            } catch (error) {
                failures.push(error.message)
            }
            await page.close()
        }
    } finally {
        await browser.close()
        server.close()
    }
    if (failures.length) {
        console.error(`FAILED:\n- ${failures.join('\n- ')}`)
        process.exit(1)
    }
    console.log('AT-2917 narrow chat checks passed')
})()
