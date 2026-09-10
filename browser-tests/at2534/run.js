/**
 * AT-2534 browser-level regression: the general add-task row continuously replaces the final goal
 * section instead of appearing in one frame after the goal's graceful exit.
 *
 * Usage:
 *   node browser-tests/at2534/run.js
 *   node browser-tests/at2534/run.js --reduce-motion
 */
const path = require('path')
const http = require('http')
const fs = require('fs')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const ENTRY = path.join(__dirname, 'harness.entry.js')
const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>AT-2534</title>
<style>html,body,#root{margin:0;padding:0;box-sizing:border-box;background:#fff}</style></head>
<body><div id="root"></div><script src="/harness.js"></script></body></html>`

function build() {
    const webpackBin = path.join(ROOT, 'web-bundler', 'node_modules', '.bin', 'webpack')
    if (!fs.existsSync(webpackBin)) throw new Error('web-bundler dependencies are missing')
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
    const server = http.createServer((request, response) => {
        const url = request.url === '/' ? '/index.html' : request.url.split('?')[0]
        const file = path.join(BUILD_DIR, url)
        if (!fs.existsSync(file)) {
            response.writeHead(404)
            return response.end('not found')
        }
        response.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'application/javascript' : 'text/html' })
        response.end(fs.readFileSync(file))
    })
    return new Promise(resolve => server.listen(0, () => resolve(server)))
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const checks = []
const check = (name, ok, detail) => {
    checks.push({ name, ok })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
    const reduceMotion = process.argv.includes('--reduce-motion')
    build()
    const server = await serve()
    const { chromium } = require('playwright')
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    const page = await browser.newPage({
        viewport: { width: 820, height: 600 },
        reducedMotion: reduceMotion ? 'reduce' : 'no-preference',
    })
    page.on('pageerror', error => console.log('PAGE ERROR:', error.message))
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    await page.waitForFunction('window.__ready === true')
    await sleep(150)

    const before = await page.evaluate(() => window.__measure())
    check('the general row is absent before completion', !before.entryPresent)

    await page.evaluate(() => window.__completeAndDrop())
    await sleep(30)
    const first = await page.evaluate(() => window.__measure())

    if (reduceMotion) {
        check('reduced motion drops the goal immediately', !first.goalPresent)
        check(
            'reduced motion shows the settled general row immediately',
            first.entryPresent && first.entryHeight >= 40 && first.entryOpacity === 1,
            `height=${first.entryHeight} opacity=${first.entryOpacity}`
        )
    } else {
        check('the departing goal is held for its exit', first.goalPresent)
        check(
            'the replacement is mounted invisibly instead of popping into the layout',
            first.entryPresent && first.entryHeight <= 1 && first.entryOpacity <= 0.01,
            `height=${first.entryHeight} opacity=${first.entryOpacity}`
        )

        const frames = []
        for (let elapsed = 0; elapsed <= 1520; elapsed += 50) {
            frames.push({ elapsed, ...(await page.evaluate(() => window.__measure())) })
            await sleep(50)
        }

        const entryHeights = frames.filter(frame => frame.entryPresent).map(frame => frame.entryHeight)
        const entryOpacities = frames.filter(frame => frame.entryPresent).map(frame => frame.entryOpacity)
        const goalHeights = frames.filter(frame => frame.goalPresent).map(frame => frame.goalHeight)
        const belowTops = [before.belowTop, ...frames.map(frame => frame.belowTop)]
        const largestLayoutStep = Math.max(...belowTops.slice(1).map((top, index) => Math.abs(top - belowTops[index])))

        check(
            'the general row expands through intermediate heights',
            entryHeights.some(height => height > 3 && height < 39),
            `${Math.min(...entryHeights)}px → ${Math.max(...entryHeights)}px`
        )
        check(
            'the general row fades through intermediate opacity',
            entryOpacities.filter(opacity => opacity > 0.05 && opacity < 0.95).length >= 3,
            `${Math.min(...entryOpacities)} → ${Math.max(...entryOpacities)}`
        )
        check(
            'the goal collapses while its replacement opens',
            Math.max(...goalHeights) > 120 && Math.min(...goalHeights) < 20
        )
        check(
            'content below moves continuously rather than teleporting',
            largestLayoutStep < 18,
            `largest 50ms step=${largestLayoutStep}px`
        )

        await sleep(250)
        const settled = await page.evaluate(() => window.__measure())
        check('the goal is gone after its hold', !settled.goalPresent)
        check(
            'the general row finishes at its natural height and opacity',
            settled.entryHeight >= 40 && settled.entryOpacity === 1,
            `height=${settled.entryHeight} opacity=${settled.entryOpacity}`
        )
    }

    await browser.close()
    server.close()
    const failures = checks.filter(result => !result.ok)
    console.log(`\n${checks.length - failures.length}/${checks.length} checks passed`)
    process.exit(failures.length ? 1 : 0)
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
