/**
 * AT-2511 browser-level test — the last-comment ticker roll, actually painting.
 *
 * A new comment landing in the assistant line's "Last comment" slot used to swap its text
 * silently, which is indistinguishable from a re-render — so the moment the assistant answers, the
 * payoff of the whole line, had no shape at all. It now rolls: the comment that was on screen
 * travels UP and out of the card while the new one comes in from below, like a departure board.
 *
 * Sampled every 25ms across the run, each beat checked where it is visible rather than where its
 * `Animated.Value` is:
 *
 *   1. ROLL   both rows travel one full card height, together, and the OLD comment is the one
 *             leaving — which is only provable by reading the text in each row
 *   2. CLIP   neither row is ever painted outside the card, so the roll cannot smear over the
 *             composer above it or the task list below it
 *   3. POP    the unread badge grows to full size, stays pinned to the card's corner, and is
 *             NEVER clipped — it sits outside the card at top/right: -5
 *   4. REST   the new comment settles exactly where the old one was and the outgoing row is gone
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
 *   node browser-tests/at2511/run.js
 *   node browser-tests/at2511/run.js --reduce-motion
 *   node browser-tests/at2511/run.js --compact
 *   node browser-tests/at2511/run.js --real-chain
 *
 * `--real-chain` is the mode that matters most and the one this harness originally lacked. The
 * three modes above render `LastAssistantComment` DIRECTLY with a hand-written `arrivalId`, which
 * is why all 78 of their checks passed while the feature was inert in production:
 * `LastAssistantCommentWrapper` — the component that actually decides whether the card is ever told
 * about an arrival — was in nobody's tree, and its ordinary branch dropped the prop. `--real-chain`
 * mounts container → wrapper → card and delivers a comment through a `watchComments` callback.
 *
 * Run it against the pre-fix commit for the A/B: `incoming y : 0 0 0 0 …` for the whole run, no
 * outgoing row, 5 of 11 checks failing — i.e. the reported symptom, reproduced.
 */
