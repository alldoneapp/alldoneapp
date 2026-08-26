/**
 * AT-2438 browser-level regression test.
 *
 * "the buttons below the input field seem to not fit fully into the background ..
 *  background row has a wrong size"
 *
 * `ChatInputButtons` declares its action row as `{ flex: 1, height: 55 }`. In React
 * Native `flex: 1` means `flexGrow: 1, flexShrink: 1, flexBasis: 0%`, so the declared 55
 * is NOT the row's size — the row takes a share of whatever the composer card has, and
 * react-native-web's base `View` sets `min-height: 0`, which removes the content-based
 * floor that would otherwise stop it shrinking below the 40px buttons it contains. The
 * band then renders shorter than its own buttons and they hang out of it, which is what
 * the screenshot on the task shows.
 *
 * jsdom has no layout, so this claim cannot be made in Jest at all; the Jest suite next
 * to the component pins the STYLE contract, this pins that the browser agrees.
 *
 * Requirements (this does NOT run in CI's Jest jobs):
 *   nvm use 22
 *   (cd web-bundler && npm install)
 *   npx playwright install chromium
 *   cp -R replacement_node_modules/. node_modules/
 * Usage:
 *   node browser-tests/at2438/run.js
 */
const path = require('path')
const http = require('http')
const fs = require('fs')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const ENTRY = path.join(__dirname, 'harness.entry.js')

// The action row is chrome with a fixed height: 1px top border + 7px padding + a 40px
// button + 7px padding. These are the numbers in `ChatInputButtons`' own stylesheet.
const EXPECTED_ROW_HEIGHT = 55
const TOLERANCE_PX = 1

// Widths spanning the composer's responsive bands: phone, the 640px sheet breakpoint,
// tablet, and desktop.
const VIEWPORTS = [
    { name: 'phone', width: 390 },
    { name: 'large phone', width: 430 },
    { name: 'sheet breakpoint', width: 640 },
    { name: 'tablet portrait', width: 820 },
    { name: 'laptop', width: 1280 },
    { name: 'wide desktop', width: 1920 },
]

// The placeholder is translated, and the row holds translated button labels ("Clear",
// "Löschen", "Limpiar"), so the shipped languages are part of the geometry.
const LANGUAGES = ['en', 'de', 'es']

// How much text the composer holds. This is the axis the defect actually lived on: the
// row and the text area were BOTH `flex: 1`, so they split the card in half and the grey
// band grew line for line with the text (55 → 69 → 86 → 137px measured before the fix).
const CONTENT_LINES = [0, 1, 2, 3, 6]

// `createPlaceholder` emits six separators, so an encoded placeholder splits into seven
// fields — mirrored from `isEncodedPlaceholder` in textInputHelper rather than imported,
// since this script runs as plain CommonJS outside the app bundle.
const PLACEHOLDER_FIELD_COUNT = 7

// i18n/translations/<lang>.json, key "Type to add new comment".
const EXPECTED_PLACEHOLDER = {
    en: 'Type to add new comment',
    de: 'Trage hier einen neuen Kommentar ein',
    es: 'Escriba para agregar nuevo comentario',
}

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>AT-2438</title>
<style>
  html, body, #root { margin:0; padding:0; height:100%; box-sizing:border-box; }
  body { display:flex; overflow-y:auto; }
  #root { flex-shrink:0; flex-basis:auto; flex-grow:1; display:flex; flex:1; }
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
        return require(path.join(process.env.PLAYWRIGHT_HOME || '/home/user/repro', 'node_modules', 'playwright-core'))
    }
}

const round = value => (value === null || value === undefined ? value : Math.round(value * 100) / 100)

async function measure(browser, port, { width, lang, lines, lang2 }) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const pageErrors = []
    const debug = !!process.env.HARNESS_DEBUG
    // The harness has no backend and boots on the placeholder .env, so Firestore's
    // offline transport reports a bare `Event` and auth rejects with an invalid key.
    const isBackendNoise = message => message === 'Event' || /auth\/invalid-api-key/.test(message)
    page.on('pageerror', error => {
        const message = debug ? error.stack || error.message : error.message
        if (!isBackendNoise(error.message)) pageErrors.push(message)
    })
    page.on(
        'console',
        message => debug && console.log(`[${width}/${lang} console.${message.type()}] ${message.text()}`)
    )

    await page.route('**://*.google*/**', route => route.abort())
    await page.goto(`http://127.0.0.1:${port}/?lang=${lang}${lang2 ? `&lang2=${lang2}` : ''}`)
    try {
        await page.waitForFunction(() => window.__ready === true && !!window.__measure && !!window.__measure())
    } catch (error) {
        console.error(`${width}px/${lang}: harness never became ready.`)
        console.error(`  page errors: ${JSON.stringify(pageErrors)}`)
        console.error(`  body: ${(await page.evaluate(() => document.body.innerHTML)).slice(0, 2500)}`)
        throw error
    }
    if (lines > 0) {
        // Written straight into the editor rather than typed: what is under test is how
        // the card shares its height once the text area is taller than one line, and
        // synthesising keystrokes through Quill's autoformat pipeline would add a lot of
        // moving parts to a purely geometric question.
        await page.evaluate(count => {
            const editor = document.querySelector('.ql-editor')
            editor.innerHTML = Array.from({ length: count }, (_, i) => `<p>line ${i + 1}</p>`).join('')
            editor.classList.remove('ql-blank')
        }, lines)
    }
    await page.evaluate(() => document.fonts && document.fonts.ready)
    await page.waitForTimeout(200)

    const result = await page.evaluate(() => window.__measure())
    await page.close()
    if (pageErrors.length) throw new Error(`${width}px/${lang}: page errors: ${JSON.stringify(pageErrors)}`)
    return result
}

