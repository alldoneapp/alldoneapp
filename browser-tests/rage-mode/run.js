/**
 * Rage mode browser-level test: the REAL three.js raid over a stand-in page, in real Chromium.
 *
 * What it checks (none of it is observable from jest — no WebGL, no layout):
 *   1. The raid comes up: canvas, input layer and HUD; Anna takes off and the mission starts.
 *   2. The page slides away (a transform on #root) while generated ground is drawn above it.
 *   3. Auto-fire finds the task rows on the page, and the first wave arrives.
 *   4. NOTHING REACHES THE APP. Clicks over checkboxes and buttons, and key presses, while the raid
 *      is up must not reach the page's own handlers.
 *   5. Leaving slides the page back and removes every layer: the DOM is byte-identical to before
 *      and #root, <html> and <body> carry no leftover style.
 *   6. No page errors along the way.
 *   `--touch`  a phone: relative drag steering, the 💣 button, leaving through ✕.
 *   `--game`   boss → hangar (credits, Gold shop) → mission 2, and a game over → play again.
 *
 * Requirements (not part of CI's Jest jobs):
 *   nvm use 22
 *   (cd web-bundler && npm install)
 *   cp -R -f replacement_node_modules/* node_modules/
 *   npx playwright install chromium   (or PLAYWRIGHT_HOME=<dir with playwright installed>)
 * Usage:
 *   node browser-tests/rage-mode/run.js [--touch | --game] [--headed]
 *   node browser-tests/rage-mode/run.js --serve     # build, then serve it to play by hand
 */
const path = require('path')
const http = require('http')
const fs = require('fs')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const ENTRY = path.join(__dirname, 'harness.entry.js')
const args = new Set(process.argv.slice(2))

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Rage mode</title></head><body><script src="/harness.js"></script></body></html>`

const requirePlaywright = () => {
    try {
        return require('playwright')
    } catch (error) {
        if (!process.env.PLAYWRIGHT_HOME) throw error
        return require(path.join(process.env.PLAYWRIGHT_HOME, 'node_modules', 'playwright'))
    }
}

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

function serve(port = 0) {
    const server = http.createServer((req, res) => {
        const pathname = req.url.split('?')[0]
        const file = path.join(BUILD_DIR, pathname === '/' ? '/index.html' : pathname)
        if (!file.startsWith(BUILD_DIR) || !fs.existsSync(file)) {
            res.writeHead(404)
            return res.end('not found')
        }
        res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'application/javascript' : 'text/html' })
        res.end(fs.readFileSync(file))
    })
    return new Promise(resolve => server.listen(port, () => resolve(server)))
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail) => {
    results.push({ name, ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? `  — ${detail}` : ''}`)
}

const hudData = page =>
    page.evaluate(() => {
        const hud = document.querySelector('[data-rage-mode-layer="hud"]')
        return hud ? { ...hud.dataset } : {}
    })
const waitForHud = (page, predicate, arg, timeout = 15000) =>
    page
        .waitForFunction(
            ([source, value]) => {
                const hud = document.querySelector('[data-rage-mode-layer="hud"]')
                // eslint-disable-next-line no-new-func
                return !!hud && new Function('data', 'value', `return (${source})(data, value)`)(hud.dataset, value)
            },
            [predicate.toString(), arg],
            { timeout }
        )
        .then(() => true)
        .catch(() => false)
const openRaid = async (browser, url, query, options = {}) => {
    const context = await browser.newContext(options.context || { viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => message.type() === 'error' && errors.push(message.text()))
    await page.goto(`${url}?${options.keepProgress ? '' : 'fresh=1&'}${query}`)
    if (options.tap) await page.tap('#rage')
    else await page.click('#rage')
    return { context, page, errors }
}
const layerCount = page => page.evaluate(() => document.querySelectorAll('[data-rage-mode-layer]').length)
// Leaving runs on the arena's own clock, which a software-rendered test browser slows down: wait for
// it to finish rather than guessing how long it takes.
const waitForArenaGone = page =>
    page
        .waitForFunction(() => !document.querySelector('[data-rage-mode-layer]'), null, { timeout: 15000 })
        .catch(() => {})
const centreOf = (page, selector) =>
    page.evaluate(sel => {
        const r = document.querySelector(sel).getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, right: r.right, top: r.top }
    }, selector)
