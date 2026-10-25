/**
 * Section tabs browser-level test — no root tab label may be cut off on a 320px phone.
 *
 * "Artefakte" / "Artefactos" took the Chats slot and are the longest labels in the row, so the
 * narrowest layout (a project on a 320px phone, 272px for the whole card) is the one to check, in
 * every shipped language and at every compact width up to the breakpoint. The fonts are the app's
 * own Roboto files, because a fallback font would measure a different row.
 *
 * Requirements (not part of CI's Jest jobs):
 *   nvm use 22
 *   (cd web-bundler && npm install)
 *   cp -R -f replacement_node_modules/* node_modules/
 * Usage:
 *   node browser-tests/section-tabs/run.js
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
<html><head><meta charset="utf-8"><title>Section tabs</title>
<style>
@font-face{font-family:'Roboto-Regular';src:url(/fonts/Roboto-Regular.ttf)}
@font-face{font-family:'Roboto-Medium';src:url(/fonts/Roboto-Medium.ttf)}
html,body,#root{margin:0;padding:0;box-sizing:border-box;background:#fff}
</style></head>
<body><div id="root"></div><script src="/harness.js"></script></body></html>`

// Widths the app gives the header on a phone: [viewport, container].
const LAYOUTS = [
    { name: 'project, 320px phone', viewportWidth: 320, containerWidth: 272 },
    { name: 'all projects, 320px phone', viewportWidth: 320, containerWidth: 288 },
    { name: 'project, 340px phone', viewportWidth: 340, containerWidth: 292 },
    { name: 'project, 359px phone', viewportWidth: 359, containerWidth: 311 },
    { name: 'project, 360px phone', viewportWidth: 360, containerWidth: 312 },
    { name: 'project, 375px phone', viewportWidth: 375, containerWidth: 327 },
    { name: 'project, 390px phone', viewportWidth: 390, containerWidth: 342 },
    { name: 'project, 419px phone', viewportWidth: 419, containerWidth: 371 },
]
const LANGUAGES = ['de', 'es', 'en']

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
    const page = await browser.newPage({ viewport: { width: 480, height: 300 } })
    page.on('pageerror', error => console.log('PAGE ERROR:', error.message))
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    await page.waitForFunction('window.__ready === true')

    for (const layout of LAYOUTS) {
        for (const language of LANGUAGES) {
            const result = await page.evaluate(options => window.__measure(options), { ...layout, language })
            const cut = result.labels.filter(label => label.truncated).map(label => label.text)
            const overflow = result.labels.some(label => label.right > result.hostWidth + 0.5)
            const gaps = result.labels.slice(1).map((label, index) => label.left - result.labels[index].right)
            check(
                `${layout.name} (${language}) — all five labels fit`,
                result.labels.length === 5 && cut.length === 0 && !overflow,
                `${result.labels.map(label => label.text).join(' · ')} @${result.labels[0]?.fontSize}px` +
                    `, smallest gap ${Math.min(...gaps).toFixed(1)}px${cut.length ? `, cut: ${cut.join(', ')}` : ''}`
            )
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
