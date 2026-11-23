/**
 * AT-3123 browser-level test — the section name with its picker arrow sits centred in the mobile
 * card, for every section the picker offers, and stays on the left on desktop.
 *
 * With the "Anna on top" sidebar the card above the lists shows the section's name ("Aufgaben ▾")
 * instead of the tabs. On a phone it sat on the left of the light-blue card while the toggle below
 * was centred. This measures the real boxes in Chromium in every shipped language.
 *
 * Requirements (not part of CI's Jest jobs):
 *   nvm use 22
 *   (cd web-bundler && npm install)
 *   npx playwright install chromium
 * Usage:
 *   node browser-tests/at3123/run.js
 */
const path = require('path')
const http = require('http')
const fs = require('fs')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const ENTRY = path.join(__dirname, 'harness.entry.js')
const FONTS_DIR = path.join(ROOT, 'assets', 'fonts')

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>AT-3123 section title</title>
<style>
@font-face{font-family:'Roboto-Regular';src:url(/fonts/Roboto-Regular.ttf)}
@font-face{font-family:'Roboto-Medium';src:url(/fonts/Roboto-Medium.ttf)}
html,body,#root{margin:0;padding:0;box-sizing:border-box;background:#fff}
</style></head>
<body><div id="root"></div><script src="/harness.js"></script></body></html>`

// [viewport, width the app gives the card's host]: phones inside a project (16px view margin + 8px
// navigation padding a side), a tablet just under the mobile breakpoint, and a desktop.
const MOBILE_LAYOUTS = [
    { name: '320px phone', viewportWidth: 320, containerWidth: 272 },
    { name: '390px phone', viewportWidth: 390, containerWidth: 342 },
    { name: '430px phone', viewportWidth: 430, containerWidth: 382 },
    { name: '800px tablet', viewportWidth: 800, containerWidth: 752 },
]
const DESKTOP_LAYOUT = { name: '1440px desktop', viewportWidth: 1440, containerWidth: 1000 }
const SECTIONS = [
    'ROOT_TASKS',
    'ROOT_GOALS',
    'ROOT_NOTES',
    'ROOT_CONTACTS',
    'ROOT_CHATS',
    'ROOT_ARTIFACTS',
    'ROOT_WIKI',
]
const LANGUAGES = ['de', 'es', 'en']
const TOLERANCE = 1

function build() {
    const webpackBin = path.join(ROOT, 'web-bundler', 'node_modules', '.bin', 'webpack')
    if (!fs.existsSync(webpackBin)) throw new Error('web-bundler deps missing: (cd web-bundler && npm install)')
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
        { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=1400' } }
    )
    fs.writeFileSync(path.join(BUILD_DIR, 'index.html'), HTML)
}

function serve() {
    const server = http.createServer((req, res) => {
        const url = req.url === '/' ? '/index.html' : req.url.split('?')[0]
        const file = url.startsWith('/fonts/')
            ? path.join(FONTS_DIR, path.basename(url))
            : path.join(BUILD_DIR, path.normalize(url))
        if (!fs.existsSync(file)) {
            res.writeHead(404)
            return res.end('not found')
        }
        const type = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.ttf') ? 'font/ttf' : 'text/html'
        res.writeHead(200, { 'Content-Type': type })
        res.end(fs.readFileSync(file))
    })
    return new Promise(resolve => server.listen(0, () => resolve(server)))
}

const results = []
const check = (name, ok, detail) => {
    results.push({ name, ok })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}
const centre = rect => (rect.left + rect.right) / 2

async function main() {
    build()
    const server = await serve()
    const { chromium } = require('playwright')
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    const page = await browser.newPage({ viewport: { width: 1440, height: 400 } })
    page.on('pageerror', error => console.log('PAGE ERROR:', error.message))
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    await page.waitForFunction('window.__ready === true')

    for (const layout of MOBILE_LAYOUTS) {
        for (const language of LANGUAGES) {
            for (const sectionTab of SECTIONS) {
                const r = await page.evaluate(options => window.__measure(options), {
                    ...layout,
                    language,
                    sectionTab,
                })
                const offset = centre(r.title) - centre(r.card)
                const arrowInside =
                    r.arrow.left >= r.label.right - TOLERANCE && r.arrow.right <= r.title.right + TOLERANCE
                const toggleOffset = r.toggle ? centre(r.toggle) - centre(r.card) : NaN
                check(
                    `${layout.name} (${language}) ${sectionTab} — name and arrow centred`,
                    Math.abs(offset) <= TOLERANCE && arrowInside && !r.truncated && Math.abs(toggleOffset) <= TOLERANCE,
                    `"${r.text}" title ${r.title.left.toFixed(1)}–${r.title.right.toFixed(1)} in card ` +
                        `${r.card.left.toFixed(1)}–${r.card.right.toFixed(1)}, offset ${offset.toFixed(1)}px, ` +
                        `toggle offset ${toggleOffset.toFixed(1)}px`
                )
            }
        }
    }

    // Desktop keeps the name on the left of the card with the toggle on the right (like the tabs).
    for (const sectionTab of SECTIONS) {
        const r = await page.evaluate(options => window.__measure(options), {
            ...DESKTOP_LAYOUT,
            language: 'de',
            sectionTab,
        })
        const contentLeft = r.card.left + r.cardBorder + r.cardPadding
        check(
            `${DESKTOP_LAYOUT.name} ${sectionTab} — name stays on the left, toggle on the right`,
            Math.abs(r.title.left - contentLeft) <= TOLERANCE && r.toggle && r.toggle.left > r.title.right,
            `"${r.text}" title left ${r.title.left.toFixed(1)} (content left ${contentLeft.toFixed(1)})`
        )
    }

    await browser.close()
    server.close()
    const failed = results.filter(result => !result.ok)
    console.log(`\n${results.length - failed.length}/${results.length} passed`)
    process.exit(failed.length ? 1 : 0)
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
