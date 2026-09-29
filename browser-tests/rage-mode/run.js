/**
 * Rage mode browser-level test: the REAL three.js arena over a stand-in page, in real Chromium.
 *
 * What it checks (none of it is observable from jest — no WebGL, no layout, no caret hit testing):
 *   1. The arena comes up: its canvas, input layer and HUD are on the page.
 *   2. Bolts find letters through the input layer: shooting at a paragraph destroys characters.
 *   3. Bolts find images: shooting the picture shatters it.
 *   4. NOTHING REACHES THE APP. A click over a task checkbox or a button, and a key press, while the
 *      arena is up must not reach the page's own handlers — "shooting never changes data" rests on it.
 *   5. Leaving rewinds everything: every arena layer is removed and the page's DOM is byte-identical
 *      to before (the arena never mutates it).
 *   6. No page errors along the way.
 *   `--touch` repeats 1, 2, 5 and 6 on a phone-sized touch viewport, leaving through the ✕ button.
 *
 * Requirements (not part of CI's Jest jobs):
 *   nvm use 22
 *   (cd web-bundler && npm install)
 *   cp -R -f replacement_node_modules/* node_modules/
 *   npx playwright install chromium   (or PLAYWRIGHT_HOME=<dir with playwright installed>)
 * Usage:
 *   node browser-tests/rage-mode/run.js [--touch] [--headed]
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
const destroyedCount = async page => Number((await hudData(page)).destroyed || 0)
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
const holdFire = async (page, target, ms) => {
    await page.mouse.move(target.x, target.y)
    await page.mouse.down()
    await sleep(ms)
    await page.mouse.up()
}
const openPage = async (browser, url, query) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => message.type() === 'error' && errors.push(message.text()))
    await page.goto(`${url}?${query}`)
    await page.click('#rage')
    await sleep(900)
    return { page, errors }
}
const layerCount = page => page.evaluate(() => document.querySelectorAll('[data-rage-mode-layer]').length)
// The rewind runs on the arena's own clock, which a software-rendered test browser slows down (more
// so at 2x density with snakes on screen): wait for it to finish rather than guessing how long it takes.
const waitForArenaGone = page =>
    page
        .waitForFunction(() => !document.querySelector('[data-rage-mode-layer]'), null, { timeout: 10000 })
        .catch(() => {})
const centreOf = (page, selector) =>
    page.evaluate(sel => {
        const r = document.querySelector(sel).getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, right: r.right, top: r.top }
    }, selector)

async function desktop(browser, url) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => message.type() === 'error' && errors.push(message.text()))
    await page.goto(`${url}?god=1`)
    await page.click('#rage')
    await sleep(900)
    check('arena layers are on the page', (await layerCount(page)) >= 4, await layerCount(page))

    // Sweep the paragraph with a held trigger.
    const paragraph = await centreOf(page, '#paragraph')
    await page.mouse.move(paragraph.left + 40, paragraph.y)
    await page.mouse.down()
    for (let i = 0; i <= 20; i++) {
        await page.mouse.move(paragraph.left + 40 + ((paragraph.right - paragraph.left - 80) * i) / 20, paragraph.y)
        await sleep(70)
    }
    await page.mouse.up()
    await sleep(300)
    const afterText = await destroyedCount(page)
    check('shooting the paragraph knocks letters out', afterText > 5, afterText)
    await page.screenshot({ path: path.join(BUILD_DIR, 'desktop-text.png') })

    // Fly towards the media row (hold D / S briefly), then shoot the picture.
    await page.keyboard.down('KeyS')
    await sleep(350)
    await page.keyboard.up('KeyS')
    const image = await centreOf(page, '#image')
    for (let i = 0; i < 8; i++) {
        await page.mouse.click(image.x, image.y)
        await sleep(140)
    }
    await sleep(500)
    const afterImage = await destroyedCount(page)
    check('shooting the picture shatters it', afterImage > afterText, `${afterText} → ${afterImage}`)

    // Task snakes: rows peel out and crawl; shooting one shrinks it until it bursts.
    const snakeState = () =>
        page.evaluate(() => {
            const hud = document.querySelector('[data-rage-mode-layer="hud"]')
            const layer = document.querySelector('[data-rage-mode-layer="input"]')
            return {
                alive: Number(hud.dataset.snakes || 0),
                hits: Number(hud.dataset.snakeHits || 0),
                killed: Number(hud.dataset.snakesKilled || 0),
                targets: layer.rageSnakeTargets ? layer.rageSnakeTargets() : [],
            }
        })
    await page.waitForFunction(
        () => Number(document.querySelector('[data-rage-mode-layer="hud"]').dataset.snakes || 0) >= 2,
        null,
        { timeout: 15000 }
    )
    check('task rows peel out as snakes, a few at a time', (await snakeState()).alive >= 2, (await snakeState()).alive)
    await page.screenshot({ path: path.join(BUILD_DIR, 'desktop-snakes.png') })
    // Aim a third of the way down a snake's body: the rest of it crawls through that point after.
    for (let round = 0; round < 60 && (await snakeState()).killed < 1; round++) {
        const { targets } = await snakeState()
        const body = targets.find(t => t.length) || []
        if (body.length) {
            const target = body[Math.floor(body.length / 3)]
            await page.mouse.move(target.x, target.y)
            await page.mouse.down()
            await sleep(180)
            await page.mouse.up()
        }
        await sleep(60)
    }
    const afterSnakes = await snakeState()
    check('shooting a snake shrinks it tile by tile', afterSnakes.hits >= 3, afterSnakes.hits)
    check('a snake bursts in the end', afterSnakes.killed >= 1, afterSnakes.killed)
    await page.screenshot({ path: path.join(BUILD_DIR, 'desktop-snake-hit.png') })

    // Enter: Anna loops towards the camera and greets; clicks during the greeting are not shots.
    const beforeGreeting = await destroyedCount(page)
    await page.keyboard.press('Enter')
    const greetingStyle = await page.getAttribute('[data-rage-mode-layer="hud"]', 'data-greeting')
    check('Enter starts a greeting', !!greetingStyle, greetingStyle)
    await sleep(1900)
    const paragraphNow = await centreOf(page, '#paragraph')
    await page.mouse.click(paragraphNow.x, paragraphNow.y)
    await sleep(150)
    await page.screenshot({ path: path.join(BUILD_DIR, 'desktop-greeting.png') })
    const duringGreeting = await destroyedCount(page)
    check('a greeting does not shoot', duringGreeting === beforeGreeting, `${beforeGreeting} → ${duringGreeting}`)
    // The arena runs on its own clock, which a software-rendered test browser slows down; wait for
    // the greeting to actually end instead of guessing its duration.
    await page.waitForFunction(
        () => !document.querySelector('[data-rage-mode-layer="hud"]').hasAttribute('data-greeting'),
        null,
        { timeout: 15000 }
    )
    // Hold the trigger on the heading, which nothing has hit yet: a single bolt can fly through a
    // hole the earlier sweep left in the paragraph and prove nothing.
    const heading = await centreOf(page, '#title')
    await page.mouse.move(heading.x, heading.y)
    await page.mouse.down()
    await sleep(700)
    await page.mouse.up()
    await sleep(400)
    const afterGreeting = await destroyedCount(page)
    check(
        'shooting works again after the greeting',
        afterGreeting > duringGreeting,
        `${duringGreeting} → ${afterGreeting}`
    )

    // Space toggles auto-fire: she keeps shooting at the cursor with no button held.
    const paragraphForAuto = await centreOf(page, '#paragraph')
    await page.mouse.move(paragraphForAuto.x + 120, paragraphForAuto.y)
    const beforeAuto = await destroyedCount(page)
    await page.keyboard.press('Space')
    const autoOn = (await hudData(page)).autoFire
    await sleep(1200)
    const duringAuto = await destroyedCount(page)
    check(
        'Space turns auto-fire on, and she shoots without a click',
        autoOn === 'on' && duringAuto > beforeAuto,
        `${autoOn}: ${beforeAuto} → ${duringAuto}`
    )
    await page.keyboard.press('Space')
    await sleep(500)
    const settled = await destroyedCount(page)
    await sleep(700)
    check(
        'Space again turns it off',
        (await hudData(page)).autoFire === 'off' && (await destroyedCount(page)) === settled,
        (await hudData(page)).autoFire
    )

    // The whole page: the wheel scrolls it, and flying into the bottom edge scrolls it too.
    const scrollTop = () => page.evaluate(() => document.scrollingElement.scrollTop)
    const beforeWheel = await scrollTop()
    await page.mouse.move(640, 400)
    await page.mouse.wheel(0, 240)
    await sleep(200)
    const afterWheel = await scrollTop()
    check('the wheel scrolls the page under the arena', afterWheel > beforeWheel, `${beforeWheel} → ${afterWheel}`)
    await page.mouse.wheel(0, -2000)
    await sleep(200)
    await page.keyboard.down('KeyS')
    await sleep(1600)
    await page.keyboard.up('KeyS')
    const afterEdge = await scrollTop()
    check('flying into the bottom edge scrolls the page', afterEdge > 0, afterEdge)
    await page.screenshot({ path: path.join(BUILD_DIR, 'desktop-scrolled.png') })
    await page.mouse.wheel(0, -2000)
    await sleep(200)

    // Nothing may reach the app.
    const checkbox = await centreOf(page, '#check-0')
    const button = await centreOf(page, '#primary')
    await page.mouse.click(checkbox.x, checkbox.y)
    await page.mouse.click(button.x, button.y)
    await page.keyboard.press('x')
    await page.keyboard.press('Enter')
    const reached = await page.evaluate(() => ({ clicks: window.__rage.appClicks, keys: window.__rage.appKeys }))
    check(
        'clicks and keys never reach the app while raging',
        reached.clicks === 0 && reached.keys === 0,
        JSON.stringify(reached)
    )
    await sleep(400)
    await page.screenshot({ path: path.join(BUILD_DIR, 'desktop-mid.png') })

    // Leave: everything rewinds and the page is untouched.
    await page.keyboard.press('Escape')
    await sleep(500)
    await page.screenshot({ path: path.join(BUILD_DIR, 'desktop-rewind.png') })
    await waitForArenaGone(page)
    check('every arena layer is gone after Escape', (await layerCount(page)) === 0, await layerCount(page))
    const intact = await page.evaluate(() => document.body.innerHTML === window.__rage.pageHtml)
    check('the page DOM is byte-identical afterwards', intact)
    check('onExit was called', await page.evaluate(() => window.__rage.exited))
    await page.mouse.click(checkbox.x, checkbox.y)
    check('the app is clickable again', (await page.evaluate(() => window.__rage.appClicks)) === 1)
    await page.screenshot({ path: path.join(BUILD_DIR, 'desktop-after.png') })
    check('no page errors (desktop)', errors.length === 0, errors.slice(0, 3).join(' | '))
    await page.close()
}

// The shop: buy the rocket launcher, be refused the finger snap, close with Escape.
async function shop(browser, url) {
    const { page, errors } = await openPage(browser, url, 'gold=1500&god=1')
    check('shop: the HUD shows score and full health', (await hudData(page)).health === '100')
    await page.keyboard.press('KeyB')
    check('shop: B opens the weapon shop (and pauses the game)', await waitForHud(page, data => data.shop === 'open'))
    const row = weapon => `[data-rage-mode-layer="shop"] [data-weapon="${weapon}"]`
    await page.click(`${row('rocket')} button`)
    await page.click(`${row('rocket')} button:first-child`)
    const equipped = await waitForHud(page, data => data.weapon === 'rocket')
    const bought = await page.evaluate(() => ({ gold: window.__rage.gold, calls: window.__rage.calls.purchase }))
    check(
        'shop: buying asks to confirm, charges the price once and equips it',
        equipped && bought.gold === 1250 && bought.calls.join() === 'rocket',
        JSON.stringify(bought)
    )
    await page.click(`${row('snap')} button`)
    await page.click(`${row('snap')} button:first-child`)
    await sleep(300)
    const refusal = await page.textContent(row('snap'))
    check('shop: an unaffordable weapon is refused, not granted', /Not enough Gold/.test(refusal), refusal.slice(0, 80))
    await page.screenshot({ path: path.join(BUILD_DIR, 'shop.png') })
    await page.keyboard.press('Escape')
    await sleep(200)
    const afterEscape = await hudData(page)
    check(
        'shop: Escape closes the shop, not rage mode',
        afterEscape.shop === undefined && (await layerCount(page)) >= 4,
        JSON.stringify({ shop: afterEscape.shop })
    )
    const chips = await page.$$eval('[data-rage-mode-layer="weapons"] [data-weapon]', nodes =>
        nodes.map(node => node.dataset.weapon)
    )
    check('shop: the weapon bar lists what you own', chips.join() === 'blaster,rocket', chips.join())
    const before = await destroyedCount(page)
    const paragraph = await centreOf(page, '#paragraph')
    await holdFire(page, { x: paragraph.x, y: paragraph.y }, 900)
    await sleep(900)
    check('shop: the rocket launcher blows holes in the page', (await destroyedCount(page)) > before + 3)
    await page.screenshot({ path: path.join(BUILD_DIR, 'rocket.png') })
    check('shop: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    await page.close()
}

// Every weapon fires without an error and does damage.
async function weapons(browser, url) {
    const { page, errors } = await openPage(browser, url, 'owned=all&god=1')
    // The laser (5) aims at the paragraph far above her: a beam aimed at the list she hovers over runs
    // sideways through empty space.
    const targets = ['#paragraph', '#title', '#tasks', '#paragraph', '#paragraph', '#paragraph', '#paragraph']
    const results = []
    for (let i = 0; i < 7; i++) {
        await page.keyboard.press(`Digit${i + 1}`)
        await sleep(150)
        const weapon = (await hudData(page)).weapon
        const before = await destroyedCount(page)
        const target = await centreOf(page, targets[i])
        await holdFire(page, { x: target.x + (i - 3) * 30, y: target.y }, weapon === 'snap' ? 120 : 800)
        await sleep(weapon === 'blackhole' ? 2400 : 700)
        const after = await destroyedCount(page)
        results.push(`${weapon}:${after - before}(shots ${(await hudData(page)).shots || 0})`)
        if (weapon === 'laser' || weapon === 'flamethrower') {
            await holdFire(page, { x: target.x, y: target.y + 20 }, 1)
        }
    }
    await page.mouse.move(640, 300)
    await page.mouse.down()
    await page.keyboard.press('Digit5')
    await sleep(400)
    await page.screenshot({ path: path.join(BUILD_DIR, 'laser.png') })
    await page.mouse.up()
    const allHit = results.every(result => parseInt(result.split(':')[1], 10) > 0)
    check('weapons: all seven fire and do damage', allHit && results.length === 7, results.join(' '))
    check('weapons: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    await page.close()
}

// The boss: built from today's open-task count, defeated with rockets.
async function bossFight(browser, url) {
    const { page, errors } = await openPage(browser, url, 'owned=all&tasks=3&bossHeadStart=44&god=1')
    const arrived = await waitForHud(page, data => data.boss === '3', null, 12000)
    check('boss: arrives, built from today’s open tasks (3)', arrived, (await hudData(page)).boss)
    await sleep(1500)
    await page.screenshot({ path: path.join(BUILD_DIR, 'boss.png') })
    await page.keyboard.press('Digit3')
    const scoreBefore = Number((await hudData(page)).score || 0)
    for (let round = 0; round < 80; round++) {
        const data = await hudData(page)
        if (data.bossDefeated || data.gameOver) break
        const target = await page.evaluate(() => {
            const layer = document.querySelector('[data-rage-mode-layer="input"]')
            return layer && layer.rageBossTarget ? layer.rageBossTarget() : null
        })
        if (target) await holdFire(page, target, 300)
        else await sleep(200)
    }
    const data = await hudData(page)
    check(
        'boss: can be defeated',
        data.bossDefeated === '3',
        JSON.stringify({ defeated: data.bossDefeated, gameOver: data.gameOver })
    )
    check('boss: defeating it scores big', Number(data.score) - scoreBefore >= 500, `${scoreBefore} → ${data.score}`)
    await page.screenshot({ path: path.join(BUILD_DIR, 'boss-defeated.png') })
    check('boss: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    await page.close()
}

// Game over: a nearly empty health bar, the boss's orbs finish her, the score is saved once.
async function gameOver(browser, url) {
    const { page, errors } = await openPage(browser, url, 'health=10&tasks=3&bossHeadStart=44&best=5')
    const paragraph = await centreOf(page, '#paragraph')
    await holdFire(page, { x: paragraph.x, y: paragraph.y }, 600)
    const over = await waitForHud(page, data => data.gameOver === '1', null, 25000)
    check('game over: a hit with no health left ends the game', over, JSON.stringify(await hudData(page)))
    await page
        .waitForSelector('[data-rage-mode-layer="gameover"] button', { state: 'visible', timeout: 5000 })
        .catch(() => {})
    await page.screenshot({ path: path.join(BUILD_DIR, 'game-over.png') })
    const card = await page.textContent('[data-rage-mode-layer="gameover"]')
    const calls = await page.evaluate(() => window.__rage.calls.submitScore)
    check('game over: the score is submitted once', calls.length === 1 && calls[0] > 0, JSON.stringify(calls))
    check('game over: the card celebrates a new highscore', /New highscore/.test(card), card.slice(0, 90))
    await page.click('[data-rage-mode-layer="gameover"] button:first-child')
    await sleep(300)
    const again = await hudData(page)
    check(
        'game over: play again starts a fresh round at full health',
        !again.gameOver && again.health === '100' && again.score === '0',
        JSON.stringify(again)
    )
    await page.keyboard.press('Escape')
    await waitForArenaGone(page)
    check('game over: leaving still puts the page back', (await layerCount(page)) === 0)
    check('game over: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    await page.close()
}

async function touch(browser, url) {
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 2,
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${url}?god=1`)
    await page.tap('#rage')
    await sleep(900)
    check('touch: arena layers are on the page', (await layerCount(page)) >= 4, await layerCount(page))
    const paragraph = await centreOf(page, '#paragraph')
    for (let i = 0; i < 10; i++) {
        await page.touchscreen.tap(paragraph.left + 30 + i * 28, paragraph.y + ((i % 3) - 1) * 20)
        await sleep(160)
    }
    await sleep(400)
    const destroyed = await destroyedCount(page)
    check('touch: taps shoot letters out', destroyed > 3, destroyed)
    await page.screenshot({ path: path.join(BUILD_DIR, 'touch-mid.png') })
    await page.tap('[data-rage-mode-layer="hud"] button:last-child')
    await waitForArenaGone(page)
    check('touch: ✕ removes every arena layer', (await layerCount(page)) === 0, await layerCount(page))
    check('touch: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    await context.close()
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
        else if (args.has('--game')) {
            await shop(browser, url)
            await weapons(browser, url)
            await bossFight(browser, url)
            await gameOver(browser, url)
        } else await desktop(browser, url)
    } catch (error) {
        check('harness ran to completion', false, error.message)
    }
    await browser.close()
    server.close()
    const failed = results.filter(r => !r.ok)
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
    process.exit(failed.length ? 1 : 0)
})()