async function main() {
    build()
    const server = await serve()
    const port = server.address().port
    const { chromium } = requirePlaywright()
    const browser = await chromium.launch()
    const failures = []

    for (const viewport of VIEWPORTS) {
        for (const lang of LANGUAGES) {
            for (const lines of CONTENT_LINES) {
                const label = `${viewport.name} ${viewport.width}px/${lang}/${lines}L`
                const m = await measure(browser, port, { width: viewport.width, lang, lines })
                const rowHeight = round(m.row.height)
                const worstBelow = round(Math.max(...m.buttons.map(b => b.overflowBelowRow)))
                const worstAbove = round(Math.max(...m.buttons.map(b => b.overflowAboveRow)))
                const worstBelowCard = round(Math.max(...m.buttons.map(b => b.overflowBelowCard)))

                console.log(
                    `${label.padEnd(34)} row=${String(rowHeight).padStart(6)}  ` +
                        `card=${String(round(m.card.height)).padStart(6)}  ` +
                        `text=${String(round(m.textArea.height)).padStart(6)}  ` +
                        `spill(row)=${String(worstBelow).padStart(6)}  spill(card)=${String(worstBelowCard).padStart(6)}`
                )

                // 1. The action row is fixed chrome and must render at its declared height.
                if (Math.abs(rowHeight - EXPECTED_ROW_HEIGHT) > TOLERANCE_PX) {
                    failures.push(`${label}: action row is ${rowHeight}px, expected ${EXPECTED_ROW_HEIGHT}px`)
                }
                // 2. Every button must sit fully inside that row — the reported symptom.
                if (worstBelow > TOLERANCE_PX || worstAbove > TOLERANCE_PX) {
                    failures.push(
                        `${label}: a button spills out of the row (below=${worstBelow}px, above=${worstAbove}px)`
                    )
                }
                // 3. ...and therefore inside the composer card.
                if (worstBelowCard > TOLERANCE_PX) {
                    failures.push(`${label}: a button spills ${worstBelowCard}px past the card`)
                }
                // 4. The placeholder must never expose the app's encoded metadata (AT-2438,
                //    same task): `text#editorType#editorId#…`.
                if (m.placeholder && m.placeholder.split('#').length === PLACEHOLDER_FIELD_COUNT) {
                    failures.push(`${label}: placeholder still encoded: ${JSON.stringify(m.placeholder)}`)
                }
            }
        }
    }

    // The placeholder half of AT-2438, driven through its real production trigger rather
    // than through a synthetic prop change: the composer first renders against the DEVICE
    // locale and `useTranslator` switches it to the account language once the user doc
    // arrives. That is a plain `placeholder` prop change, and react-quill-new answers it by
    // writing the prop STRAIGHT into `root.dataset.placeholder` — which is the app's
    // encoded `text#editorType#editorId#…`, and which the CSS renders verbatim. Before the
    // fix this produced exactly the string on the task's screenshot.
    for (const [deviceLanguage, accountLanguage] of [
        ['de', 'en'],
        ['en', 'de'],
        ['es', 'en'],
    ]) {
        const label = `locale switch ${deviceLanguage}->${accountLanguage}`
        const m = await measure(browser, port, { width: 1280, lang: deviceLanguage, lines: 0, lang2: accountLanguage })
        console.log(`${label.padEnd(34)} placeholder=${JSON.stringify(m.placeholder)}`)

        if (m.placeholder && m.placeholder.split('#').length === PLACEHOLDER_FIELD_COUNT) {
            failures.push(`${label}: placeholder still encoded: ${JSON.stringify(m.placeholder)}`)
        }
        // The switch must still have taken effect — a fix that simply froze the first
        // placeholder would leave the user reading the wrong language.
        if (m.placeholder !== EXPECTED_PLACEHOLDER[accountLanguage]) {
            failures.push(
                `${label}: placeholder is ${JSON.stringify(m.placeholder)}, expected ` +
                    `${JSON.stringify(EXPECTED_PLACEHOLDER[accountLanguage])}`
            )
        }
        // ...and it must not have disturbed the row while doing so.
        if (Math.abs(round(m.row.height) - EXPECTED_ROW_HEIGHT) > TOLERANCE_PX) {
            failures.push(`${label}: action row is ${round(m.row.height)}px, expected ${EXPECTED_ROW_HEIGHT}px`)
        }
    }

    await browser.close()
    server.close()

    if (failures.length) {
        console.error('\nFAILURES:')
        failures.forEach(failure => console.error(`  - ${failure}`))
        process.exit(1)
    }
    console.log('\nAT-2438: OK')
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
