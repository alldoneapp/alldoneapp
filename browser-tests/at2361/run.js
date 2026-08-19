/**
 * AT-2361 (+ AT-2368) browser-level regression test.
 *
 * "On mobile don't 'waste' so much space on the left side of the screen when you show the email
 *  comments." — and then, once it no longer did: "adjust the preview padding to a balanced
 * amount" (AT-2368), because 10px from the screen edge reads as flush rather than as part of the
 * row. The target is the list's own 16px margin: the width AT-2361 recovered, on the rhythm the
 * rest of the row already uses.
 *
 * A chat-list row indents its unread email comments three times over: the row's 48px avatar stack
 * plus its 16px gutter, then the preview's 2px thread rail with its padding, then a 36px hanging
 * indent that clears the per-message sender avatar — 116px in total, on a screen 390px wide. The
 * sender line, the subject, the body and the Email / Create task / Archive email / Unsubscribe
 * buttons then all wrap inside what is left.
 *
 * This cannot be asserted in Jest: jsdom has no layout engine, so a negative margin that exactly
 * cancels a sibling column measures the same as one that does not (see browser-tests/README.md).
 * The unit suites therefore pin the *style contract* (ChatItemUnreadMessages.test.js,
 * ChatItemUnreadMessage.compact.test.js); this pins the pixels the user actually sees.
 *
 * Asserted in real Chromium, on real `getBoundingClientRect()`, at a 390px phone viewport and at a
 * 1280px desktop viewport:
 *
 *   1. mobile: the email content starts MOBILE_INDENT_PX from the list's own left edge — neither
 *      nested inside the avatar column nor flush against the edge.
 *   2. mobile: the content column is at least MIN_MOBILE_CONTENT_RATIO of the list width.
 *   3. mobile: nothing overflows the list on either side — the negative margin must cancel the
 *      avatar column, not overshoot it, and must not widen the row to the right.
 *   4. mobile: the thread rail is still there (the messages must still read as one topic) and the
 *      avatars are still rendered (thread context is preserved, not deleted).
 *   5. desktop: every measurement is byte-identical to the pre-change layout.
 *
 * Requirements (this does NOT run in CI's Jest jobs):
 *   nvm use 22
 *   (cd web-bundler && npm install)
 *   npx playwright install chromium
 * Usage:
 *   node browser-tests/at2361/run.js
 *   SCREENSHOT_DIR=/tmp/shots node browser-tests/at2361/run.js   # also writes before/after PNGs
 */
const path = require('path')
const http = require('http')
const fs = require('fs')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const ENTRY = path.join(__dirname, 'harness.entry.js')

// What "does not waste space" has to mean in numbers: the preview must sit on the list's own 16px
// margin (rail + gutter), not in the 116px of nested indentation the report is about. AT-2368
// pinned this to an exact distance rather than an upper bound, because the failure mode has two
// sides - too much indentation wastes the screen, too little (the 10px this shipped with first)
// reads as flush against the edge and stops looking like part of the row above.
const MOBILE_INDENT_PX = 16
// Text metrics move a box by a fraction of a pixel; a real change to the gutter never does.
const MOBILE_INDENT_TOLERANCE_PX = 2
// Of the list's own width, how much the email text must be able to use.
const MIN_MOBILE_CONTENT_RATIO = 0.9
// Sub-pixel differences are text metrics, not layout.
const TOLERANCE_PX = 1

