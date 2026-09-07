/**
 * AT-2507 browser-level test — a cleared goal's section leaving today's list gracefully.
 *
 * The reported behaviour was that the goal "just pops away". The fix is deliberately the quietest
 * one available — no flourish, no colour, just a fade and a collapse over ~1.4s — and that is
 * precisely the kind of change a jest suite cannot check: `__mocks__/react-native.js` stubs
 * `Animated.timing` with a no-op `{start}`, so nothing advances, and jsdom computes no layout, so
 * the section is never measured and the collapse has no height to collapse from. Every assertion in
 * the unit suites can be green while the section still pops.
 *
 * What is checked, in the order it happens:
 *
 *   0. the TRIGGER — completing the first of two tasks and dropping nothing changes nothing; a goal
 *      that merely becomes an EMPTY GOAL is not animated (it is not leaving); a section that leaves
 *      WITHOUT its tasks having been completed still leaves instantly.
 *   0a2. AT-2521 — the goal then leaving THROUGH that empty-goals bucket, which is how the
 *      departure actually arrives in production (two snapshots, tasks first). This is the case the
 *      shipped AT-2507 could never see, so the goal still popped. Its A/B is in
 *      `useGoalSectionExit.test.js`: against the pre-AT-2521 hook the exit run is simply never
 *      created, and this harness cannot run there at all because the hook returns no
 *      `emptyGoalsWithExits` — deliberately strict, so an API break cannot read as "no animation".
 *   1. the HOLD    — the board drops the section and it is STILL THERE, wearing an exit.
 *   2. FADE        — its opacity falls.
 *   3. COLLAPSE    — its painted height falls to nothing, and the content below is pulled up with
 *                    it rather than jumping.
 *   4. ORDER       — it is invisible before it is flat (fading and shrinking together reads as a
 *                    squash), and the layout is left alone for a beat before it starts moving.
 *   5. the END     — the section is finally gone, and the board is settled.
 *
 * Requirements (not part of CI's Jest jobs):
 *   nvm use 22
 *   (cd web-bundler && npm install)
 *   cp -R -f replacement_node_modules/* node_modules/
 *   npx playwright install chromium
 * Usage:
 *   node browser-tests/at2507/run.js
 *   node browser-tests/at2507/run.js --reduce-motion
 */
const path = require('path')
const http = require('http')
const fs = require('fs')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const ENTRY = path.join(__dirname, 'harness.entry.js')

