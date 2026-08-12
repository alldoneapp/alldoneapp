/**
 * ModalShell / BottomSheet browser-level test (MODAL_IMPROVEMENT_PLAN.md,
 * Phase 2). See harness.entry.js for why this needs a real browser.
 *
 * Asserted in real Chromium:
 *   Mobile (390x664, touch):
 *   1. Tapping the trigger opens a full-width bottom sheet and locks the
 *      document scroller.
 *   2. AT-2236 mount grace: a backdrop tap right after opening does NOT close
 *      the sheet; a tap after the grace window does.
 *   3. AT-2257 composition: Escape closes the sheet while the sheet's own
 *      TextInput has focus (react-native-web swallows the keydown mid-tree;
 *      the capture-phase escape stack must still see it).
 *   4. Nesting: a tap INSIDE a nested sheet never dismisses the outer one
 *      (the EmailLabelChip bug class), and Escape pops LIFO — nested first,
 *      outer second.
 *   5. Closing unlocks the document scroller.
 *   Desktop (1280x900):
 *   6. The same trigger renders an anchored react-tiny-popover, no sheet, no
 *      scroll lock.
 *
 * Requirements (this does NOT run in CI's Jest jobs):
 *   nvm use 22
 *   (cd web-bundler && npm install)
 *   cp -R -f replacement_node_modules/* node_modules/
 *   npx playwright install chromium
 * Usage:
 *   node browser-tests/modalsheet/run.js
 */
const path = require('path')
const http = require('http')
const fs = require('fs')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const ENTRY = path.join(__dirname, 'harness.entry.js')

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>modalsheet</title>
<style>
  html, body, #root { margin:0; padding:0; height:100%; box-sizing:border-box; }
  body { overflow-y:auto; }
