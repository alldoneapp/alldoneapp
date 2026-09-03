/**
 * AT-2503 browser-level test — the Undo notification arriving and leaving, in real pixels.
 *
 * What it checks, in the order a user experiences it:
 *
 *   1. ENTRY   each of the four variants fades up from nothing, is displaced on its first frames,
 *              overshoots its resting place on the channel it is supposed to, and settles to
 *              EXACTLY identity — the invariant that, if broken, leaves the banner permanently
 *              crooked or offset with nothing on screen to explain it.
 *   2. EXIT    the banner survives its own dismissal long enough to animate (it used to vanish on
 *              one frame), leaves as the SAME variant it arrived as, and is then actually gone.
 *   3. NUDGE   a content change keeps the banner mounted and in place, and fades the new text up.
 *   4. DRAIN   the countdown line empties left-to-right — `transform-origin` is a react-native-web
 *              passthrough, so a regression there turns a drain into a symmetric collapse and no
 *              jest assertion anywhere would notice.
 *
 * `--reduce-motion` asserts the INVERTED contract: no transform at all, no countdown line, and an
 * instant unmount. Getting that backwards is a real hazard — CLAUDE.md records a harness that
 * asserted the animated expectations under reduced motion and therefore reported correct behaviour
 * as a failure.
 *
 * Requirements (not part of CI's Jest jobs):
 *   nvm use 22
 *   (cd web-bundler && npm install)
 *   cp -R -f replacement_node_modules/* node_modules/
 *   npx playwright install chromium
 * Usage:
 *   node browser-tests/at2503/run.js
 *   node browser-tests/at2503/run.js --reduce-motion
 */
const path = require('path')
const http = require('http')
const fs = require('fs')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const ENTRY = path.join(__dirname, 'harness.entry.js')

// The variant ids, in the module's own order. Kept as a literal so the harness fails loudly if the
// set ever changes rather than silently checking three of five.
const VARIANTS = ['drop', 'pop', 'glide', 'tilt']

// Which channel each variant is supposed to overshoot on, and in which direction relative to rest.
const OVERSHOOT = {
    drop: { channel: 'translateY', rest: 0, direction: 'above' },
    pop: { channel: 'scale', rest: 1, direction: 'above' },
    glide: { channel: 'translateX', rest: 0, direction: 'below' },
    tilt: { channel: 'rotation', rest: 0, direction: 'above' },
}

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>AT-2503</title>
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

/**
 * Samples the banner every `stepMs` for `count` frames. Deliberately polling rather than using
 * rAF callbacks: what is being measured is what the compositor has committed, which is exactly what
 * `getComputedStyle` reports between frames.
 */
async function sample(page, count, stepMs) {
    const frames = []
    for (let i = 0; i < count; i++) {
        frames.push({ t: i * stepMs, ...(await page.evaluate(() => window.__measure())) })
        await sleep(stepMs)
    }
    return frames
}

/**
 * Lands the picker on `target`. The pool excludes whatever played last (the no-repeat rule), so the
 * fraction has to be computed against that reduced pool — which also means this cannot ask for the
 * variant that is currently showing, and the caller orders its passes accordingly.
 */