/** Kept in step with `goalSectionExitMotion.js`. */
const GOAL_EXIT_COLLAPSE_DELAY_MS = 380
const GOAL_EXIT_FADE_MS = 1180
const GOAL_SECTION_EXIT_TOTAL_MS = 1400

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>AT-2507</title>
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
        viewport: { width: 820, height: 600 },
        reducedMotion: reduceMotion ? 'reduce' : 'no-preference',
    })
    page.on('pageerror', e => console.log('PAGE ERROR:', e.message))
    await page.goto(`http://127.0.0.1:${port}/`)
    await page.waitForFunction('window.__ready === true')
    // Let the reduce-motion preference resolve before anything can be held.
    await sleep(150)

    console.log(`\n--- mode: ${reduceMotion ? 'prefers-reduced-motion: reduce' : 'normal motion'} ---\n`)

    const finish = async () => {
        await browser.close()
        server.close()
        const failures = results.filter(r => !r.ok)
        console.log(`\n${results.length - failures.length}/${results.length} checks passed`)
        process.exit(failures.length ? 1 : 0)
    }

    const settled = await page.evaluate(() => window.__measure())
    const restingHeight = settled.height
    const restingBelowTop = settled.belowTop
    console.log(`    section at rest: ${restingHeight}px, content below at y=${restingBelowTop}`)

    // ── 0a. a goal that only loses its tasks is NOT leaving ───────────────────────────────────────
    // It comes back as an `EmptyGoal` under the same key, with its add-task line. Animating it out
    // would fade a row that is about to be redrawn.
    await page.evaluate(() => {
        window.__completeTask('t1')
        window.__completeTask('t2')
        window.__moveToEmptyGoals()
    })
    await sleep(80)
    const asEmptyGoal = await page.evaluate(() => ({ sections: window.__sections, exits: window.__exits }))
    check(
        'a cleared goal that stays as an empty goal is not animated out',
        asEmptyGoal.sections.length === 0 && Object.keys(asEmptyGoal.exits).length === 0,
        `sections=${JSON.stringify(asEmptyGoal.sections)} exits=${JSON.stringify(asEmptyGoal.exits)}`
    )

    /**
     * ── 0a2. AT-2521: and then it DOES leave, one snapshot later ─────────────────────────────────
     *
     * This is the ordinary production sequence, not an edge case. A goal only ever leaves today's
     * list because its progress reached 100, that number lives on the goal document, and the goal
     * write is caused by the task write — so the tasks snapshot lands first and the goal spends the
     * frame above sitting in the empty-goals bucket. AT-2507 read that frame as "this goal is
     * staying", forgot the section, and could never see the departure that followed: the goal
     * popped away exactly as it had before, with every unit test green.
     *
     * The row on screen at this point is the EMPTY-GOAL row, so that is the one that has to wear
     * the exit.
     */
    await page.evaluate(() => window.__dropEmptyGoal())
    await sleep(30)
    const leftFromBucket = await page.evaluate(() => ({
        ...window.__measure(),
        emptyGoals: window.__emptyGoals,
        exits: window.__exits,
    }))

    if (reduceMotion) {
        check(
            'reduced motion — a goal leaving the empty-goals bucket is dropped instantly',
            !leftFromBucket.present && leftFromBucket.emptyGoals.length === 0,
            `present=${leftFromBucket.present}`
        )
    } else {
        check(
            'AT-2521 — a goal that leaves THROUGH the empty-goals bucket still gets its exit',
            !!leftFromBucket.exits['goal-1'],
            `exits=${JSON.stringify(leftFromBucket.exits)}`
        )
        check(
            'and it is held as an empty goal, so the row already on screen is the one that animates',
            leftFromBucket.present && leftFromBucket.emptyGoals.length === 1,
            `present=${leftFromBucket.present} emptyGoals=${JSON.stringify(leftFromBucket.emptyGoals)}`
        )

        const bucketFrames = []
        for (let i = 0; i < 22; i++) {
            bucketFrames.push({ t: i * 50, ...(await page.evaluate(() => window.__measure())) })
            await sleep(50)
        }
        const bucketPainted = bucketFrames.filter(f => f.present)
        const bucketOpacities = bucketPainted.map(f => f.opacity)
        const bucketHeights = bucketPainted.map(f => f.height)
        console.log('    empty-goal height  :', bucketHeights.join(' '))
        console.log('    empty-goal opacity :', bucketOpacities.join(' '))
        check(
            'the empty-goal row fades rather than vanishing',
            bucketOpacities.length > 4 &&
                Math.max(...bucketOpacities) > 0.9 &&
                Math.min(...bucketOpacities) < 0.25 &&
                bucketOpacities.filter(o => o > 0.05 && o < 0.95).length >= 4,
            `${Math.max(...bucketOpacities)} → ${Math.min(...bucketOpacities)}`
        )
        /**
         * The half that only works because the hold puts the goal back where it already WAS. Held
         * as a main section instead, this row would be a freshly mounted component with no measured
         * height — it would fade and still drop its full height in one frame.
         */
        check(
            'and it collapses from a real measured height, so the gap closes',
            Math.max(...bucketHeights) > 40 && Math.min(...bucketHeights) < Math.max(...bucketHeights) - 20,
            `${Math.max(...bucketHeights)}px → ${Math.min(...bucketHeights)}px`
        )
    }

    // Back to a full section for the remaining cases. The hold is still running, so wait it out
    // before reusing the same goal id — otherwise the next case starts mid-exit.
    await page.evaluate(() => {
        window.__setEmptyGoals([])
        window.__setMainTasks([])
    })
    await sleep(GOAL_SECTION_EXIT_TOTAL_MS + 300)
    await page.evaluate(() => window.__setMainTasks([['goal-1', [{ id: 'a1' }, { id: 'a2' }]]]))
    await sleep(120)

    // ── 0b. a departure that is not finished work leaves instantly ───────────────────────────────
    await page.evaluate(() => window.__dropSection())
    await sleep(80)
    const movedAway = await page.evaluate(() => ({ ...window.__measure(), sections: window.__sections }))
    check(
        'a section whose tasks were moved or deleted still leaves instantly',
        !movedAway.present && movedAway.sections.length === 0,
        `present=${movedAway.present}`
    )

    // ── the real case ────────────────────────────────────────────────────────────────────────────
    await page.evaluate(() => window.__setMainTasks([['goal-1', [{ id: 'b1' }, { id: 'b2' }]]]))
    await sleep(120)

    await page.evaluate(() => window.__completeTask('b1'))
    await sleep(40)
    const afterFirst = await page.evaluate(() => window.__exits)
    check('finishing one of two tasks starts nothing', Object.keys(afterFirst).length === 0, '')

    await page.evaluate(() => {
        window.__completeTask('b2')
        window.__dropSection()
    })
    await sleep(30)

    const held = await page.evaluate(() => ({ ...window.__measure(), sections: window.__sections }))

    /**
     * Under reduced motion the CONTRACT INVERTS. There is nothing to see, so the hold is not taken
     * at all and the section leaves exactly as it always did — instantly. Taking the hold anyway
     * would strand a block on the board for 1.4s doing nothing, which is a worse bug than the pop.
     */
    if (reduceMotion) {
        check(
            'reduced motion — the section is dropped instantly, with no hold',
            !held.present && held.sections.length === 0,
            `present=${held.present}`
        )
        return finish()
    }

    check(
        'the board drops the section and the hold keeps it on screen',
        held.present && held.sections.length === 1,
        `present=${held.present} height=${held.height}px`
    )

    // ── the run, sampled every 50ms ──────────────────────────────────────────────────────────────
    const SAMPLE_MS = 50
    const SAMPLES = 34
    const frames = []
    for (let i = 0; i < SAMPLES; i++) {
        frames.push({ t: i * SAMPLE_MS, ...(await page.evaluate(() => window.__measure())) })
        await sleep(SAMPLE_MS)
    }

    const painted = frames.filter(f => f.present)
    check('the section stays mounted for its exit', painted.length > 4, `${painted.length}/${SAMPLES} frames`)

    if (painted.length) {
        const at = key => painted.map(f => f[key])
        const spark = values => values.map(v => (v === null ? '-' : v)).join(' ')
        console.log('    height  :', spark(at('height')))
        console.log('    opacity :', spark(at('opacity')))
        console.log('    below y :', spark(at('belowTop')))

        // ── the fade ─────────────────────────────────────────────────────────────────────────────
        const opacities = at('opacity')
        check(
            'it fades out',
            Math.max(...opacities) > 0.9 && Math.min(...opacities) < 0.05,
            `${Math.max(...opacities)} → ${Math.min(...opacities)}`
        )
        check(
            'the fade is gradual, not a cut',
            opacities.filter(o => o > 0.05 && o < 0.95).length >= 4,
            `${opacities.filter(o => o > 0.05 && o < 0.95).length} intermediate frames`
        )

        // ── the collapse ─────────────────────────────────────────────────────────────────────────
        const heights = at('height')
        check(
            'its height collapses to nothing',
            Math.max(...heights) > 60 && Math.min(...heights) < 4,
            `${Math.max(...heights)}px → ${Math.min(...heights)}px`
        )
        check(
            'the collapse is gradual, not a cut',
            heights.filter(h => h > 4 && h < Math.max(...heights) - 4).length >= 4,
            `${heights.filter(h => h > 4 && h < Math.max(...heights) - 4).length} intermediate frames`
        )

        /**
         * THE check this harness exists for. Everything above is about the section itself; this is
         * about the list. A pop is jarring because the content underneath teleports upward, so the
         * fix only works if the gap closes CONTINUOUSLY.
         */
        const belowTops = at('belowTop').filter(v => v !== null)
        const belowSteps = belowTops.slice(1).map((top, i) => Math.abs(top - belowTops[i]))
        check(
            'the content below is pulled up as the gap closes',
            Math.max(...belowTops) - Math.min(...belowTops) > 60,
            `y ${Math.max(...belowTops)} → ${Math.min(...belowTops)}`
        )
        check(
            'and it never jumps',
            // A pop would move it the whole section height in one frame.
            Math.max(...belowSteps) < restingHeight * 0.5,
            `largest single step ${Math.max(...belowSteps)}px of a ${restingHeight}px section`
        )

        // ── the order of the two beats ───────────────────────────────────────────────────────────
        const firstMove = painted.find(f => f.height < Math.max(...heights) - 2)
        check(
            'the layout is left alone for a beat before it starts moving',
            !firstMove || firstMove.t >= GOAL_EXIT_COLLAPSE_DELAY_MS - 2 * SAMPLE_MS,
            firstMove ? `first movement at ${firstMove.t}ms, delay is ${GOAL_EXIT_COLLAPSE_DELAY_MS}ms` : 'never moved'
        )
        const invisibleAt = painted.find(f => f.opacity < 0.02)
        const flatAt = painted.find(f => f.height < 2)
        check(
            'it is invisible before it is flat',
            // Fading and shrinking at the same rate reads as a squash (the AT-2404 rule).
            !!invisibleAt && (!flatAt || invisibleAt.t <= flatAt.t),
            invisibleAt
                ? `invisible at ${invisibleAt.t}ms, flat at ${flatAt ? `${flatAt.t}ms` : 'never'}`
                : 'never faded'
        )
        check(
            'the whole run is the ~1.4s that was asked for',
            painted[painted.length - 1].t < GOAL_SECTION_EXIT_TOTAL_MS + 400,
            `last painted frame at ${painted[painted.length - 1].t}ms`
        )
        check('the fade finishes first by design', GOAL_EXIT_FADE_MS < GOAL_SECTION_EXIT_TOTAL_MS, '')
    }

    // ── the end ──────────────────────────────────────────────────────────────────────────────────
    await sleep(600)
    const gone = await page.evaluate(() => ({ ...window.__measure(), sections: window.__sections }))
    check(
        'the section is finally dropped and the board is settled',
        !gone.present && gone.sections.length === 0 && gone.belowTop !== null,
        `present=${gone.present} below y=${gone.belowTop}`
    )

    return finish()
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