const path = require('path')
const http = require('http')
const fs = require('fs')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const ENTRY = path.join(__dirname, 'harness.entry.js')

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>AT-2511</title>
<style>html,body,#root{margin:0;padding:0;box-sizing:border-box;background:#fff}</style></head>
<body><div id="root"></div><script src="/harness.js"></script></body></html>`

function build({ entry = ENTRY, out = BUILD_DIR, setup = null } = {}) {
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
            `harnessEntry=${entry}`,
            '--env',
            `harnessOut=${out}`,
            ...(setup ? ['--env', `harnessSetup=${setup}`] : []),
        ],
        { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=1400' } }
    )
    fs.writeFileSync(path.join(out, 'index.html'), HTML)
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

/**
 * ── the real-chain mode ──────────────────────────────────────────────────────────────────────────
 *
 * Everything above renders `LastAssistantComment` directly and hands it an `arrivalId`. That is what
 * let AT-2511 ship an animation that could not run: `LastAssistantCommentWrapper` sits between the
 * container and the card in production, and its ordinary (no-modal) branch dropped the prop — so the
 * card was always told `null`, and no harness had that component in its tree to notice.
 *
 * This mode mounts the REAL container → REAL wrapper → REAL card and delivers a comment the way the
 * app does, through a `watchComments` callback. It also covers the second defect that shape hid: the
 * container publishes `arrivalId` from an effect, one commit AFTER the text, so a card that captured
 * "the row painted last commit" had already advanced to the NEW row and rolled the fresh answer out
 * from under itself — identical text in both rows, which no positional check can see.
 */
async function realChainMain() {
    const OUT = path.join(__dirname, '.build-realchain')
    build({
        entry: path.join(__dirname, 'realChain.entry.js'),
        out: OUT,
        setup: path.join(__dirname, 'realChain.setup.js'),
    })
    const server = await serve(OUT)
    const port = server.address().port
    const { chromium } = require('playwright')
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, reducedMotion: 'no-preference' })
    page.on('pageerror', e => console.log('PAGE ERROR:', e.message))
    await page.goto(`http://127.0.0.1:${port}/`)
    await page.waitForFunction('window.__ready === true')
    await sleep(150)

    console.log('\n--- mode: REAL chain (container → wrapper → card), comment delivered by watcher ---\n')

    // The slot loads its first comment. That is not an arrival — it was already there.
    await page.evaluate(() => window.__emitComment(window.__texts.FIRST))
    await sleep(120)
    const loaded = await page.evaluate(() => window.__measure())
    check('the real chain mounts a card at all', loaded.present, loaded.present ? '' : 'still showing the skeleton')
    check(
        'the first comment shows without animating',
        loaded.present && !loaded.outgoingPresent && loaded.incomingY === 0,
        `y=${loaded.incomingY}`
    )

    /**
     * The arrival. Captured on the FIRST painted frame, because that is where the earlier
     * passive-effect flash lived and where a missing arm shows as "already finished".
     */
    const firstPaint = await page.evaluate(
        () =>
            new Promise(resolve => {
                window.__emitComment(window.__texts.ARRIVED)
                requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.__measure())))
            })
    )

    const frames = [firstPaint]
    for (let i = 0; i < 24; i++) {
        await sleep(25)
        frames.push(await page.evaluate(() => window.__measure()))
    }
    const at = key => frames.map(f => f[key])
    console.log(
        '    outgoing y   :',
        at('outgoingY')
            .map(v => (v === null ? '-' : v))
            .join(' ')
    )
    console.log(
        '    incoming y   :',
        at('incomingY')
            .map(v => (v === null ? '-' : v))
            .join(' ')
    )
    console.log('    outgoing text:', JSON.stringify((firstPaint.outgoingText || '').slice(0, 42)))
    console.log('    incoming text:', JSON.stringify((firstPaint.incomingText || '').slice(0, 42)))

    // THE regression: through the real chain, a comment that arrives must animate at all.
    check(
        'a comment arriving through the real chain mounts an outgoing row',
        frames.some(f => f.outgoingPresent),
        frames.some(f => f.outgoingPresent) ? '' : 'the card was never told an arrival happened'
    )
    // THE second defect: the row leaving must be the OLD comment, not a copy of the new one.
    const outgoingTexts = at('outgoingText').filter(Boolean)
    check(
        'the row rolling away carries the PREVIOUS comment',
        outgoingTexts.length > 0 && outgoingTexts.every(t => t.includes('already on screen before anything arrived')),
        outgoingTexts.length ? JSON.stringify(outgoingTexts[0].slice(0, 60)) : 'no outgoing row at all'
    )
    check(
        'the row rolling in carries the new comment',
        at('incomingText')
            .filter(Boolean)
            .every(t => t.includes('moved the three overdue tasks')),
        ''
    )
    // The roll actually travels, rather than jumping between two states.
    const outgoingPositions = new Set(at('outgoingY').filter(v => v !== null))
    check(
        'the roll advances through many positions',
        outgoingPositions.size >= 5,
        `${outgoingPositions.size} distinct positions, ${Math.min(...outgoingPositions)}px → ${Math.max(...outgoingPositions)}px`
    )
    check(
        'it rolls upward and clears the card',
        Math.min(...outgoingPositions) <= -(loaded.cardHeight - 1),
        `min ${Math.min(...outgoingPositions)}px, card ${loaded.cardHeight}px`
    )
    const cardHeights = new Set(at('cardHeight').filter(Boolean))
    check(
        'the card height is constant through the real arrival',
        cardHeights.size === 1,
        `heights seen: ${[...cardHeights].join(', ')}`
    )

    await sleep(600)
    const settled = await page.evaluate(() => window.__measure())
    check(
        'it settles with only the new comment',
        !settled.outgoingPresent && settled.incomingY === 0,
        `y=${settled.incomingY}`
    )

    /**
     * The remount case — a comment landing in a DIFFERENT chat, which is the ordinary shape for a
     * heartbeat or a VM result. The subtree is replaced, so the card is born already showing the new
     * comment: it must roll in alone rather than invent a departure that never happened.
     */
    await page.evaluate(() => window.__setChat('chat-2'))
    await sleep(60)
    const remountPaint = await page.evaluate(
        () =>
            new Promise(resolve => {
                window.__emitComment('A completely different answer, in another thread entirely.')
                requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.__measure())))
            })
    )
    const remountFrames = [remountPaint]
    for (let i = 0; i < 12; i++) {
        await sleep(25)
        remountFrames.push(await page.evaluate(() => window.__measure()))
    }
    check(
        'a comment arriving across a remount rolls in with no phantom copy leaving',
        remountFrames.every(f => !f.outgoingPresent),
        remountFrames.some(f => f.outgoingPresent)
            ? JSON.stringify((remountFrames.find(f => f.outgoingText) || {}).outgoingText || '').slice(0, 60)
            : ''
    )
    check(
        'the remounted card still announces the arrival by rolling in',
        remountFrames.some(f => f.incomingY > 1),
        `max incoming offset ${Math.max(...remountFrames.map(f => f.incomingY || 0))}px`
    )

    await browser.close()
    server.close()

    const failures = results.filter(r => !r.ok)
    console.log(`\n${results.length - failures.length}/${results.length} checks passed`)
    process.exit(failures.length ? 1 : 0)
}

