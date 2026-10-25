/**
 * AT-2426 browser-level regression test.
 *
 * "On Tablet Sizes we should also show the 'Slow Connection' etc. chip below the
 *  header like on mobile .. otherwise it doesnt fit"
 *
 * The defect is a width, and jsdom has no layout — every box there is 0x0 — so "it
 * doesn't fit" is precisely the claim the Jest suites structurally cannot make. They pin
 * the DECISION (`connectionChipPlacement.test.js`, `TopBar.test.js`,
 * `MainViewsContainer.test.js`); this pins that the decision is the RIGHT one, by
 * measuring the real header in real Chromium.
 *
 * Why the header has no room, measured rather than assumed: the row is a non-wrapping
 * flex line in which nothing gives way (react-native-web's base `View` sets
 * `flexShrink: 0`; `NotificationArea` is a hard `width: 160`), and `XpBar`'s manual
 * `offSet` — the one elastic-looking element — is computed from `topBarWidth`, the
 * container's OWN width, which does not change when the chip appears inside it. So the
 * chip is never budgeted for.
 *
 * Every measurement is taken against a chip-ABSENT baseline at the same viewport (the
 * `live` state renders no chip at all), so what is asserted is the chip's own
 * contribution. That matters because the header has pre-existing geometry problems of its
 * own — at 820-834px the sidebar plus the desktop top bar already exceed the viewport,
 * with or without a chip — and this change must not be blamed for, or credited with,
 * those.
 *
 * Asserted at each viewport, for every non-live connection state, in every shipped
 * language:
 *
 *   1. the chip is in exactly ONE place — never duplicated, never missing.
 *   2. at tablet widths it is NOT in the header — this is the reported bug.
 *   3. showing it adds no spill past the header's padding edge and does not widen the
 *      document (AT-2177: the document must never become the scroller), except at the
 *      widths in `KNOWN_HEADER_OVERFLOW`, which are ratcheted in both directions.
 *   4. the stacked chip is fully inside the viewport, with a label and no clipping.
 *
 * Requirements (this does NOT run in CI's Jest jobs):
 *   nvm use 22
 *   (cd web-bundler && npm install)
 *   npx playwright install chromium
 *   cp -R replacement_node_modules/. node_modules/
 * Usage:
 *   node browser-tests/at2426/run.js
 */
const path = require('path')
const http = require('http')
const fs = require('fs')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const ENTRY = path.join(__dirname, 'harness.entry.js')

// Real device widths, in CSS px, spanning the bands the fix moves between.
// `stacked: true` means the chip must have left the header at that width.
const VIEWPORTS = [
    { name: 'iPad mini portrait', width: 768, stacked: true },
    { name: 'iPad 10.2 portrait', width: 810, stacked: true },
    { name: 'iPad Air portrait', width: 820, stacked: true },
    { name: 'iPad Pro 11 portrait', width: 834, stacked: true },
    { name: 'iPad Pro 12.9 landscape', width: 1024, stacked: true },
    { name: 'iPad Air landscape', width: 1180, stacked: true },
    { name: 'iPad Pro 11 landscape', width: 1194, stacked: true },
    { name: 'laptop', width: 1280, stacked: false },
    { name: 'wide desktop', width: 1440, stacked: false },
    { name: 'very wide desktop', width: 1920, stacked: false },
]

/**
 * Widths where the header still cannot hold the chip and AT-2426 deliberately does not
 * change that — the decision recorded on the task was to keep this MR to the tablet band
 * and report the rest.
 *
 * The cause is separate from anything this change touches: between roughly 1234px and
 * 1500px `smallScreen` has switched OFF, so the full-size XP bar and the wide pills are
 * back, while the horizontal margins stay at 104px a side. At 1280px that leaves the row
 * ~23px of slack against a ~150px (en) / ~183px (de) chip. Fixing it means making the
 * header itself give way, which is a design change, not a breakpoint.
 *
 * Listed rather than tolerated globally, and RATCHETED in both directions: an overflow at
 * an unlisted width fails the run, and a listed width that has stopped overflowing in
 * EVERY state and language also fails, so the list cannot quietly outlive the defect it
 * documents.
 *
 * Deliberately keyed on width alone. At 1440px whether the row spills depends on the
 * label — German "Langsame Verbindung" (182.7px) does, "Offline" (94.9px) does not — so
 * enumerating (width, language, state) triples would encode today's exact translations
 * and fail on any copy edit. The claim worth pinning is "this width is still broken for
 * some label", not which labels happen to break it.
 */
