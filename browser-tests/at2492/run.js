/**
 * AT-2492 browser-level test — the completed sweep, actually painting.
 *
 * The second pass of this harness answered "I don't see the animation on the project lines" (the
 * trigger, not the animation, was broken). The third pass turned the run into four sequential
 * stages over ~2.8s, and this now samples the whole run frame by frame so each stage is checked
 * where it is visible rather than where its `Animated.Value` is:
 *
 *   1. FILL     the wash grows across the row behind a travelling edge, and the accent draws in
 *   2. SHIMMER  a band crosses the FILLED row — so it must move while the wash is already full
 *   3. PULSE    the glow rises and falls back to nothing, and the accent thickens and returns
 *   4. SETTLE   every layer fades and the overlay is gone
 *
 * A jest suite can observe none of it: `__mocks__/react-native.js` replaces `Animated.timing` with
 * a no-op, and jsdom computes no layout, so `onLayout` never fires and neither travelling layer is
 * ever rendered at all.
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

    /**
     * Under reduced motion the CONTRACT INVERTS, and asserting the animated expectations here was a
     * flaw in the harness rather than a finding: the celebration deliberately renders nothing (a
     * sweep carries no information a static frame could preserve), and — the AT-2445 rule — it must
     * not claim the once-per-day marker for a run nobody was shown, or turning the preference back
     * off later that day would find the day already spent.
     */
    if (reduceMotion) {
        check('reduced motion — no run is started', runId === 0, `runId=${runId}`)
        await sleep(400)
        const painted = await page.evaluate(() => window.__measure())
        check('reduced motion — nothing is painted on the row', !painted.present, '')
        const today = new Date()
        const dayKey = `${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, '0')}-${`${today.getDate()}`.padStart(2, '0')}`
        const spentTheDay = await page.evaluate(key => window.__hasCelebrated(key), dayKey)
        check('reduced motion — the day is left unspent, so it can still be celebrated', !spentTheDay, '')
        await browser.close()
        server.close()
        const reducedFailures = results.filter(r => !r.ok)
        console.log(`\n${results.length - reducedFailures.length}/${results.length} checks passed`)
        process.exit(reducedFailures.length ? 1 : 0)
    }

    check('a cleared project starts a run', runId === 1, `runId=${runId}`)

    // ~2.8s of run, sampled every 60ms, so every stage gets ~9-14 frames of its own.
    const SAMPLE_MS = 60
    const SAMPLES = 50
    const frames = []
    for (let i = 0; i < SAMPLES; i++) {
        frames.push({ t: i * SAMPLE_MS, ...(await page.evaluate(() => window.__measure())) })
        await sleep(SAMPLE_MS)
    }

    const present = frames.filter(f => f.present)
    check('the sweep overlay is mounted', present.length > 0, `${present.length}/${SAMPLES} frames`)

    if (present.length) {
        const rowWidth = present[0].overlay.width
        const at = key => present.map(f => f[key])
        const spark = values => values.map(v => (v === null ? '-' : v)).join(' ')

        console.log('    overlay box:', JSON.stringify(present[0].overlay))
        console.log('    wash colour:', present[0].washColor, ' first opacity:', present[0].washOpacity)
        console.log('    wash width  :', spark(at('washWidth')))
        console.log('    edge left   :', spark(at('edgeLeft')))
        console.log('    shimmer left:', spark(at('shimmerLeft')))
        console.log('    pulse alpha :', spark(at('pulseOpacity')))
        console.log('    accent w/h  :', spark(present.map(f => `${f.accentWidth}/${f.accentHeight}`)))
        console.log('    wash alpha  :', spark(at('washOpacity')))

        // ── stage 1: the fill ────────────────────────────────────────────────────────────────────
        const maxWash = Math.max(...at('washWidth'))
        check('stage 1 — the wash actually grows (animation advances)', maxWash > 50, `max painted ${maxWash}px`)
        check(
            'stage 1 — the wash reaches most of the row',
            maxWash > rowWidth * 0.7,
            `${maxWash}px of ${Math.round(rowWidth)}px`
        )
        check(
            'stage 1 — the leading edge renders',
            present.some(f => f.edgePresent),
            ''
        )
        /**
         * It leaves the row entirely, so no bright line is ever parked at the right margin — that
         * is also what keeps it invisible through stages 2-4 without any opacity bookkeeping. The
         * left-hand bound is deliberately "near the left margin" rather than "off it": the fill is
         * the FIRST stage and sampling can only start a frame or two into it, so its true starting
         * position (-56px) is not observable from here.
         */
        check(
            'stage 1 — the leading edge crosses the row and leaves it',
            Math.min(...at('edgeLeft')) < rowWidth * 0.1 && Math.max(...at('edgeLeft')) >= Math.round(rowWidth) - 2,
            `${Math.min(...at('edgeLeft'))}px → ${Math.max(...at('edgeLeft'))}px`
        )
        const maxAccent = Math.max(...at('accentWidth'))
        check(
            'stage 1 — the accent bar draws in with the fill',
            maxAccent > rowWidth * 0.7,
            `${maxAccent}px of ${Math.round(rowWidth)}px`
        )
        check('the overlay has real height', present[0].overlay.height > 10, `${present[0].overlay.height}px`)

        /**
         * ── stage 2: the shimmer ─────────────────────────────────────────────────────────────────
         *
         * The band has to travel, and it has to do it over an ALREADY FILLED row. If it moved while
         * the wash was still growing it would read as a second wipe chasing the first, which is the
         * one thing the stage must not look like — so both halves are asserted, not just "it moved".
         */
        const overFullRow = present.filter(f => f.washWidth > rowWidth * 0.98 && f.shimmerLeft !== null)
        const shimmerOverFull = overFullRow.map(f => f.shimmerLeft)
        check(
            'stage 2 — the shimmer band travels across the row',
            shimmerOverFull.length > 2 && Math.max(...shimmerOverFull) - Math.min(...shimmerOverFull) > rowWidth * 0.5,
            shimmerOverFull.length
                ? `${Math.min(...shimmerOverFull)}px → ${Math.max(...shimmerOverFull)}px over a full wash`
                : 'never sampled over a full wash'
        )
        check(
            'stage 2 — it starts off the left of the row and ends off the right',
            Math.min(...at('shimmerLeft').filter(v => v !== null)) < 0 &&
                Math.max(...at('shimmerLeft').filter(v => v !== null)) >= Math.round(rowWidth) - 2,
            `${Math.min(...at('shimmerLeft').filter(v => v !== null))}px → ${Math.max(
                ...at('shimmerLeft').filter(v => v !== null)
            )}px`
        )

        /**
         * ── stage 3: the breath ──────────────────────────────────────────────────────────────────
         *
         * It must rise AND come back to nothing. A glow that peaked and stayed would be a permanent
         * brightening of the row rather than a confirmation, and the accent left thick would be a
         * visible residue on a settled line.
         */
        const pulseAlphas = at('pulseOpacity').filter(v => v !== null)
        const peakPulse = Math.max(...pulseAlphas)
        check('stage 3 — the breath rises', peakPulse > 0.2, `peak opacity ${peakPulse}`)
        const peakIndex = pulseAlphas.indexOf(peakPulse)
        check(
            'stage 3 — and falls back to nothing',
            pulseAlphas.slice(peakIndex).some(v => v < 0.02),
            `last ${pulseAlphas[pulseAlphas.length - 1]}`
        )
        const accentHeights = at('accentHeight').filter(v => v !== null)
        check(
            'stage 3 — the accent thickens for the breath and returns',
            Math.max(...accentHeights) > Math.min(...accentHeights) + 0.5,
            `${Math.min(...accentHeights)}px → ${Math.max(...accentHeights)}px`
        )

        // ── stage 4: the settle ──────────────────────────────────────────────────────────────────
        const washAlphas = at('washOpacity')
        check(
            'stage 4 — every layer fades out together',
            Math.min(...washAlphas) < 0.5 &&
                present.every(f => f.accentOpacity === null || Math.abs(f.accentOpacity - f.washOpacity) < 0.02),
            `wash opacity floor ${Math.min(...washAlphas)}`
        )

        // The run must be long enough to register, and bounded — the whole point of the third pass.
        const lastPresent = present[present.length - 1].t
        check(
            'the whole run lasts ~2.5-3.0s',
            lastPresent >= 2400 && lastPresent <= 3100,
            `still painting at ${lastPresent}ms, gone by ${lastPresent + SAMPLE_MS}ms`
        )
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
            // Mid-run the row is still on the board: the hold is what buys the four stages the time
            // to play, and it has to outlast them.
            await sleep(1600)
            const stillHeld = await page.evaluate(() => window.__measure())
            check('All Projects: the row is held for the whole run, not just the first stage', stillHeld.present, '')
        }
        // Past the hold (~2.9s from the run starting), the project leaves the board as it always did.
        await sleep(1800)
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
