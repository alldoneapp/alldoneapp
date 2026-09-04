/**
 * AT-2511 browser-level test — the last-comment arrival motion, actually painting.
 *
 * A new comment landing in the assistant line's "Last comment" slot used to swap its text
 * silently, which is indistinguishable from a re-render — so the moment the assistant answers, the
 * payoff of the whole line, had no shape at all. This checks the shape it now has, frame by frame:
 *
 *   1. RISE   the content fades in from transparent and travels UP into its resting place
 *   2. GLOW   an accent band crosses the card and leaves it, clipped to the card's rounded rect
 *   3. POP    the unread badge grows to full size — and stays pinned to the card's corner
 *   4. REST   everything settles at the finished frame and the band is gone
 *
 * And the non-negotiable throughout: the card's height NEVER changes. That fixed
 * `LAST_COMMENT_PREVIEW_HEIGHT` is what keeps the assistant line from reflowing (AT-2344/AT-2504),
 * and an animation that broke it would be a regression well beyond a missing flourish.
 *
 * Neither of the jest suites can answer any of this: `Animated.timing` is a no-op stub there, and
 * jsdom computes no layout, so the band (gated on a MEASURED width by design) never renders.
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

    // Before anything arrives, the card must already be complete. A hook seeded at the START of its
    // animation would leave every first paint, reload and navigation invisible.
    check('the card is mounted', atRest.present, '')
    check('at rest the content is fully opaque', atRest.contentOpacity === 1, `opacity=${atRest.contentOpacity}`)
    check('at rest there is no band', !atRest.bandPresent, '')
    if (!compact) {
        check(
            'at rest the card is exactly its reserved height',
            atRest.cardHeight === expectedHeight,
            `${atRest.cardHeight}px, expected ${expectedHeight}px`
        )
    }

    const restingContentTop = atRest.contentTop
    const restingHeight = atRest.cardHeight

    // The arrival.
    await page.evaluate(() => window.__arrive())

    // ~600ms of motion, sampled every 25ms so each beat gets a dozen frames of its own.
    const SAMPLE_MS = 25
    const SAMPLES = 40
    const frames = []
    for (let i = 0; i < SAMPLES; i++) {
        frames.push({ t: i * SAMPLE_MS, ...(await page.evaluate(() => window.__measure())) })
        await sleep(SAMPLE_MS)
    }

    const at = key => frames.map(f => f[key])
    const spark = values => values.map(v => (v === null || v === undefined ? '-' : v)).join(' ')

    console.log('    card h x w  :', `${restingHeight} x ${atRest.cardWidth}`)
    console.log('    content op  :', spark(at('contentOpacity')))
    console.log(
        '    content dy  :',
        spark(frames.map(f => (f.contentTop === null ? null : +(f.contentTop - restingContentTop).toFixed(1))))
    )
    console.log('    band left   :', spark(at('bandLeft')))
    console.log('    badge width :', spark(at('badgeWidth')))
    console.log('    card height :', spark(at('cardHeight')))

    /**
     * ── the card never moves ─────────────────────────────────────────────────────────────────────
     *
     * Asserted first and over EVERY frame, including the resting ones, because it is the contract
     * the flourish is a guest inside. The whole design puts the motion on the card's CONTENTS for
     * exactly this reason: fading or scaling the card itself would make the slot a hole, and the
     * line below it would appear to move.
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
            'reduced motion — the content never fades',
            at('contentOpacity').every(o => o === 1),
            `opacities seen: ${[...new Set(at('contentOpacity'))].join(', ')}`
        )
        check(
            'reduced motion — the content never travels',
            frames.every(f => f.contentTop === null || Math.abs(f.contentTop - restingContentTop) < 0.5),
            ''
        )
        check(
            'reduced motion — no band is ever painted',
            frames.every(f => !f.bandPresent),
            ''
        )
        const badgeWidths = new Set(at('badgeWidth').filter(w => w !== null))
        check(
            'reduced motion — the badge never pops',
            badgeWidths.size === 1,
            `widths seen: ${[...badgeWidths].join(', ')}`
        )
    } else {
        // ── beat 1: the rise ─────────────────────────────────────────────────────────────────────
        const opacities = at('contentOpacity').filter(o => o !== null)
        check(
            'beat 1 — the content starts transparent',
            Math.min(...opacities) < 0.35,
            `min opacity ${Math.min(...opacities)}`
        )
        check(
            'beat 1 — the content reaches full opacity',
            Math.max(...opacities) === 1,
            `max opacity ${Math.max(...opacities)}`
        )
        check(
            'beat 1 — the opacity actually advances (not a single frame jump)',
            new Set(opacities).size >= 4,
            `${new Set(opacities).size} distinct opacities`
        )

        const offsets = frames.filter(f => f.contentTop !== null).map(f => f.contentTop - restingContentTop)
        check(
            'beat 1 — the content starts BELOW its resting place',
            Math.max(...offsets) > 3,
            `max offset +${Math.max(...offsets).toFixed(1)}px`
        )
        check(
            'beat 1 — and travels up to exactly where it rests',
            Math.abs(offsets[offsets.length - 1]) < 0.5,
            `final offset ${offsets[offsets.length - 1].toFixed(1)}px`
        )
        check(
            'beat 1 — it only ever rises (never overshoots above its place)',
            Math.min(...offsets) > -0.5,
            `min offset ${Math.min(...offsets).toFixed(1)}px`
        )

        // ── beat 2: the glow ─────────────────────────────────────────────────────────────────────
        const banded = frames.filter(f => f.bandPresent)
        check('beat 2 — the band is painted', banded.length > 0, `${banded.length}/${SAMPLES} frames`)

        if (banded.length) {
            const lefts = banded.map(f => f.bandLeft)
            const bandWidth = banded[0].bandWidth
            check(
                'beat 2 — the band travels across the card',
                new Set(lefts).size >= 4,
                `${new Set(lefts).size} distinct positions, ${Math.min(...lefts)}px → ${Math.max(...lefts)}px`
            )
            check(
                'beat 2 — it starts fully off the left edge',
                Math.min(...lefts) <= -bandWidth + 2,
                `min left ${Math.min(...lefts)}px, band ${bandWidth}px`
            )
            check(
                'beat 2 — and leaves past the right edge, so no accent is parked on the card',
                Math.max(...lefts) >= atRest.cardWidth - 2,
                `max left ${Math.max(...lefts)}px of ${atRest.cardWidth}px`
            )
            check(
                'beat 2 — the band is a gradient, never a solid rectangle',
                banded[0].bandImage.includes('gradient'),
                banded[0].bandImage.slice(0, 60)
            )
            /**
             * The assertion that caught the real defect on this harness's first green run: the
             * stops were built with `hexColorToRGBa(color, 0)`, whose alpha branch is `if (alpha)`
             * — so `0` fell through to an OPAQUE `rgb(...)` and the "soft band" was a hard accent
             * rectangle with a slightly different middle. jsdom reports no computed gradient at
             * all, so no jest suite could ever have seen it.
             */
            const stops = banded[0].bandImage.match(/rgba?\([^)]*\)/g) || []
            check(
                'beat 2 — the band fades out at BOTH edges (no hard accent rectangle)',
                stops.length >= 3 &&
                    /rgba\([^)]*,\s*0\)/.test(stops[0]) &&
                    /rgba\([^)]*,\s*0\)/.test(stops[stops.length - 1]),
                `stops: ${stops.join(' | ')}`
            )
            check(
                'beat 2 — and is only faintly tinted at its peak',
                stops.some(stop => {
                    const alpha = Number((stop.match(/,\s*([0-9.]+)\)$/) || [])[1])
                    return alpha > 0 && alpha <= 0.3
                }),
                `stops: ${stops.join(' | ')}`
            )
            check(
                'beat 2 — the band is scoped to this card, not the viewport',
                bandWidth < atRest.cardWidth,
                `${bandWidth}px of ${atRest.cardWidth}px`
            )
            check(
                'beat 2 — the band is retired once it has left',
                !frames[frames.length - 1].bandPresent,
                `last frame bandPresent=${frames[frames.length - 1].bandPresent}`
            )
        }

        // ── beat 3: the badge ────────────────────────────────────────────────────────────────────
        const badgeWidths = at('badgeWidth').filter(w => w !== null)
        check(
            'beat 3 — the badge pops from smaller to full size',
            new Set(badgeWidths).size >= 3 && Math.min(...badgeWidths) < Math.max(...badgeWidths),
            `${Math.min(...badgeWidths)}px → ${Math.max(...badgeWidths)}px`
        )
        /**
         * The badge is `position: absolute` against the card's corner and a react-native-web `View`
         * is `position: relative` by default, so animating it through a WRAPPER would silently
         * re-anchor it to a zero-sized box. It is animated through its own style for that reason,
         * and this is the assertion that would catch a regression back to a wrapper.
         */
        const finalBadge = frames[frames.length - 1]
        check(
            'beat 3 — the badge stays pinned to the card corner throughout',
            finalBadge.badgePosition === 'absolute' && Math.abs(finalBadge.badgeRight - 5) < 1.5,
            `position=${finalBadge.badgePosition}, right overhang ${finalBadge.badgeRight}px (expected ~5)`
        )
    }

    // ── beat 4: rest ─────────────────────────────────────────────────────────────────────────────
    await sleep(400)
    const settled = await page.evaluate(() => window.__measure())
    check(
        'beat 4 — the content settles fully opaque',
        settled.contentOpacity === 1,
        `opacity=${settled.contentOpacity}`
    )
    check('beat 4 — no band is left behind', !settled.bandPresent, '')
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