const KNOWN_HEADER_OVERFLOW_WIDTHS = [1280, 1440]

const HEALTHS = ['slow', 'reconnecting', 'stale', 'offline']

// The chip's label is translated, and at some widths the header's slack is single-digit
// pixels — so the shipped languages are part of the geometry. German is the widest
// ("Langsame Verbindung" against "Slow connection"), which is exactly the case an
// English-only measurement would call a comfortable fit.
const LANGUAGES = ['en', 'de', 'es']

// Sub-pixel differences are not an overflow.
const TOLERANCE_PX = 1

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>AT-2426</title>
<style>
  html, body, #root { margin:0; padding:0; height:100%; box-sizing:border-box; }
  body { display:flex; overflow-y:auto; }
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

const round = value => (value === null || value === undefined ? value : Math.round(value * 100) / 100)

async function measure(browser, port, { width, health, lang }) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const pageErrors = []
    const debug = !!process.env.HARNESS_DEBUG
    // The harness has no backend and boots on the placeholder .env, so Firestore's
    // offline transport reports a bare `Event` and auth rejects with an invalid key.
    // Both are noise that says nothing about the layout under test; anything else is a
    // real finding and fails the run.
    const isBackendNoise = message => message === 'Event' || /auth\/invalid-api-key/.test(message)
    page.on('pageerror', error => {
        const message = debug ? error.stack || error.message : error.message
        if (!isBackendNoise(error.message)) pageErrors.push(message)
    })
    page.on(
        'console',
        message => debug && console.log(`[${width}/${health}/${lang} console.${message.type()}] ${message.text()}`)
    )

    await page.route('**://*.google*/**', route => route.abort())
    await page.goto(`http://127.0.0.1:${port}/?health=${health}&lang=${lang}`)
    try {
        await page.waitForFunction(() => window.__ready === true && !!window.__measure && !!window.__measure())
    } catch (error) {
        console.error(`${width}px/${health}/${lang}: harness never became ready.`)
        console.error(`  page errors: ${JSON.stringify(pageErrors)}`)
        console.error(`  body: ${(await page.evaluate(() => document.body.innerHTML)).slice(0, 1500)}`)
        throw error
    }
    // Fonts change every width in this test; measuring before they land would compare
    // fallback metrics against Roboto's.
    await page.evaluate(() => document.fonts && document.fonts.ready)
    await page.waitForTimeout(120)

    const result = await page.evaluate(() => window.__measure())
    await page.close()
    if (pageErrors.length) throw new Error(`${width}px/${health}/${lang}: page errors: ${JSON.stringify(pageErrors)}`)
    return result
}

