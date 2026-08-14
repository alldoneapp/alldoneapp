/**
 * AT-2257 browser-level regression test.
 *
 * "Search Popup: I should be able to press ESC on this popup (and all others) to
 *  close it again."
 *
 * The Escape branch in `GlobalSearchModal.onKeyDown` was written in 2021 and had
 * never run. react-native-web's TextInput calls `e.stopPropagation()` on every
 * keydown ("Prevent key events bubbling", upstream #612) and React 18 attaches
 * its synthetic listeners at the ROOT CONTAINER, so the native event is stopped
 * while it is still inside the app tree and never reaches the `document`
 * bubble-phase listener the modal registered. The search field is autofocused —
 * and re-focused on an interval by `SearchForm` — so this was the state of the
 * popup 100% of the time.
 *
 * Asserted, in real Chromium, against the real modal mounted the way the app
 * mounts it (gated on the real redux flag, so "closed" = actually unmounted):
 *
 *   1. Escape closes the popup while the search field has focus — the reported
 *      bug, and the case that fails on the unfixed build.
 *   2. Escape still closes it when focus is NOT in the field (the one case that
 *      already worked; it must not regress).
 *   3. Escape pressed after typing is not swallowed by the early-keystroke
 *      buffer, and closes rather than being appended as text.
 *   4. Nested: with the project picker open, the FIRST Escape closes only the
 *      picker and leaves the search popup up; the SECOND closes the popup. On the
 *      unfixed build the picker's `esc` hotkey and the modal's own listener both
 *      hang off `document` in the bubble phase, where `stopPropagation` cannot
 *      stop a sibling listener — so one keypress closed both (when it fired at
 *      all).
 *   5. The modal registry (`ModalsManager`) is left clean, so the next popup is
 *      not blocked by a ghost entry.
 *
 * Requirements (this does NOT run in CI's Jest jobs):
 *   nvm use 22
 *   (cd web-bundler && npm install)
 *   cp -R -f replacement_node_modules/* node_modules/
 *   npx playwright install chromium
 * Usage:
 *   node browser-tests/at2257/run.js
 */
const path = require('path')
const http = require('http')
const fs = require('fs')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const ENTRY = path.join(__dirname, 'harness.entry.js')

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>AT-2257</title>
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

// The popup unmounts on a redux dispatch; give React a couple of frames.
const SETTLE_MS = 300

async function openSearch(page) {
    await page.evaluate(() => window.__openSearch())
    await page.waitForFunction(() => window.__searchState().searchFieldVisible, null, { timeout: 5000 })
    // `SearchForm` retries focusing for 500ms after mount; wait it out so the
    // field is genuinely focused when the key is pressed.
    await page.waitForTimeout(700)
}

async function run(mobile) {
    const label = mobile ? 'mobile' : 'desktop'
    const server = await serve()
    const port = server.address().port
    const { chromium } = requirePlaywright()
    const browser = await chromium.launch()
    const page = await browser.newPage({
        viewport: mobile ? { width: 390, height: 664 } : { width: 1280, height: 900 },
    })

    const pageErrors = []
    page.on('pageerror', error => {
        if (error.message !== 'Event') pageErrors.push(process.env.HARNESS_DEBUG ? error.stack : error.message)
    })
    page.on(
        'console',
        message => process.env.HARNESS_DEBUG && console.log(`[console.${message.type()}] ${message.text()}`)
    )

    // The harness has no backend; Google's SDK scripts only add noise.
    await page.route('**://*.google*/**', route => route.abort())
    await page.goto(`http://127.0.0.1:${port}/?mobile=${mobile ? 1 : 0}`)
    await page.waitForFunction(() => window.__ready === true)

    // --- 1. the reported bug: Escape with the search field focused -----------
    await openSearch(page)
    const opened = await page.evaluate(() => window.__searchState())
    check(
        `${label}: search field has focus when the popup opens`,
        opened.focusedIsSearchField,
        `focused=${opened.focusedTag}`
    )
    await page.keyboard.press('Escape')
    await page.waitForTimeout(SETTLE_MS)
    let state = await page.evaluate(() => window.__searchState())
    check(`${label}: Escape closes the popup while the search field has focus`, !state.redux, JSON.stringify(state))
    check(`${label}: the modal registry is left clean`, !state.registry, `registry=${state.registry}`)

    // --- 2. focus outside the field must keep working ------------------------
    await openSearch(page)
    await page.evaluate(() => document.activeElement && document.activeElement.blur())
    await page.keyboard.press('Escape')
    await page.waitForTimeout(SETTLE_MS)
    state = await page.evaluate(() => window.__searchState())
    check(`${label}: Escape closes the popup with focus outside the field`, !state.redux, JSON.stringify(state))

    // --- 3. Escape must not be eaten by the early-keystroke buffer -----------
    await openSearch(page)
    await page.keyboard.type('inv')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(SETTLE_MS)
    state = await page.evaluate(() => window.__searchState())
    check(`${label}: Escape closes the popup after typing into the field`, !state.redux, JSON.stringify(state))

    // --- 4. nested: the picker closes first, the popup survives --------------
    await openSearch(page)
    await page.evaluate(() => window.__openPicker())
    await page.waitForTimeout(SETTLE_MS)
    check(
        `${label}: the project picker is open over the search popup`,
        await page.evaluate(() => window.__pickerOpen())
    )

    await page.keyboard.press('Escape')
    await page.waitForTimeout(SETTLE_MS)
    state = await page.evaluate(() => window.__searchState())
    const pickerStillOpen = await page.evaluate(() => window.__pickerOpen())
    check(
        `${label}: first Escape closes only the picker, the search popup stays open`,
        !pickerStillOpen && state.redux && state.searchFieldVisible,
        `picker=${pickerStillOpen} ${JSON.stringify(state)}`
    )

    await page.keyboard.press('Escape')
    await page.waitForTimeout(SETTLE_MS)
    state = await page.evaluate(() => window.__searchState())
    check(`${label}: second Escape closes the search popup`, !state.redux, JSON.stringify(state))

    if (pageErrors.length) console.log(`  (page errors: ${JSON.stringify(pageErrors.slice(0, 3))})`)

    await browser.close()
    server.close()
}

async function main() {
    build()
    await run(false)
    await run(true)

    console.log('')
    if (failures.length) {
        console.error(`${failures.length} case(s) failed:\n  - ${failures.join('\n  - ')}`)
        process.exit(1)
    }
    console.log('AT-2257: all cases passed.')
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
