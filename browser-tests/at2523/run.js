/**
 * AT-2523 browser-level test — the pending-send card arriving, and handing over, actually painting.
 *
 * The reported gap: "when I add a new thing into the assistant line we directly show it in the Last
 * comment section. We should animate this showing it (like other new comments)". The card was
 * shipped by AT-2504 and was inert — it appeared in place, in one frame, while every real comment in
 * the same slot rolled (AT-2511).
 *
 * Sampled every 25ms across each run, each beat checked where it is VISIBLE rather than where its
 * `Animated.Value` is:
 *
 *   1. SEND      the pending card rolls in from a full card below, and the comment that was in the
 *                slot rolls out under it — a departure that crosses a component boundary and is
 *                therefore only possible because of `lastCommentSlotRow.js`
 *   2. CLIP      neither row is ever painted outside the card, so the roll cannot smear over the
 *                composer above it or the task list below it
 *   3. HANDOVER  the assistant's answer rolls the PENDING card away, finishing the gesture the
 *                send started rather than swapping silently
 *   4. PRESS     the card is a press target, and says "opening" when the topic does not exist yet
 *
 * And the non-negotiable throughout: the card's height NEVER changes. That fixed
 * `LAST_COMMENT_PREVIEW_HEIGHT` is what keeps the assistant line from reflowing (AT-2344/AT-2504),
 * and an animation that broke it would be a regression well beyond a missing flourish.
 *
 * Neither jest suite can answer any of this: `Animated.timing` is a no-op stub there, and jsdom
 * computes no layout — so `onLayout` never fires, the roll distance falls back to a constant, and
 * `overflow: hidden` clips nothing because nothing has a box.
 *
 * Requirements (not part of CI's Jest jobs):
 *   nvm use 22
 *   (cd web-bundler && npm install)
 *   cp -R -f replacement_node_modules/* node_modules/
 *   npx playwright install chromium
 * Usage:
 *   node browser-tests/at2523/run.js
 *   node browser-tests/at2523/run.js --reduce-motion
 *
 * Run it against the pre-fix commit for the A/B: the pending card reports
 * `incoming y : 0 0 0 0 …` for the whole run with no outgoing row and no roll viewport at all —
 * i.e. the reported symptom, reproduced.
 */
const path = require('path')
const http = require('http')
const fs = require('fs')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const ENTRY = path.join(__dirname, 'harness.entry.js')

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>AT-2523</title>
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