async function main() {
    fs.mkdirSync(BUILD_DIR, { recursive: true })
    build()
    const server = await serve()
    const port = server.address().port
    const { chromium } = requirePlaywright()
    const browser = await chromium.launch()

    const failures = []
    const knownGaps = []
    const stillBrokenWidths = new Set()
    const rows = []

    try {
        for (const viewport of VIEWPORTS) {
            // The chip renders NOTHING while the connection is live, which is the
            // overwhelming majority of the time. That is the honest baseline: this change
            // is about what the chip costs the header, and the header has pre-existing
            // geometry problems of its own at some widths (at 820-834px the sidebar plus
            // the desktop top bar already exceed the viewport, with or without a chip).
            // Comparing against `live` isolates the chip's contribution instead of
            // blaming this change for what was already there. Language cannot matter to
            // the baseline: there is no chip in it.
            const baseline = await measure(browser, port, { width: viewport.width, health: 'live', lang: 'en' })
            const baseLabel = `${viewport.name} ${viewport.width}px`

            if (baseline.chipInHeader || baseline.chipBelowHeader) {
                failures.push(`${baseLabel}/live: a live connection must render no chip at all`)
            }

            for (const health of HEALTHS) {
                for (const lang of LANGUAGES) {
                    const m = await measure(browser, port, { width: viewport.width, health, lang })
                    const label = `${baseLabel}/${health}/${lang}`
                    const fail = message => failures.push(`${label}: ${message}`)

                    // 1. exactly one placement — never duplicated, never missing.
                    const placements = (m.chipInHeader ? 1 : 0) + (m.chipBelowHeader ? 1 : 0)
                    if (placements !== 1) {
                        fail(
                            `chip should be in exactly one place, found ${placements} ` +
                                `(header=${m.chipInHeader}, below=${m.chipBelowHeader})`
                        )
                    }

                    // 2. the placement the breakpoint promises. This is the reported bug:
                    //    at every tablet width the chip must have left the header.
                    if (viewport.stacked && !m.chipBelowHeader) {
                        fail('chip is still pinned inside the header at a tablet width')
                    }

                    // 3. THE regression guard. Showing the chip must not push the header's
                    //    last area (search / chat / bell) any further past the row's padding
                    //    edge than it already was without a chip. Measured, not assumed from
                    //    a breakpoint — if the header ever gains or loses room, or a
                    //    translation grows, this is what notices.
                    const addedSpill = m.spillRight - baseline.spillRight
                    const widenedDocument = m.documentScrollWidth > baseline.documentScrollWidth + TOLERANCE_PX
                    const overflows = addedSpill > TOLERANCE_PX || widenedDocument
                    const known = KNOWN_HEADER_OVERFLOW_WIDTHS.includes(viewport.width)

                    if (overflows && !known) {
                        fail(
                            `showing the chip pushes the header's right area ${round(addedSpill)}px further ` +
                                `past its padding edge (spill ${round(baseline.spillRight)} -> ${round(m.spillRight)}), ` +
                                `document ${baseline.documentScrollWidth} -> ${m.documentScrollWidth}; ` +
                                `chip costs ${round(m.chipCost)}px, row slack without it ` +
                                `${round(baseline.headerSlack)}px`
                        )
                    }

                    if (overflows && known) {
                        stillBrokenWidths.add(viewport.width)
                        knownGaps.push(
                            `${label}: header spills ${round(m.spillRight)}px ` +
                                `(chip ${round(m.chipCost)}px vs ${round(baseline.headerSlack)}px slack)`
                        )
                    }

                    // 4. the stacked chip must be whole and on screen.
                    if (m.chipBelowHeader) {
                        const rect = m.stackedChipRect
                        if (rect.left < -TOLERANCE_PX || rect.right > m.viewportWidth + TOLERANCE_PX) {
                            fail(`stacked chip is outside the viewport: ${round(rect.left)}..${round(rect.right)}`)
                        }
                        if (rect.top < -TOLERANCE_PX) fail(`stacked chip is above the fold: top ${round(rect.top)}`)
                        if (!m.stackedLabel || !m.stackedLabel.trim()) fail('stacked chip rendered without a label')
                        // The pill must be wide enough to hold its own label — a clipped
                        // label is the failure mode this whole change exists to remove.
                        if (rect.width < 60) fail(`stacked chip looks collapsed: width ${round(rect.width)}`)
                    }

                    if (health === 'slow') {
                        rows.push({
                            viewport: `${viewport.name} (${viewport.width})`,
                            lang,
                            header: m.isMobileHeader ? 'mobile' : 'desktop',
                            placement: m.chipInHeader ? 'header' : m.chipBelowHeader ? 'below header' : 'MISSING',
                            chipCost: round(m.chipCost),
                            slackWithoutChip: round(baseline.headerSlack),
                            roomForChip: baseline.headerSlack >= m.chipCost - TOLERANCE_PX,
                            spillWithChip: round(m.spillRight),
                        })
                    }
                }
            }
        }
    } finally {
        await browser.close()
        server.close()
    }

    // The other half of the ratchet: a documented gap that has stopped happening at every
    // state and language must be deleted from the list, not left to rot into a blanket
    // exemption that hides the next regression at that width.
    KNOWN_HEADER_OVERFLOW_WIDTHS.filter(width => !stillBrokenWidths.has(width)).forEach(width =>
        failures.push(
            `${width}px is listed in KNOWN_HEADER_OVERFLOW_WIDTHS but no longer overflows in any ` +
                'state or language — remove it from the list'
        )
    )

    console.log('\n"Slow connection" — the longest of the four labels, i.e. the worst case:\n')
    console.table(rows)

    if (knownGaps.length) {
        console.log(
            `\nKNOWN GAPS (${knownGaps.length}) — pre-existing, out of scope for AT-2426.\n` +
                'The header is at its tightest between ~1234px and ~1500px: `smallScreen` has\n' +
                'switched off, so the full-size XP bar and wide pills are back while the margins\n' +
                'stay at 104px a side. Fixing it means making the header itself give way.\n'
        )
        knownGaps.forEach(gap => console.log(`  - ${gap}`))
    }

    if (failures.length) {
        console.error(`\nAT-2426 FAILED (${failures.length}):`)
        failures.forEach(failure => console.error(`  - ${failure}`))
        process.exit(1)
    }
    console.log(
        `\nAT-2426 passed: ${VIEWPORTS.length * HEALTHS.length * LANGUAGES.length} ` +
            `viewport/state/language combinations.`
    )
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