const pageRestored = page =>
    page.evaluate(() => ({
        intact: document.body.innerHTML === window.__rage.pageHtml,
        rootStyle: document.getElementById('root').getAttribute('style'),
        htmlStyle: document.documentElement.getAttribute('style'),
        bodyStyle: document.body.getAttribute('style'),
    }))
// The colour the raid canvas draws at a point, read in the same animation frame it was rendered in
// (a WebGL drawing buffer is cleared once composited).
const canvasPixel = (page, x, y) =>
    page.evaluate(
        ([px, py]) =>
            new Promise(resolve =>
                requestAnimationFrame(() => {
                    const source = document.querySelector('[data-rage-mode-layer="canvas"]')
                    const probe = document.createElement('canvas')
                    probe.width = source.width
                    probe.height = source.height
                    const context = probe.getContext('2d')
                    context.drawImage(source, 0, 0)
                    const scale = source.width / window.innerWidth
                    resolve(Array.from(context.getImageData(Math.round(px * scale), Math.round(py * scale), 1, 1).data))
                })
            ),
        [x, y]
    )

async function desktop(browser, url) {
    const { context, page, errors } = await openRaid(browser, url, 'god=1')
    check('raid layers are on the page', (await layerCount(page)) >= 5, await layerCount(page))
    // The run-up: she lands on the page and runs while it starts to move, slowly; nothing fires yet.
    check('Anna lands on the page and runs', await waitForHud(page, data => data.phase === 'runup'))
    const runStart = Number((await hudData(page)).pageOffset || 0)
    await sleep(900)
    const running = await hudData(page)
    check(
        'during the run-up the page moves slowly and she holds fire',
        running.phase !== 'runup' ||
            (Number(running.pageOffset) > runStart && Number(running.pageOffset) < 120 && running.shots === '0'),
        `${runStart} → ${running.pageOffset}, shots ${running.shots}`
    )
    check(
        'Anna takes off and mission 1 starts',
        await waitForHud(page, data => data.phase === 'flying' && data.mission === '1')
    )
    check('the task rows on screen become targets', await waitForHud(page, data => Number(data.pageTargets) >= 4))

    // Steer under the task list; the main gun fires on its own.
    const row = await centreOf(page, '#task_body_p_t1_false')
    await page.mouse.move(row.x, 680)
    check('the main gun fires on its own', await waitForHud(page, data => Number(data.shots) > 20))
    check(
        'shots knock task rows off the page',
        await waitForHud(page, data => Number(data.pageTargets) < 5, null, 12000)
    )

    const offset = await page.evaluate(() => document.getElementById('root').style.transform)
    check('the page slides down under the ground', /translate3d\(0px?, [1-9]\d*/.test(offset), offset)
    await waitForHud(page, data => Number(data.pageOffset) > 220, null, 20000)
    const sky = await canvasPixel(page, 40, 70)
    check('generated ground is drawn above the page', sky[3] === 255 && sky[1] > sky[2], sky.join(','))
    check('the first wave arrives', await waitForHud(page, data => Number(data.enemies) > 0, null, 12000))
    await page.screenshot({ path: path.join(BUILD_DIR, 'desktop-flying.png') })

    // Enter: the greeting loop towards the camera, without shooting, then back to work.
    await page.keyboard.press('Enter')
    check('Enter starts the greeting', await waitForHud(page, data => !!data.greeting))
    await page.screenshot({ path: path.join(BUILD_DIR, 'greeting.png') })
    check('the greeting ends and she flies on', await waitForHud(page, data => !data.greeting, null, 20000))

    // Nothing may reach the app: clicks where checkboxes and buttons are, and keys.
    const check0 = await centreOf(page, '#check-0')
    const primary = await centreOf(page, '#primary')
    await page.mouse.click(check0.x, check0.y)
    await page.mouse.click(primary.x, primary.y)
    await page.keyboard.press('x')
    await page.keyboard.press('Tab')
    const leaked = await page.evaluate(() => ({ clicks: window.__rage.appClicks, keys: window.__rage.appKeys }))
    check('no click and no key reaches the app', leaked.clicks === 0 && leaked.keys === 0, JSON.stringify(leaked))

    await page.keyboard.press('Escape')
    await waitForArenaGone(page)
    check('every layer is gone after Escape', (await layerCount(page)) === 0, await layerCount(page))
    const restored = await pageRestored(page)
    check('the page DOM is byte-identical afterwards', restored.intact)
    check(
        '#root, <html> and <body> carry no leftover style',
        restored.rootStyle === null && restored.htmlStyle === null && restored.bodyStyle === null,
        JSON.stringify(restored)
    )
    check('onExit was called', await page.evaluate(() => window.__rage.exited))
    await page.click('#primary')
    check('the app is clickable again', (await page.evaluate(() => window.__rage.appClicks)) === 1)
    check('no page errors (desktop)', errors.length === 0, errors.slice(0, 3).join(' | '))
    await context.close()
}

async function touch(browser, url) {
    const { context, page, errors } = await openRaid(browser, url, 'god=1', {
        tap: true,
        context: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
    })
    check('touch: raid layers are on the page', (await layerCount(page)) >= 5, await layerCount(page))
    check('touch: mission 1 starts', await waitForHud(page, data => data.phase === 'flying'))
    // A relative drag: wherever the finger starts, Anna moves by as much as it moves.
    await waitForHud(page, data => data.shipX !== undefined)
    const before = Number((await hudData(page)).shipX)
    const cdp = await context.newCDPSession(page)
    const touchPoint = (x, y) => [{ x, y, id: 1 }]
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touchPoint(300, 600) })
    for (let i = 1; i <= 8; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touchPoint(300 - i * 15, 600) })
        await sleep(30)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await sleep(200)
    const after = Number((await hudData(page)).shipX)
    check('touch: a drag steers Anna by the drag', after < before - 80, `${before} → ${after}`)
    await page.tap('[data-rage-mode-layer="bomb"]')
    check('touch: the 💣 button drops a bomb', await waitForHud(page, data => data.bombs === '1'))
    await page.screenshot({ path: path.join(BUILD_DIR, 'touch-flying.png') })
    await page.tap('[data-rage-mode-layer="hud"] button:last-child')
    await waitForArenaGone(page)
    check('touch: ✕ removes every layer', (await layerCount(page)) === 0, await layerCount(page))
    check('touch: the page is back as it was', (await pageRestored(page)).intact)
    check('touch: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    await context.close()
}