function serve(dir = BUILD_DIR) {
    const server = http.createServer((req, res) => {
        const url = req.url === '/' ? '/index.html' : req.url.split('?')[0]
        const file = path.join(dir, url)
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

const at = (frames, key) => frames.map(f => f[key])
const printTrack = (label, frames, key) =>
    console.log(
        `    ${label}:`,
        at(frames, key)
            .map(v => (v === null || v === undefined ? '-' : v))
            .join(' ')
    )

/**
 * Capture the FIRST painted frame of a transition and then sample across it.
 *
 * The first frame is where a missing arm shows up as "already finished", and where AT-2511's
 * passive-effect bug lived (the new content painted in place, then jumped back to roll in). A
 * double rAF is what puts us after the commit's paint and before anything has moved far.
 */
async function captureRun(page, trigger, samples = 24) {
    const first = await page.evaluate(
        fn =>
            new Promise(resolve => {
                // eslint-disable-next-line no-new-func
                new Function(`return (${fn})`)()()
                requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.__measure())))
            }),
        trigger
    )
    const frames = [first]
    for (let i = 0; i < samples; i++) {
        await sleep(25)
        frames.push(await page.evaluate(() => window.__measure()))
    }
    return frames
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
    page.on('pageerror', e => console.log('PAGE ERROR:', e.message, '\n', e.stack))
    await page.goto(`http://127.0.0.1:${port}/`)
    await page.waitForFunction('window.__ready === true')
    // Let the reduce-motion preference resolve before anything is armed.
    await sleep(150)

    console.log(
        `\n--- mode: ${reduceMotion ? 'prefers-reduced-motion: reduce' : 'normal motion'} — assistant line pending send ---\n`
    )

    const expectedHeight = await page.evaluate(() => window.__expectedCardHeight)
    const before = await page.evaluate(() => window.__measure())
    check('the slot starts with a real comment in it', before.present && before.kind === 'preview', before.kind)
    const restingTop = before.cardTop

    // ── 1. SEND ─────────────────────────────────────────────────────────────────────────────────
    const sendFrames = await captureRun(page, '() => window.__send()')
    printTrack('pending incoming y', sendFrames, 'incomingY')
    printTrack('pending outgoing y', sendFrames, 'outgoingY')
    console.log('    outgoing text     :', JSON.stringify((sendFrames[0].outgoingText || '').slice(0, 46)))

    check(
        'the pending card takes the slot',
        sendFrames.some(f => f.kind === 'pending'),
        sendFrames[0].kind
    )
    check(
        'it is a rolling card, not a static placeholder',
        sendFrames.every(f => !f.present || f.incomingPresent),
        'no incoming layer means the card is outside the roll structure entirely'
    )

    if (reduceMotion) {
        // Reduced motion keeps the information and drops the motion: the card is simply there.
        check(
            'under reduced motion it appears in place, with no roll',
            sendFrames.every(f => f.incomingY === 0),
            `incoming y values: ${[...new Set(at(sendFrames, 'incomingY'))].join(',')}`
        )
        check(
            'and nothing is rolled away underneath it',
            sendFrames.every(f => !f.outgoingPresent),
            'an outgoing row was mounted'
        )
    } else {
        const incomingYs = at(sendFrames, 'incomingY').filter(v => v !== null)
        check(
            'beat 0 — the pending card starts a full card BELOW, not in place',
            Math.abs(sendFrames[0].incomingY - expectedHeight) <= 2,
            `first painted frame y=${sendFrames[0].incomingY}, card ${expectedHeight}px`
        )
        check(
            'beat 1 — it rolls upward into place',
            Math.min(...incomingYs) <= 1 && Math.max(...incomingYs) >= expectedHeight - 2,
            `${Math.max(...incomingYs)}px → ${Math.min(...incomingYs)}px`
        )
        check(
            'beat 1 — the roll actually advances (not a single-frame jump)',
            new Set(incomingYs).size > 5,
            `${new Set(incomingYs).size} distinct positions`
        )

        /**
         * THE cross-component departure. The comment that was on screen belongs to a component that
         * has already unmounted, so this can only be non-empty because the SLOT remembered it.
         */
        check(
            'beat 1 — the comment that was in the slot rolls away under it',
            sendFrames.some(f => f.outgoingPresent),
            sendFrames.some(f => f.outgoingPresent) ? '' : 'no outgoing row — the slot memory did not carry the row'
        )
        const outgoingTexts = at(sendFrames, 'outgoingText').filter(Boolean)
        check(
            'beat 1 — and it is the PREVIOUS comment, not a copy of what is arriving',
            outgoingTexts.length > 0 && outgoingTexts.every(t => t.includes('already in this slot')),
            outgoingTexts.length ? JSON.stringify(outgoingTexts[0].slice(0, 50)) : 'no outgoing row at all'
        )
        const gaps = sendFrames
            .filter(f => f.outgoingPresent && f.incomingY !== null)
            .map(f => Number((f.incomingY - f.outgoingY).toFixed(2)))
        check(
            'beat 1 — the two rows stay exactly one card apart, so no gap opens',
            gaps.length > 0 && gaps.every(g => Math.abs(g - expectedHeight) <= 1.5),
            gaps.length ? `gaps ${Math.min(...gaps)}px … ${Math.max(...gaps)}px` : 'no frame had both rows'
        )
    }

    // ── 2. CLIP + geometry ──────────────────────────────────────────────────────────────────────
    check(
        'beat 2 — the roll is clipped inside the card',
        sendFrames.every(f => !f.present || f.viewportOverflow === 'hidden'),
        `viewport overflow: ${sendFrames[0].viewportOverflow}`
    )
    check(
        'beat 2 — neither row is ever painted outside the card',
        sendFrames.every(
            f =>
                (f.incomingVisible === null || f.incomingVisible <= 1) &&
                (f.outgoingVisible === null || f.outgoingVisible <= 1)
        ),
        `max visible in=${Math.max(...at(sendFrames, 'incomingVisible').filter(v => v !== null))}`
    )
    check(
        'the card never changes height — the assistant line cannot reflow',
        sendFrames.every(f => !f.present || Math.abs(f.cardHeight - expectedHeight) <= 0.5),
        `heights seen: ${[...new Set(at(sendFrames, 'cardHeight'))].join(',')} (expected ${expectedHeight})`
    )
    check(
        'the card does not drift while it rolls',
        sendFrames.every(f => !f.present || Math.abs(f.cardTop - restingTop) <= 0.5),
        `top moved ${Math.max(...at(sendFrames, 'cardTop').map(t => Math.abs(t - restingTop))).toFixed(1)}px`
    )

    // ── 4. PRESS (before the topic exists) ──────────────────────────────────────────────────────
    const statusBefore = await page.evaluate(() => window.__statusText())
    const pressed = await page.evaluate(() => window.__pressPendingCard())
    await sleep(80)
    const statusAfter = await page.evaluate(() => window.__statusText())
    check('the pending card is a real press target', pressed === true, pressed ? '' : 'no card node to press')
    check(
        'a tap before the topic exists is remembered, not dropped',
        statusBefore !== statusAfter && /pening|ffnet|briendo/.test(statusAfter || ''),
        `"${statusBefore}" → "${statusAfter}"`
    )

    /**
     * ── 3. HANDOVER ─────────────────────────────────────────────────────────────────────────────
     *
     * Deliberately WITHOUT giving the send a chat id first. Releasing the armed tap above would
     * open `RichCommentModal`, and that component reads project membership out of the store
     * (`SharedHelper.accessGranted` → `isMember`) — which this harness's anonymous session does not
     * populate, so it throws and takes the tree down before anything can be measured. That the
     * popover opens when the id lands is a logic claim, fully covered and mutation-checked in
     * `PendingAssistantCommentWrapper.test.js`; what only a browser can answer is whether pixels
     * move, and the handover moves them with or without a chat id.
     */
    const answerFrames = await captureRun(page, '() => window.__answer()')
    printTrack('answer incoming y', answerFrames, 'incomingY')
    printTrack('answer outgoing y', answerFrames, 'outgoingY')
    console.log('    outgoing text     :', JSON.stringify((answerFrames[0].outgoingText || '').slice(0, 46)))

    check(
        'the real preview takes the slot back',
        answerFrames.some(f => f.kind === 'preview'),
        answerFrames[0].kind
    )

    if (reduceMotion) {
        check(
            'under reduced motion the answer appears in place too',
            answerFrames.every(f => f.incomingY === 0 && !f.outgoingPresent),
            `y values: ${[...new Set(at(answerFrames, 'incomingY'))].join(',')}`
        )
    } else {
        check(
            'the answer rolls the PENDING card away, finishing the gesture',
            answerFrames.some(f => f.outgoingPresent),
            answerFrames.some(f => f.outgoingPresent) ? '' : 'the answer swapped in silently'
        )
        const answerOutgoing = at(answerFrames, 'outgoingText').filter(Boolean)
        check(
            'and what leaves is the message the user sent, not the old comment',
            answerOutgoing.length > 0 && answerOutgoing.every(t => t.includes('Move my three overdue tasks')),
            answerOutgoing.length ? JSON.stringify(answerOutgoing[0].slice(0, 50)) : 'no outgoing row'
        )
        check(
            'the answer settles exactly where the pending card was',
            Math.abs(answerFrames[answerFrames.length - 1].incomingY) <= 0.5,
            `y=${answerFrames[answerFrames.length - 1].incomingY}`
        )
    }

    check(
        'the card is still exactly its resting height after the handover',
        answerFrames.every(f => !f.present || Math.abs(f.cardHeight - expectedHeight) <= 0.5),
        `heights: ${[...new Set(at(answerFrames, 'cardHeight'))].join(',')}`
    )

    const outside = await page.evaluate(() => window.__paintedOutsideCard())
    console.log('    painted outside card at rest:', JSON.stringify(outside))

    await browser.close()
    server.close()

    const failures = results.filter(r => !r.ok)
    console.log(`\n${results.length - failures.length}/${results.length} checks passed`)
    process.exit(failures.length ? 1 : 0)
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
