/**
 * AT-2867 browser-level check: the comment popup's project line, actually laid out.
 *
 * Asserts, at a desktop width and at a 320px phone width, with a short and a very long project
 * name, that the line sits above the task row, never wraps past one line, and never runs under
 * the popup's fixed expand/close buttons. Screenshots go to AT2867_SHOTS (default .build/).
 *
 * Requirements (not part of CI's Jest jobs):
 *   (cd web-bundler && npm install)
 *   cp -R -f replacement_node_modules/* node_modules/
 *   npx playwright install chromium
 * Usage:
 *   node browser-tests/at2867/run.js
 */
const path = require('path')
const http = require('http')
const fs = require('fs')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const SHOTS = process.env.AT2867_SHOTS || BUILD_DIR

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>AT-2867</title>
<style>html,body,#root{margin:0;padding:0;box-sizing:border-box;background:#fff}</style></head>
<body><div id="root"></div><script src="/harness.js"></script></body></html>`

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
            `harnessEntry=${path.join(__dirname, 'harness.entry.js')}`,
            '--env',
            `harnessOut=${BUILD_DIR}`,
            '--env',
            `harnessSetup=${path.join(__dirname, 'harness.setup.js')}`,
        ],
        { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=1400' } }
    )
    fs.writeFileSync(path.join(BUILD_DIR, 'index.html'), HTML)
}

function serve() {
    const server = http.createServer((req, res) => {
        const file = path.join(BUILD_DIR, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0])
        fs.readFile(file, (err, data) => {
            if (err) return res.writeHead(404).end()
            res.writeHead(200).end(data)
        })
    })
    return new Promise(resolve => server.listen(0, () => resolve(server)))
}

async function main() {
    build()
    fs.mkdirSync(SHOTS, { recursive: true })
    const server = await serve()
    const { chromium } = require('playwright')
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    const failures = []
    let checks = 0
    const check = (ok, label) => {
        checks++
        console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`)
        if (!ok) failures.push(label)
    }

    try {
        for (const [viewport, width] of [
            ['desktop', 1280],
            ['phone', 320],
        ]) {
            for (const name of ['short', 'long']) {
                const page = await browser.newPage({ viewport: { width, height: 480 } })
                await page.goto(`http://localhost:${server.address().port}/?name=${name}`)
                const line = page.locator('[data-testid="comment-popup-project-line"]')
                await line.waitFor()
                const box = await line.boundingBox()
                const text = line.locator('div[dir]').last()
                const textBox = await text.boundingBox()
                const row = await page.locator('[data-testid="task-row"]').boundingBox()
                const buttons = await page.locator('[aria-label="social-text-block"]').first().boundingBox()
                const expand = await page.locator('[aria-label="open-chat"]').first().boundingBox()
                const label = `${viewport}/${name}`

                check(box.y + box.height <= row.y, `${label}: project line sits above the task row`)
                check(textBox.height <= 22, `${label}: project name stays on one line (${textBox.height}px)`)
                check(
                    textBox.x + textBox.width <= Math.min(expand.x, buttons.x),
                    `${label}: project name ends before the expand/close buttons`
                )
                const overflowing = await text.evaluate(el => el.scrollWidth > el.clientWidth)
                check(name === 'long' ? overflowing : !overflowing, `${label}: ellipsis only when the name is too long`)

                await page.screenshot({ path: path.join(SHOTS, `at2867-${label.replace('/', '-')}.png`) })
                await page.close()
            }
        }
    } finally {
        await browser.close()
        server.close()
    }

    console.log(`\n${checks - failures.length}/${checks} checks passed`)
    if (failures.length) process.exit(1)
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