async function main() {
    if (process.argv.includes('--real-chain')) return realChainMain()
    const reduceMotion = process.argv.includes('--reduce-motion')
    const compact = process.argv.includes('--compact')
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
    // Let the reduce-motion preference resolve before anything is armed.
    await sleep(150)

    console.log(
        `\n--- mode: ${reduceMotion ? 'prefers-reduced-motion: reduce' : 'normal motion'}${compact ? ' / compact chip' : ' / full card'} ---\n`
    )

    if (compact) await page.evaluate(() => window.__setCompact(true))
    await sleep(60)

    const expectedHeight = await page.evaluate(() => window.__expectedCardHeight)
    const atRest = await page.evaluate(() => window.__measure())

    // Before anything arrives, the card must already be complete and in place. A hook seeded at the
    // START of its roll would leave every first paint, reload and navigation rolled off the top.
    check('the card is mounted', atRest.present, '')
    check('at rest the comment sits at the top of the card', atRest.incomingY === 0, `y=${atRest.incomingY}`)
    check('at rest there is no outgoing row', !atRest.outgoingPresent, '')
    if (!compact) {
        check(
            'at rest the card is exactly its reserved height',
            atRest.cardHeight === expectedHeight,
            `${atRest.cardHeight}px, expected ${expectedHeight}px`
        )
    }

    /**
     * The clip has to be INSIDE the card, not on it: the unread badge sits at `top/right: -5`, so a
     * card that clipped its own overflow would cut the badge's corner off.
     */
    check(
        'the roll is clipped by a viewport inside the card',
        atRest.viewportOverflow === 'hidden' && parseFloat(atRest.viewportRadius) > 0,
        `viewport overflow=${atRest.viewportOverflow} radius=${atRest.viewportRadius}`
    )
    check(
        'the card itself does not clip, so the badge can overhang it',
        atRest.cardOverflow !== 'hidden',
        `card overflow=${atRest.cardOverflow}`
    )
    check(
        'the badge overhangs the card, unclipped',
        atRest.badgePresent && atRest.badgeAboveCard > 0,
        `${atRest.badgeAboveCard}px above the card top`
    )

    const restingHeight = atRest.cardHeight

    /**
     * The arrival, and the FIRST painted frame of it captured before any sampling gap.
     *
     * This is what caught the one real defect in this feature: the animation's values were reset in
     * a passive effect, which runs after paint — so frame 0 of every arrival painted the FINISHED
     * state (the new comment already in place, the old one already gone) and only frame 1 jumped
     * back to the start of the roll. The answer appeared, then visibly fell back down to roll in
     * again. `requestAnimationFrame` puts this read in the same frame the arrival is painted in.
     */
    const firstPaint = await page.evaluate(
        () =>
            new Promise(resolve => {
                window.__arrive()
                requestAnimationFrame(() => resolve(window.__measure()))
            })
    )

    const SAMPLE_MS = 25
    const SAMPLES = 32
    const frames = []
    for (let i = 0; i < SAMPLES; i++) {
        frames.push({ t: i * SAMPLE_MS, ...(await page.evaluate(() => window.__measure())) })
        await sleep(SAMPLE_MS)
    }

    const at = key => frames.map(f => f[key])
    const spark = values => values.map(v => (v === null || v === undefined ? '-' : v)).join(' ')

    console.log('    card h x w   :', `${restingHeight} x ${atRest.cardWidth}`)
    console.log('    outgoing y   :', spark(at('outgoingY')))
    console.log('    incoming y   :', spark(at('incomingY')))
    console.log('    out visible  :', spark(at('outgoingVisible')))
    console.log('    in visible   :', spark(at('incomingVisible')))
    console.log('    badge width  :', spark(at('badgeWidth')))
    console.log('    card height  :', spark(at('cardHeight')))

    /**
     * ── the card never moves ─────────────────────────────────────────────────────────────────────
     *
     * Asserted first and over EVERY frame, because it is the contract the flourish is a guest
     * inside. It is also why the roll is clipped by a viewport that fills the card rather than by
     * resizing anything.
     */
    const heights = new Set(at('cardHeight').filter(h => h !== null && h !== undefined))
    check(
        'the card height is constant for the whole run',
        heights.size === 1 && heights.has(restingHeight),
        `heights seen: ${[...heights].join(', ')}`
    )

    if (reduceMotion) {
        /**
         * Under reduced motion the contract INVERTS: the finished frame is rendered directly. There
         * is nothing to preserve statically — "this is new" is already carried by the unread badge,
         * which is a static element — so the correct amount of motion is none.
         */
        check(
            'reduced motion — no outgoing row is ever mounted',
            frames.every(f => !f.outgoingPresent),
            ''
        )
        check(
            'reduced motion — the comment never travels',
            frames.every(f => f.incomingY === 0),
            `offsets seen: ${[...new Set(at('incomingY'))].join(', ')}`
        )
        const badgeWidths = new Set(at('badgeWidth').filter(w => w !== null))
        check(
            'reduced motion — the badge never pops',
            badgeWidths.size === 1,
            `widths seen: ${[...badgeWidths].join(', ')}`
        )
        check(
            'reduced motion — the new comment is shown immediately',
            frames[0].incomingText && frames[0].incomingText.includes('moved the three overdue tasks'),
            ''
        )
    } else {
        /**
         * ── beat 0: no flash ─────────────────────────────────────────────────────────────────────
         *
         * The very first painted frame must be the START of the roll — the old comment still in
         * place, the new one still below the card — never the finished state. Anything else is the
         * new comment appearing and then falling back down to roll in, which reads as a stutter and
         * is worse than no animation at all.
         */
        check(
            'beat 0 — the first painted frame is the START of the roll, not the end',
            firstPaint.outgoingPresent && firstPaint.outgoingY > -2 && firstPaint.incomingY >= restingHeight - 2,
            `outgoing y=${firstPaint.outgoingY}, incoming y=${firstPaint.incomingY}, card ${restingHeight}px`
        )
        check(
            'beat 0 — the new comment is not painted in place before it rolls in',
            firstPaint.incomingVisible !== null && firstPaint.incomingVisible < 0.1,
            `incoming visible fraction ${firstPaint.incomingVisible}`
        )

        // ── beat 1: the roll ─────────────────────────────────────────────────────────────────────
        const rolling = frames.filter(f => f.outgoingPresent)
        check('beat 1 — an outgoing row is mounted', rolling.length > 0, `${rolling.length}/${SAMPLES} frames`)

        if (rolling.length) {
            /**
             * The row leaving must be the OLD comment and the row arriving the NEW one. Nothing
             * about the geometry can prove this — a roll that animated the same text twice would
             * pass every positional check — so the text itself is read out of each row.
             */
            check(
                'beat 1 — the row rolling away is the comment that WAS on screen',
                rolling.every(f => f.outgoingText && f.outgoingText.includes('already on screen')),
                `outgoing: "${(rolling[0].outgoingText || '').slice(0, 48)}…"`
            )
            check(
                'beat 1 — the row rolling in is the comment that just arrived',
                rolling.every(f => f.incomingText && f.incomingText.includes('moved the three overdue tasks')),
                `incoming: "${(rolling[0].incomingText || '').slice(0, 48)}…"`
            )

            const outs = rolling.map(f => f.outgoingY)
            const ins = rolling.map(f => f.incomingY)

            check(
                'beat 1 — the old comment starts in place and the new one a full card below',
                Math.max(...outs) > -2 && Math.max(...ins) >= restingHeight - 2,
                `outgoing max ${Math.max(...outs)}px, incoming max ${Math.max(...ins)}px of ${restingHeight}px`
            )
            check(
                'beat 1 — it rolls UPWARD: the old comment never travels down',
                outs.every(y => y <= 0.5) && ins.every(y => y >= -0.5),
                `outgoing ${Math.min(...outs)}px → ${Math.max(...outs)}px`
            )
            check(
                'beat 1 — the roll actually advances (not a single frame jump)',
                new Set(outs).size >= 4,
                `${new Set(outs).size} distinct positions, ${Math.min(...outs)}px → ${Math.max(...outs)}px`
            )
            /**
             * THE contract of a ticker: the two rows stay exactly one card apart, so no band of
             * empty card is ever visible between them. That is what one shared `Animated.Value`
             * buys, and this is where it is actually observable — in painted pixels.
             */
            const gaps = rolling.map(f => Number((f.incomingY - f.outgoingY).toFixed(2)))
            check(
                'beat 1 — the two rows stay exactly one card apart, so no gap opens',
                gaps.every(gap => Math.abs(gap - restingHeight) < 1.5),
                `gaps seen: ${Math.min(...gaps)}px … ${Math.max(...gaps)}px, card ${restingHeight}px`
            )
            check(
                'beat 1 — the old comment leaves the card completely',
                Math.min(...outs) <= -restingHeight + 2,
                `min ${Math.min(...outs)}px, card ${restingHeight}px`
            )

            // ── beat 2: the clip ─────────────────────────────────────────────────────────────────
            const outside = await page.evaluate(() => window.__paintedOutsideCard())
            check(
                'beat 2 — the roll is clipped: neither row paints outside the card',
                rolling.every(f => f.outgoingVisible <= 1.001 && f.incomingVisible <= 1.001),
                `max visible fractions out=${Math.max(...rolling.map(f => f.outgoingVisible))} in=${Math.max(...rolling.map(f => f.incomingVisible))}`
            )
            check(
                'beat 2 — the two rows together never over-fill the card',
                rolling.every(f => f.outgoingVisible + f.incomingVisible <= 1.05),
                `max combined ${Math.max(...rolling.map(f => f.outgoingVisible + f.incomingVisible)).toFixed(3)}`
            )
            console.log('    painted outside card at rest:', JSON.stringify(outside))

            // ── beat 3: the badge ────────────────────────────────────────────────────────────────
            const badgeWidths = at('badgeWidth').filter(w => w !== null)
            check(
                'beat 3 — the badge pops from smaller to full size',
                new Set(badgeWidths).size >= 3 && Math.min(...badgeWidths) < Math.max(...badgeWidths),
                `${Math.min(...badgeWidths)}px → ${Math.max(...badgeWidths)}px`
            )
            /**
             * The badge is `position: absolute` against the card's corner and a react-native-web
             * `View` is `position: relative` by default, so animating it through a WRAPPER would
             * silently re-anchor it to a zero-sized box. It is animated through its own style for
             * that reason, and this is the assertion that would catch a regression back to one.
             */
            const finalBadge = frames[frames.length - 1]
            check(
                'beat 3 — the badge stays pinned to the card corner throughout',
                finalBadge.badgePosition === 'absolute' && Math.abs(finalBadge.badgeRight - 5) < 1.5,
                `position=${finalBadge.badgePosition}, right overhang ${finalBadge.badgeRight}px (expected ~5)`
            )
            check(
                'beat 3 — the badge is never clipped by the roll viewport',
                frames.every(f => f.badgePresent && f.badgeAboveCard > 0),
                `min above card ${Math.min(...at('badgeAboveCard'))}px`
            )
        }
    }

    // ── beat 4: rest ─────────────────────────────────────────────────────────────────────────────
    await sleep(500)
    const settled = await page.evaluate(() => window.__measure())
    check('beat 4 — the outgoing row is unmounted', !settled.outgoingPresent, '')
    check(
        'beat 4 — the new comment settles exactly where the old one was',
        settled.incomingY === 0,
        `y=${settled.incomingY}`
    )
    check(
        'beat 4 — the new comment is what is left on screen',
        settled.incomingText && settled.incomingText.includes('moved the three overdue tasks'),
        ''
    )
    check(
        'beat 4 — the card is still exactly its resting height',
        settled.cardHeight === restingHeight,
        `${settled.cardHeight}px, expected ${restingHeight}px`
    )
    check(
        'beat 4 — the card has not drifted',
        Math.abs(settled.cardTop - atRest.cardTop) < 0.5,
        `top moved ${(settled.cardTop - atRest.cardTop).toFixed(1)}px`
    )

    // A finished roll must STAY finished: nothing may re-arm it without a new arrival.
    await sleep(700)
    const later = await page.evaluate(() => window.__measure())
    check('beat 4 — it does not roll again on its own', !later.outgoingPresent && later.incomingY === 0, '')

    // The comment is already stored and already interactive — nothing is held for the animation.
    await page.evaluate(() => document.querySelector('[data-testid="last-comment-card"]').click())
    const pressed = await page.evaluate(() => window.__pressed || 0)
    check('the card is still tappable after an arrival', pressed > 0, `presses=${pressed}`)

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
