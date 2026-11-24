/**
 * AT-3155 browser-level test — the icon before the section name in the "Anna on top" card.
 *
 * jsdom has no layout, so the jest suite pins which icon is rendered and its styles but not whether
 * it sits level with the name, keeps an even gap, keeps the name+arrow unit centred on a phone and
 * leaves the longest names uncut. This renders every section in light and dark mode, on a 320px and
 * a 390px phone and on desktop, in de/es/en, measures that, and writes screenshots to `.build/`.
 *
 * Requirements (not part of CI's Jest jobs): see browser-tests/README.md.
 * Usage:
 *   node browser-tests/at3155/run.js [screenshotDir]
 */
const path = require('path')
const http = require('http')
const fs = require('fs')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const ENTRY = path.join(__dirname, 'harness.entry.js')
const FONTS_DIR = path.join(ROOT, 'assets', 'fonts')
const SHOT_DIR = process.argv[2] ? path.resolve(process.argv[2]) : BUILD_DIR

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>AT-3155 section icons</title>
<style>
@font-face{font-family:'Roboto-Regular';src:url(/fonts/Roboto-Regular.ttf)}
@font-face{font-family:'Roboto-Medium';src:url(/fonts/Roboto-Medium.ttf)}
@font-face{font-family:'alldone';src:url(/fonts/alldone.ttf)}
html,body,#root{margin:0;padding:0;box-sizing:border-box}
</style></head>
<body><div id="root"></div><script src="/harness.js"></script></body></html>`

const LAYOUTS = [
    { name: 'phone 320', viewportWidth: 320, containerWidth: 272, mobile: true },
    { name: 'phone 390', viewportWidth: 390, containerWidth: 358, mobile: true },
    { name: 'desktop', viewportWidth: 1440, containerWidth: 900, mobile: false },
]
const LANGUAGES = ['de', 'es', 'en']
const MODES = ['light', 'dark']

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

async function main() {
    build()
    const server = await serve()
    const { chromium } = require('playwright')
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 }, deviceScaleFactor: 2 })
    page.on('pageerror', error => console.log('PAGE ERROR:', error.message))
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    await page.waitForFunction('window.__ready === true')
    fs.mkdirSync(SHOT_DIR, { recursive: true })

    for (const mode of MODES) {
        for (const layout of LAYOUTS) {
            for (const language of LANGUAGES) {
                const rows = await page.evaluate(options => window.__render(options), { ...layout, language, mode })
                const tag = `${layout.name}, ${mode}, ${language}`
                for (const row of rows) {
                    const offset = Math.abs(row.icon.cy - row.labelBox.cy)
                    const gap = row.labelBox.left - row.icon.right
                    const leftSpace = row.icon.left - row.card.left
                    const rightSpace = row.card.right - (row.arrow.left + 18)
                    const centred = !layout.mobile || Math.abs(leftSpace - rightSpace) <= 3
                    check(
                        `${tag} ${row.section}`,
                        offset <= 1.5 && gap >= 6 && gap <= 10 && !row.truncated && centred && row.icon.w > 0,
                        `"${row.label}" icon ${row.icon.w.toFixed(0)}px, centre offset ${offset.toFixed(1)}px, ` +
                            `gap ${gap.toFixed(1)}px${layout.mobile ? `, sides ${leftSpace.toFixed(0)}/${rightSpace.toFixed(0)}px` : ''}` +
                            `${row.truncated ? ', CUT' : ''}, icon ${row.iconColor}`
                    )
                }
                if (language === 'de' && layout.name !== 'phone 320') {
                    await page.screenshot({
                        path: path.join(SHOT_DIR, `${mode}-${layout.mobile ? 'mobile' : 'desktop'}.png`),
                        clip: {
                            x: 0,
                            y: 0,
                            width: layout.containerWidth + 32,
                            height: await page.evaluate(
                                () => document.getElementById('root').firstElementChild.getBoundingClientRect().height
                            ),
                        },
                    })
                }
            }
        }
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