async function showVariant(page, target, previous) {
    const pool = VARIANTS.filter(id => id !== previous)
    const index = pool.indexOf(target)
    if (index < 0) throw new Error(`cannot pick ${target} straight after ${previous}`)
    await page.evaluate(value => window.__setRandom(value), (index + 0.5) / pool.length)
    await page.evaluate(() => window.__show())
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
    // Let react-native-web's async reduced-motion answer land before anything is shown.
    await sleep(200)

    console.log(`\n--- mode: ${reduceMotion ? 'prefers-reduced-motion: reduce' : 'normal motion'} ---\n`)

    if (reduceMotion) {
        await page.evaluate(() => window.__show())
        await sleep(60)
        const shown = await page.evaluate(() => window.__measure())

        check('reduced motion — the banner is still shown', shown.present, '')
        check('reduced motion — it is fully opaque immediately', shown.opacity === 1, `opacity=${shown.opacity}`)
        check('reduced motion — no transform is applied at all', !shown.hasTransform, `transform=${shown.hasTransform}`)
        check('reduced motion — no countdown line is drawn', !shown.countdownPresent, '')

        // Ten seconds of continuous movement is exactly what this preference suppresses; the line
        // is dropped rather than frozen, because a static full-width bar states something untrue.
        await sleep(400)
        const later = await page.evaluate(() => window.__measure())
        check('reduced motion — still nothing draining', !later.countdownPresent, '')

        await page.evaluate(() => window.__hide())
        await sleep(30)
        const gone = await page.evaluate(() => window.__measure())
        check('reduced motion — it leaves immediately, with no exit to wait out', !gone.present, '')

        await browser.close()
        server.close()
        const failed = results.filter(r => !r.ok)
        console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
        process.exit(failed.length ? 1 : 0)
    }

    // ── 1. every variant, entering ──────────────────────────────────────────────────────────────
    let previous = null
    for (const target of VARIANTS) {
        await showVariant(page, target, previous)
        // 260ms of entry, sampled every 16ms.
        const frames = (await sample(page, 22, 16)).filter(f => f.present)
        const settled = await page.evaluate(() => window.__measure())
        previous = target

        const label = `entry/${target}`
        check(
            `${label} — the picker landed on it`,
            frames[0] && frames[0].variant === target,
            `got ${frames[0]?.variant}`
        )

        const opacities = frames.map(f => f.opacity)
        check(
            `${label} — fades up from nothing`,
            Math.min(...opacities) < 0.35 && Math.max(...opacities) > 0.95,
            `${Math.min(...opacities)} → ${Math.max(...opacities)}`
        )

        const { channel, rest, direction } = OVERSHOOT[target]
        const values = frames.map(f => f[channel])
        const moved = values.some(value => Math.abs(value - rest) > 0.005)
        check(`${label} — is actually displaced while animating`, moved, `${channel}: ${values.join(' ')}`)

        const overshot = direction === 'above' ? values.some(v => v > rest + 0.004) : values.some(v => v < rest - 0.004)
        check(
            `${label} — overshoots its resting place on ${channel}`,
            overshot,
            `${channel} extremes ${Math.min(...values)} … ${Math.max(...values)}`
        )

        /**
         * The one that matters most. `settled` is read after the run has finished, so any residual
         * offset here is permanent for the life of the banner.
         */
        const atRest =
            settled.opacity === 1 &&
            Math.abs(settled.translateX) < 0.5 &&
            Math.abs(settled.translateY) < 0.5 &&
            Math.abs(settled.scale - 1) < 0.005 &&
            Math.abs(settled.rotation) < 0.05
        check(
            `${label} — settles to exactly its resting position`,
            atRest,
            `x=${settled.translateX} y=${settled.translateY} scale=${settled.scale} rot=${settled.rotation} opacity=${settled.opacity}`
        )

        if (target !== VARIANTS[VARIANTS.length - 1]) {
            await page.evaluate(() => window.__hide())
            await sleep(320)
        }
    }

    // ── 2. the exit ─────────────────────────────────────────────────────────────────────────────
    const beforeExit = await page.evaluate(() => window.__measure())
    await page.evaluate(() => window.__hide())
    await sleep(30)
    const leaving = await page.evaluate(() => window.__measure())

    check('exit — the banner is still on screen to animate out', leaving.present, '')
    check('exit — it reports itself as leaving', leaving.phase === 'leaving', `phase=${leaving.phase}`)
    check(
        'exit — it leaves as the same variant it arrived as',
        leaving.variant === beforeExit.variant,
        `${beforeExit.variant} → ${leaving.variant}`
    )
    check('exit — the countdown line is dropped', !leaving.countdownPresent, '')

    const exitFrames = (await sample(page, 10, 20)).filter(f => f.present)
    if (exitFrames.length) {
        const minOpacity = Math.min(...exitFrames.map(f => f.opacity))
        check('exit — it fades away', minOpacity < 0.6, `min opacity ${minOpacity}`)
    }

    await sleep(200)
    const afterExit = await page.evaluate(() => window.__measure())
    check('exit — it is gone once the exit has settled', !afterExit.present, '')

    // ── 3. the content nudge ────────────────────────────────────────────────────────────────────
    await page.evaluate(() => window.__show())
    await sleep(340)
    const settledBefore = await page.evaluate(() => window.__measure())
    await page.evaluate(() => window.__flipContent())
    await sleep(40)
    const nudged = await page.evaluate(() => window.__measure())

    check('nudge — the banner stays mounted through a content change', nudged.present, '')
    check(
        'nudge — it does NOT replay the entry (same variant, still "shown")',
        nudged.variant === settledBefore.variant && nudged.phase === 'shown',
        `${settledBefore.variant}/${settledBefore.phase} → ${nudged.variant}/${nudged.phase}`
    )
    check(
        'nudge — the new text fades up rather than appearing at full strength',
        nudged.messageOpacity !== null && nudged.messageOpacity < 0.98,
        `message opacity ${nudged.messageOpacity}`
    )
    await sleep(320)
    const afterNudge = await page.evaluate(() => window.__measure())
    check(
        'nudge — the beat resolves back to a fully legible message',
        afterNudge.messageOpacity === 1 && Math.abs(afterNudge.scale - 1) < 0.005,
        `opacity ${afterNudge.messageOpacity}, scale ${afterNudge.scale}`
    )

    // ── 4. the countdown drain ──────────────────────────────────────────────────────────────────
    const bar = await page.evaluate(() => window.__measure())
    check('countdown — a line is drawn', bar.countdownPresent, '')
    check(
        'countdown — it drains from the right edge, not from its own middle',
        bar.countdownOrigin && bar.countdownOrigin.startsWith('0px'),
        `transform-origin: ${bar.countdownOrigin}`
    )
    /**
     * react-native-web 0.21 forwards `aria-hidden` and silently drops the legacy
     * `accessibilityElementsHidden` / `importantForAccessibility` pair, so a decorative element
     * hidden with the wrong prop reads as an accessibility fix in review and does nothing in the
     * browser. This is the only place that distinction is observable.
     */
    check(
        'countdown — it really is hidden from assistive technology in the DOM',
        bar.countdownAriaHidden === 'true',
        `aria-hidden=${bar.countdownAriaHidden}`
    )

    const drainFrames = (await sample(page, 12, 150)).filter(f => f.countdownPresent)
    const widths = drainFrames.map(f => f.countdownWidth)
    check(
        'countdown — the painted width actually shrinks over time',
        widths.length > 3 && widths[widths.length - 1] < widths[0] - 10,
        `${widths.join(' → ')}`
    )
    check(
        'countdown — it never grows back',
        widths.every((w, i) => i === 0 || w <= widths[i - 1] + 1),
        `${widths.join(' → ')}`
    )
    check(
        'countdown — it starts at the banner width and only ever loses ground',
        widths.length > 0 && widths[0] > bar.width * 0.85,
        `${widths[0]}px of ${bar.width}px`
    )

    await browser.close()
    server.close()
    const failed = results.filter(r => !r.ok)
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
    process.exit(failed.length ? 1 : 0)
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