// The desktop layout must not move at all: this is a mobile-only change.
const DESKTOP_EXPECTED_INDENT_PX = 116

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>AT-2361</title>
<style>
  html, body, #root { margin:0; padding:0; height:100%; box-sizing:border-box; }
  body { display:flex; overflow-y:auto; background:#fff; font-family:Roboto,Arial,sans-serif; }
  #root { flex-shrink:0; flex-basis:auto; flex-grow:1; display:flex; flex:1; }
  * { flex-basis: auto !important; }
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

const round = value => Math.round(value * 100) / 100

/**
 * Everything measured in one page evaluation, so the numbers all come from the same layout pass.
 * Elements are found the way a user identifies them - the sender line, the words of an email, the
 * Archive button - rather than through markers added for the test.
 */
const measure = () =>
    // eslint-disable-next-line no-undef
    (() => {
        const column = document.getElementById('chat-list-column')
        const columnRect = column.getBoundingClientRect()
        // The list's own content edge: what every row is allowed to use.
        const left = columnRect.left + parseFloat(getComputedStyle(column).paddingLeft || '0')
        const right = columnRect.right - parseFloat(getComputedStyle(column).paddingRight || '0')

        const headers = Array.from(document.querySelectorAll('[data-testid="message-item-header"]'))
        // The body paragraph, identified by the first words of a comment. Only the element that
        // *begins* with them is the paragraph box: an inner run of the same text (the part after
        // the Gmail chip, say) starts mid-line and would measure the wrap position, not the indent.
        const textOwner = Array.from(document.querySelectorAll('div, span')).filter(node => {
            const text = (node.textContent || '').trim()
            if (!text.startsWith('Email from ')) return false
            return !Array.from(node.children).some(child => (child.textContent || '').trim().startsWith('Email from '))
        })
        const archiveButtons = Array.from(document.querySelectorAll('[aria-label="Archive email"]'))
        // The preview's thread rail: the only element with a left border in this subtree.
        const rails = Array.from(document.querySelectorAll('div')).filter(node => {
            const style = getComputedStyle(node)
            return parseFloat(style.borderLeftWidth || '0') >= 2 && node.querySelector('[data-testid]')
        })
        // react-native-web paints an `<Image>` as a background on a div, so avatars are counted by
        // the shape the app gives them (`borderRadius: 100`) rather than by tag name.
        const avatars = Array.from(document.querySelectorAll('div, img, svg')).filter(node => {
            const box = node.getBoundingClientRect()
            return parseFloat(getComputedStyle(node).borderTopLeftRadius || '0') >= 40 && box.width >= 20
        })

        const rect = node => {
            const box = node.getBoundingClientRect()
            return { left: box.left, right: box.right, width: box.width, height: box.height }
        }

        return {
            column: { left, right, width: right - left },
            headers: headers.map(rect),
            bodyText: textOwner.map(rect),
            archiveButtons: archiveButtons.map(rect),
            rails: rails.map(node => ({ ...rect(node), border: parseFloat(getComputedStyle(node).borderLeftWidth) })),
            avatarCount: avatars.length,
            // Would the user see a horizontal scrollbar?
            documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }
    })()

async function sample(port, browser, { name, viewport, mobile }) {
    const page = await browser.newPage({ viewport })
    const errors = []
    // The harness has no backend and no secrets: Firestore's offline transport reports a bare
    // `Event`, and `initFirebase` rejects the placeholder API key. Neither says anything about the
    // layout under test; anything else is a real finding and fails the run.
    const BACKENDLESS_NOISE = [/^Event$/, /auth\/invalid-api-key/]
    page.on('pageerror', error => {
        if (!BACKENDLESS_NOISE.some(pattern => pattern.test(error.message))) errors.push(error.message)
    })
    await page.route('**://*.google*/**', route => route.abort())
    const debug = !!process.env.HARNESS_DEBUG
    page.on('console', message => debug && console.log(`[${name} console.${message.type()}] ${message.text()}`))
    await page.goto(`http://127.0.0.1:${port}/?mobile=${mobile ? 1 : 0}`)
    await page.waitForFunction(() => window.__ready === true)
    try {
        await page.waitForSelector('[data-testid="message-item-header"]')
    } catch (error) {
        console.error(`${name}: the preview never rendered.`)
        console.error(`  page errors: ${JSON.stringify(errors)}`)
        console.error(`  body: ${(await page.evaluate(() => document.body.innerHTML)).slice(0, 3000)}`)
        throw error
    }
    await page.waitForTimeout(200)

    const measured = await page.evaluate(measure)

    if (process.env.SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true })
        await page.screenshot({
            path: path.join(process.env.SCREENSHOT_DIR, `at2361-${name}.png`),
            fullPage: true,
        })
    }

    await page.close()
    if (errors.length) throw new Error(`${name}: page errors: ${JSON.stringify(errors)}`)
    return measured
}