</style></head>
<body><div id="root"></div><script src="/harness.js"></script></body></html>`

function build() {
    const webpackBin = path.join(ROOT, 'web-bundler', 'node_modules', '.bin', 'webpack')
    if (!fs.existsSync(webpackBin)) {
        throw new Error('web-bundler dependencies are missing. Run: (cd web-bundler && npm install)')
    }
    execFileSync(
        webpackBin,
        [
            '--config',
            path.join(ROOT, 'browser-tests', 'webpack.harness.js'),
            '--mode',
            'development',
            '--env',
            `harnessEntry=${ENTRY}`,
            '--env',
            `harnessOut=${BUILD_DIR}`,
        ],
        { cwd: path.join(ROOT, 'web-bundler'), stdio: 'inherit' }
    )
    fs.writeFileSync(path.join(BUILD_DIR, 'index.html'), HTML)
}

function serve() {
    const server = http.createServer((req, res) => {
        const url = req.url.split('?')[0]
        const file = path.join(BUILD_DIR, url === '/' ? 'index.html' : url)
        if (!file.startsWith(BUILD_DIR) || !fs.existsSync(file)) {
            res.writeHead(404)
            res.end('not found')
            return
        }
        res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : 'application/javascript' })
        res.end(fs.readFileSync(file))
    })
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)))
}

function requirePlaywright() {
    try {
        return require('playwright')
    } catch (error) {
        const fallback = path.join(process.env.PLAYWRIGHT_HOME || '/home/user/repro', 'node_modules', 'playwright')
        return require(fallback)
    }
}

const failures = []
const check = (name, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  — ${detail}`}`)
    if (!ok) failures.push(name)
}

const SETTLE_MS = 250
// popupDismissGuard's touch grace is 750ms; stay well past it.
const PAST_GRACE_MS = 1000

const state = page => page.evaluate(() => window.__state())

async function runMobile(server, chromium) {
    const browser = await chromium.launch()
    const context = await browser.newContext({ viewport: { width: 390, height: 664 }, hasTouch: true })
    const page = await context.newPage()
    const pageErrors = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    await page.waitForFunction(() => window.__ready === true)

    // --- 1. open: full width + scroll lock ---------------------------------
    await page.tap('[data-testid="open-outer"]')
    await page.waitForTimeout(SETTLE_MS)
    let s = await state(page)
    check('mobile: tapping the trigger opens the bottom sheet', s.outerOpen && s.sheets === 1, JSON.stringify(s))
    check(
        'mobile: the sheet is full width',
        s.sheetRect && s.sheetRect.width === 390 && s.sheetRect.left === 0,
        JSON.stringify(s.sheetRect)
    )
    check('mobile: the document scroller is locked while open', s.bodyOverflowY === 'hidden', s.bodyOverflowY)

    // --- 2. AT-2236 mount grace --------------------------------------------
    // Tap the backdrop area (top of the screen, above the sheet) immediately:
    // must be swallowed as a repeat of the opening tap.
    await page.touchscreen.tap(195, 40)
    await page.waitForTimeout(SETTLE_MS)
    s = await state(page)
    check('mobile: a backdrop tap within the mount grace does not close (AT-2236)', s.outerOpen, JSON.stringify(s))

    await page.waitForTimeout(PAST_GRACE_MS)
    await page.touchscreen.tap(195, 40)
    await page.waitForTimeout(SETTLE_MS)
    s = await state(page)
    check('mobile: a backdrop tap after the grace closes the sheet', !s.outerOpen && s.sheets === 0, JSON.stringify(s))
    check('mobile: closing unlocks the document scroller', s.bodyOverflowY !== 'hidden', s.bodyOverflowY)

    // --- 3. Escape with the sheet's input focused (AT-2257 composition) ----
    await page.evaluate(() => window.__openOuter())
    await page.waitForTimeout(PAST_GRACE_MS)
    await page.tap('[data-testid="sheet-input"]')
    await page.waitForTimeout(SETTLE_MS)
    s = await state(page)
    check('mobile: the sheet input has focus', s.focusedTag === 'INPUT', s.focusedTag)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(SETTLE_MS)
    s = await state(page)
    check('mobile: Escape closes the sheet while its input has focus', !s.outerOpen, JSON.stringify(s))

    // --- 3b. swipe-down on the handle dismisses; a short drag does not -----
    await page.evaluate(() => window.__openOuter())
    await page.waitForTimeout(PAST_GRACE_MS)
    const dragHandle = async distance => {
        const box = await page.locator('[data-testid="bottom-sheet-handle"]').boundingBox()
        const startX = box.x + box.width / 2
        const startY = box.y + box.height / 2
        await page.mouse.move(startX, startY)
        await page.mouse.down()
        for (let step = 1; step <= 6; step++) {
            await page.mouse.move(startX, startY + (distance * step) / 6)
            await page.waitForTimeout(16)
        }
        await page.mouse.up()
    }
    await dragHandle(30)
    await page.waitForTimeout(SETTLE_MS)
    s = await state(page)
    check('mobile: a short handle drag springs back and does not close', s.outerOpen, JSON.stringify(s))

    await dragHandle(160)
    await page.waitForTimeout(SETTLE_MS)
    s = await state(page)
    check('mobile: swiping the handle down dismisses the sheet', !s.outerOpen && s.sheets === 0, JSON.stringify(s))

    // --- 4. nesting: inner taps never dismiss the outer sheet, Escape pops LIFO
    await page.evaluate(() => window.__openOuter())
    await page.waitForTimeout(PAST_GRACE_MS)
    await page.tap('[data-testid="open-nested"]')
    await page.waitForTimeout(SETTLE_MS)
    s = await state(page)
    check('mobile: the nested sheet opens over the outer one', s.nestedOpen && s.sheets === 2, JSON.stringify(s))

    await page.waitForTimeout(PAST_GRACE_MS)
    await page.tap('[data-testid="nested-action"]')
    await page.waitForTimeout(SETTLE_MS)
    s = await state(page)
    check(
        'mobile: a tap inside the nested sheet dismisses neither sheet',
        s.outerOpen && s.nestedOpen && s.nestedActionCount === 1,
        JSON.stringify(s)
    )

    await page.keyboard.press('Escape')
    await page.waitForTimeout(SETTLE_MS)
    s = await state(page)
    check('mobile: first Escape closes only the nested sheet', s.outerOpen && !s.nestedOpen, JSON.stringify(s))

    await page.keyboard.press('Escape')
    await page.waitForTimeout(SETTLE_MS)
    s = await state(page)
    check('mobile: second Escape closes the outer sheet', !s.outerOpen && s.sheets === 0, JSON.stringify(s))

    if (pageErrors.length) console.log(`  (mobile page errors: ${JSON.stringify(pageErrors.slice(0, 3))})`)
    check('mobile: no page errors', pageErrors.length === 0)
    await browser.close()
}

async function runDesktop(server, chromium) {
    const browser = await chromium.launch()
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    const pageErrors = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    await page.waitForFunction(() => window.__ready === true)

    await page.click('[data-testid="open-outer"]')
    await page.waitForTimeout(SETTLE_MS)
    const s = await state(page)
    check(
        'desktop: the trigger opens an anchored popover, not a sheet',
        s.outerOpen && s.sheets === 0 && s.popoverContainers >= 1,
        JSON.stringify(s)
    )
    check('desktop: no scroll lock', s.bodyOverflowY !== 'hidden', s.bodyOverflowY)

    if (pageErrors.length) console.log(`  (desktop page errors: ${JSON.stringify(pageErrors.slice(0, 3))})`)
    check('desktop: no page errors', pageErrors.length === 0)
    await browser.close()
}

async function main() {
    build()
    const server = await serve()
    const { chromium } = requirePlaywright()
    await runMobile(server, chromium)
    await runDesktop(server, chromium)
    server.close()

    console.log('')
    if (failures.length) {
        console.error(`${failures.length} case(s) failed:\n  - ${failures.join('\n  - ')}`)
        process.exit(1)
    }
    console.log('modalsheet: all cases passed.')
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