async function game(browser, url) {
    {
        const { context, page, errors } = await openRaid(browser, url, 'god=1&bossAt=2&noWaves=1&tasks=3&gold=1500')
        check('boss: arrives with today’s open-task count (3)', await waitForHud(page, data => data.boss === '3'))
        await page.screenshot({ path: path.join(BUILD_DIR, 'boss.png') })
        await page.keyboard.press('Space')
        check('boss: a mega bomb finishes it', await waitForHud(page, data => data.boss === '0'))
        check('boss: the hangar opens after the mission', await waitForHud(page, data => data.phase === 'hangar'))
        const credits = Number((await hudData(page)).credits)
        check('hangar: the mission paid credits', credits > 0, credits)
        await page.click('[data-hangar-item="bomb"] button')
        check(
            'hangar: buying a bomb costs credits',
            await waitForHud(page, (data, value) => data.bombs === '2' && Number(data.credits) === value - 180, credits)
        )
        await page.screenshot({ path: path.join(BUILD_DIR, 'hangar.png') })
        await page.click('[data-rage-mode-layer="hangar"] button:has-text("Special weapons")')
        check('hangar: the Gold weapon shop opens', await waitForHud(page, data => data.shop === 'open'))
        await page.click('[data-weapon="rocket"] button')
        await page.click('[data-weapon="rocket"] button:has-text("Buy for")')
        check('shop: buying a weapon goes to the server', await waitForHud(page, data => data.weapon === 'rocket'))
        check(
            'shop: the purchase was charged once',
            (await page.evaluate(() => window.__rage.calls.purchase)).join() === 'rocket'
        )
        await page.keyboard.press('Escape')
        check(
            'shop: Escape closes the shop, not the raid',
            await waitForHud(page, data => !data.shop && data.phase === 'hangar')
        )
        await page.click('[data-launch]')
        check(
            'hangar: mission 2 launches',
            await waitForHud(page, data => data.phase === 'flying' && data.mission === '2')
        )
        await page.mouse.move(640, 650)
        await sleep(2500)
        await page.screenshot({ path: path.join(BUILD_DIR, 'mission-2.png') })
        await page.keyboard.press('Escape')
        await waitForArenaGone(page)
        check('mission 2: leaving puts the page back', (await pageRestored(page)).intact)
        // The completed mission is remembered: the next raid takes off at mission 2.
        await page.goto(`${url}?god=1&noWaves=1`)
        await page.click('#rage')
        check(
            'progress: the next raid continues at mission 2',
            await waitForHud(page, data => data.phase === 'flying' && data.mission === '2' && data.saved === 'true')
        )
        await page.keyboard.press('Escape')
        await waitForArenaGone(page)
        // …on every device: with this browser's copy wiped, the server's copy still says mission 2.
        await page.goto(`${url}?god=1&noWaves=1&newDevice=1`)
        await page.click('#rage')
        check(
            'progress: another device continues at mission 2 too',
            await waitForHud(page, data => data.phase === 'flying' && data.mission === '2' && data.saved === 'true')
        )
        await page.click('[data-rage-mode-layer="hud"] [data-start-over]')
        await page.click('[data-rage-mode-layer="hud"] [data-start-over]')
        check(
            'progress: ↺ twice starts over at mission 1',
            await waitForHud(page, data => data.mission === '1' && data.saved === 'false')
        )
        await page.keyboard.press('Escape')
        await waitForArenaGone(page)
        // Another device: this browser's copy is gone, the server's copy is not.
        await page.goto(`${url}?god=1&noWaves=1&newDevice=1`)
        await page.click('#rage')
        check(
            'progress: another device starts at mission 1 after a start over',
            await waitForHud(page, data => data.phase === 'flying' && data.mission === '1')
        )
        await page.keyboard.press('Escape')
        await waitForArenaGone(page)
        check('boss/hangar: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
        await context.close()
    }
    {
        const { context, page, errors } = await openRaid(browser, url, 'shield=1&bossAt=1&noWaves=1&tasks=3&best=10')
        check(
            'game over: an empty shield ends the raid',
            await waitForHud(page, data => data.phase === 'gameover', null, 40000)
        )
        await page
            .waitForSelector('[data-rage-mode-layer="gameover"]', { state: 'visible', timeout: 5000 })
            .catch(() => {})
        const calls = await page.evaluate(() => window.__rage.calls.submitScore)
        check('game over: the score is submitted once', calls.length === 1, JSON.stringify(calls))
        await page.keyboard.press('Enter')
        check(
            'game over: Enter plays again from mission 1',
            await waitForHud(page, data => data.phase === 'flying' && data.mission === '1')
        )
        await page.keyboard.press('Escape')
        await waitForArenaGone(page)
        check('game over: leaving still puts the page back', (await pageRestored(page)).intact)
        check('game over: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
        await context.close()
    }
}

;(async () => {
    build()
    if (args.has('--serve')) {
        const server = await serve(Number(process.env.PORT) || 5178)
        console.log(`Rage mode harness: http://localhost:${server.address().port}/`)
        return
    }
    const server = await serve()
    const url = `http://localhost:${server.address().port}/`
    const { chromium } = requirePlaywright()
    const browser = await chromium.launch({
        headless: !args.has('--headed'),
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    })
    try {
        if (args.has('--touch')) await touch(browser, url)
        else if (args.has('--game')) await game(browser, url)
        else await desktop(browser, url)
    } catch (error) {
        check('harness ran to completion', false, error.message)
    }
    await browser.close()
    server.close()
    const failed = results.filter(r => !r.ok)
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
    process.exit(failed.length ? 1 : 0)
})()