const failures = []
const check = (condition, message) => {
    console.log(`${condition ? '  ok  ' : ' FAIL '} ${message}`)
    if (!condition) failures.push(message)
}

async function main() {
    build()
    const server = await serve()
    const port = server.address().port
    const { chromium } = requirePlaywright()
    const browser = await chromium.launch()

    try {
        const mobile = await sample(port, browser, {
            name: 'mobile',
            viewport: { width: 390, height: 844 },
            mobile: true,
        })
        const desktop = await sample(port, browser, {
            name: 'desktop',
            viewport: { width: 1280, height: 900 },
            mobile: false,
        })

        for (const [label, measured, isMobile] of [
            ['mobile', mobile, true],
            ['desktop', desktop, false],
        ]) {
            const indent = Math.min(...measured.bodyText.map(box => box.left)) - measured.column.left
            const headerIndent = Math.min(...measured.headers.map(box => box.left)) - measured.column.left
            const contentWidth = measured.column.right - Math.min(...measured.bodyText.map(box => box.left))
            console.log(
                `\n[${label}] list width ${round(measured.column.width)}px | body indent ${round(indent)}px | ` +
                    `sender-line indent ${round(headerIndent)}px | usable width ${round(contentWidth)}px ` +
                    `(${Math.round((contentWidth / measured.column.width) * 100)}%)`
            )

            check(measured.bodyText.length >= 1, `${label}: the email body rendered`)
            check(measured.archiveButtons.length >= 1, `${label}: the email action row rendered`)

            if (isMobile) {
                check(
                    Math.abs(indent - MOBILE_INDENT_PX) <= MOBILE_INDENT_TOLERANCE_PX,
                    `${label}: body starts ${round(indent)}px from the list edge ` +
                        `(expected ${MOBILE_INDENT_PX} ±${MOBILE_INDENT_TOLERANCE_PX})`
                )
                check(
                    contentWidth / measured.column.width >= MIN_MOBILE_CONTENT_RATIO,
                    `${label}: body gets ${Math.round((contentWidth / measured.column.width) * 100)}% of the list ` +
                        `width (>= ${MIN_MOBILE_CONTENT_RATIO * 100}%)`
                )
                // The negative margin must cancel the avatar column, never overshoot it: content
                // left of the list edge would be clipped by the page.
                check(indent >= -TOLERANCE_PX, `${label}: nothing spills past the left edge of the list`)
                check(
                    Math.max(...measured.bodyText.map(box => box.right)) <= measured.column.right + TOLERANCE_PX,
                    `${label}: nothing spills past the right edge of the list`
                )
                check(
                    Math.max(...measured.archiveButtons.map(box => box.right)) <= measured.column.right + TOLERANCE_PX,
                    `${label}: the action buttons stay inside the list`
                )
                check(measured.documentOverflow <= TOLERANCE_PX, `${label}: the page does not scroll horizontally`)
                // Hierarchy, the half of the request that is not about width.
                check(measured.rails.length >= 1, `${label}: the thread rail still groups the messages`)
                check(measured.avatarCount >= 2, `${label}: the avatars are still rendered`)
            } else {
                check(
                    Math.abs(indent - DESKTOP_EXPECTED_INDENT_PX) <= TOLERANCE_PX,
                    `${label}: layout unchanged - body indent is ${round(indent)}px ` +
                        `(expected ${DESKTOP_EXPECTED_INDENT_PX})`
                )
            }
        }

        const mobileIndent = Math.min(...mobile.bodyText.map(box => box.left)) - mobile.column.left
        console.log(
            `\nRecovered ${round(DESKTOP_EXPECTED_INDENT_PX - mobileIndent)}px of horizontal space on a ` +
                `${round(mobile.column.width)}px wide list.`
        )
    } finally {
        await browser.close()
        server.close()
    }

    if (failures.length) {
        console.error(`\n${failures.length} check(s) failed:`)
        failures.forEach(message => console.error(`  - ${message}`))
        process.exit(1)
    }
    console.log('\nAll checks passed.')
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
