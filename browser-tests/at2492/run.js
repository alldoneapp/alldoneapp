/**
 * AT-2492 browser-level test — "I don't see the animation on the project lines".
 *
 * Requirements (not part of CI's Jest jobs):
 *   nvm use 22
 *   (cd web-bundler && npm install)
 *   cp -R -f replacement_node_modules/* node_modules/
 *   npx playwright install chromium
 * Usage:
 *   node browser-tests/at2492/run.js
 */
const path = require('path')
const http = require('http')
const fs = require('fs')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const ENTRY = path.join(__dirname, 'harness.entry.js')

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>AT-2492</title>
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
        const file = path.join(BUILD_DIR, url)
        if (!fs.existsSync(file)) {
            res.writeHead(404)
            return res.end('not found')
        }
        const type = file.endsWith('.js') ? 'application/javascript' : 'text/html'
        res.writeHead(200, { 'Content-Type': type })
        res.end(fs.readFileSync(file))
    })
    return new Promise(resolve => server.listen(0, () => resolve(server)))
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail) => {
    results.push({ name, ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

async function main() {
    const reduceMotion = process.argv.includes('--reduce-motion')
    build()
    const server = await serve()
    const port = server.address().port
    const { chromium } = require('playwright')
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    const page = await browser.newPage({
        viewport: { width: 1000, height: 700 },
        reducedMotion: reduceMotion ? 'reduce' : 'no-preference',
    })
    page.on('pageerror', e => console.log('PAGE ERROR:', e.message))
    await page.goto(`http://127.0.0.1:${port}/`)
    await page.waitForFunction('window.__ready === true')
    // Let the reduce-motion preference resolve before anything is claimed.
    await sleep(150)

    console.log(`\n--- mode: ${reduceMotion ? 'prefers-reduced-motion: reduce' : 'normal motion'} ---\n`)

    // The live clearing: the project's today count drops from 1 to 0 while its line is shown.
    await page.evaluate(() => window.__setCount(0))
    await sleep(30)

    const runId = await page.evaluate(() => window.__runId)
    check('a cleared project starts a run', runId === 1, `runId=${runId}`)

    const frames = []
    for (let i = 0; i < 9; i++) {
        frames.push(await page.evaluate(() => window.__measure()))
        await sleep(100)
    }

    const present = frames.filter(f => f.present)
    check('the sweep overlay is mounted', present.length > 0, `${present.length}/9 frames`)

    if (present.length) {
        const widths = present.map(f => f.washWidth)
        console.log('    wash widths across the run:', widths.join(' → '))
        console.log('    overlay box:', JSON.stringify(present[0].overlay))
        console.log('    wash colour:', present[0].washColor, ' opacity:', present[0].washOpacity)
        console.log('    edge present per frame:', present.map(f => (f.edgePresent ? 'Y' : 'n')).join(''))
        console.log('    edge left offsets:', present.map(f => f.edgeLeft).join(' → '))

        const maxWidth = Math.max(...widths)
        check('the wash actually grows (animation advances)', maxWidth > 50, `max painted width ${maxWidth}px`)
        check(
            'the wash reaches most of the row',
            maxWidth > present[0].overlay.width * 0.7,
            `${maxWidth}px of ${Math.round(present[0].overlay.width)}px`
        )
        check(
            'the leading edge renders',
            present.some(f => f.edgePresent),
            ''
        )
        check('the overlay has real height', present[0].overlay.height > 10, `${present[0].overlay.height}px`)
    }

    // It must clean up: no coloured bar left behind.
    await sleep(600)
    const after = await page.evaluate(() => window.__measure())
    check('the sweep is gone once it settles', !after.present, '')

    /**
     * All Projects, the reported case. The board drops a cleared project's block, and the count
     * that proves it was cleared is delivered by a DIFFERENT Firestore listener — so it routinely
     * arrives after the row has already gone. Before the fix the run was refused for good.
     */
    if (!reduceMotion) {
        await page.reload()
        await page.waitForFunction('window.__ready === true')
        await sleep(150)
        await page.evaluate(() => {
            localStorage.clear()
            window.__setCount(1)
        })
        await sleep(30)
        // The board hides the project first, with the count still stale.
        await page.evaluate(() => window.__setLineWouldLeave(true))
        // Wait out the probe entirely, so the row is genuinely gone.
        await sleep(1200)
        const gone = await page.evaluate(() => window.__measure())
        check('All Projects: the row is dropped while the count is still stale', !gone.present, '')

        // Only now does the count listener report the clearing.
        await page.evaluate(() => window.__setCount(0))
        await sleep(120)
        const late = await page.evaluate(() => window.__measure())
        check(
            'All Projects: a late clearing still sweeps',
            late.present,
            `runId=${await page.evaluate(() => window.__runId)}`
        )
        if (late.present) {
            await sleep(400)
            const mid = await page.evaluate(() => window.__measure())
            check('All Projects: that sweep actually animates', mid.washWidth > 200, `${mid.washWidth}px`)
        }
        await sleep(1200)
        const settled = await page.evaluate(() => window.__measure())
        check('All Projects: the row leaves again once the sweep is over', !settled.present, '')
    }

    await browser.close()
    server.close()

    const failed = results.filter(r => !r.ok)
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
    process.exit(failed.length ? 1 : 0)
}

main().catch(e => {
    console.error(e)
    process.exit(1)
})
