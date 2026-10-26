/**
 * AT-2873 — wiki lists: markers on the content edge, comfortable spacing, hanging wrapped lines.
 *
 * Renders the REAL `WikiMarkdown` (with the app shell's global reset and Roboto) at a desktop and a
 * phone width and measures, per list item:
 *   - where the marker glyph is painted,
 *   - where the first line of text starts,
 *   - where every wrapped line of that item starts (via Range.getClientRects),
 * and where the heading and paragraph text before the list start (the content edge).
 *
 * Asserted contract:
 *   1. Every wrapped line of an item starts exactly where its first line starts (hanging indent),
 *      never under the marker.
 *   2. The gap between marker and text is the SAME for every item at one depth — it may not depend
 *      on how long the item is or how many source chips it carries (the original report).
 *   3. Top-level bullets sit on the content edge of the heading and paragraph — the whole list is
 *      not inset (the follow-up report: MR 718 had copied the notes editor's ~26px inset) — with a
 *      comfortable 10–18px gap between bullet and text.
 *   4. A nested list starts its bullets under its parent item's text.
 *   5. Ordered markers (incl. a two-digit "10.") are right-aligned, the widest one on the content
 *      edge, and never shrink, overlap the text or move the text.
 *   6. Source chips still render inside the item text.
 *
 * Requirements (not part of CI's Jest jobs):
 *   nvm use 22
 *   (cd web-bundler && npm install)
 *   npx playwright install chromium
 * Usage:
 *   node browser-tests/at2873/run.js [--webkit] [--no-build]   # PLAYWRIGHT_MODULE may point at a playwright install
 * Screenshots land in browser-tests/at2873/.build/.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
// `--webkit` runs the same checks in WebKit (Safari's engine); the default is Chromium.
const engine = process.argv.includes('--webkit') ? playwright.webkit : playwright.chromium

const root = path.resolve(__dirname, '../..')
const output = path.join(__dirname, '.build')
const WIDTHS = [640, 300]
const TOLERANCE = 1

if (!process.argv.includes('--no-build')) {
    execFileSync(
        path.join(root, 'web-bundler/node_modules/.bin/webpack'),
        [
            '--config',
            path.join(root, 'browser-tests/webpack.harness.js'),
            '--mode',
            'development',
            '--env',
            `harnessEntry=${path.join(__dirname, 'harness.entry.js')}`,
            '--env',
            `harnessOut=${output}`,
        ],
        { cwd: path.join(root, 'web-bundler'), stdio: 'inherit' }
    )
}

const html =
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    // The app shell's global reset (web-bundler/index.html) — without it `flex: 1` keeps a 0% basis and
    // the reported defect cannot happen, which is why a harness without it measures a healthy list.
    '<style>*{flex-basis:auto !important}html,body,#root{margin:0;padding:0;background:#fff}</style><div id="root"></div><script src="/harness.js"></script>'

function measure() {
    const lineStarts = element => {
        const range = document.createRange()
        range.selectNodeContents(element)
        const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0)
        // Group rects into visual lines by vertical overlap; a line starts at its leftmost rect.
        const lines = []
        rects
            .sort((a, b) => a.top - b.top || a.left - b.left)
            .forEach(rect => {
                const line = lines.find(
                    l => Math.min(l.bottom, rect.bottom) - Math.max(l.top, rect.top) > rect.height / 2
                )
                if (line) {
                    line.left = Math.min(line.left, rect.left)
                    line.bottom = Math.max(line.bottom, rect.bottom)
                } else lines.push({ top: rect.top, bottom: rect.bottom, left: rect.left })
            })
        return lines.map(l => l.left)
    }
    const glyphBox = element => {
        const range = document.createRange()
        range.selectNodeContents(element)
        const rect = range.getBoundingClientRect()
        return { left: rect.left, right: rect.right, top: rect.top }
    }

    const wikiRoot = document.querySelector('[data-testid="wiki-markdown"]')
    const wikiLeft = wikiRoot.getBoundingClientRect().left
    const markers = [...wikiRoot.querySelectorAll('[data-testid="wiki-list-marker"]')]
    const wiki = markers.map(marker => {
        const text = marker.parentElement.querySelector('[data-testid="wiki-list-text"]')
        let depth = 0
        for (let node = marker.parentElement; node && node !== wikiRoot; node = node.parentElement) {
            if (node.getAttribute('data-testid') === 'wiki-list') depth++
        }
        const glyph = glyphBox(marker)
        return {
            marker: marker.textContent,
            depth: depth - 1,
            glyphLeft: glyph.left - wikiLeft,
            glyphRight: glyph.right - wikiLeft,
            lines: lineStarts(text).map(x => x - wikiLeft),
        }
    })

    // The content edge: where the heading and the paragraph before the lists start their text.
    const textStartOf = needle => {
        const walker = document.createTreeWalker(wikiRoot, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (node.textContent.includes(needle)) return Math.min(...lineStarts(node.parentElement)) - wikiLeft
        }
        return NaN
    }
    const edges = { heading: textStartOf('Mercedes B'), paragraph: textStartOf('Paragraph before the list') }

    // Source chips: each must sit inside its item's text column.
    const chips = [...wikiRoot.querySelectorAll('[data-testid^="wiki-source-"]')].map(chip => {
        const item = chip.closest('[data-testid="wiki-list-text"]')
        return {
            left: chip.getBoundingClientRect().left - wikiLeft,
            width: chip.getBoundingClientRect().width,
            label: chip.textContent,
            textLeft: item ? Math.min(...lineStarts(item)) - wikiLeft : NaN,
        }
    })
    return { wiki, edges, chips }
}

const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://harness').pathname
    if (pathname === '/') {
        res.setHeader('Content-Type', 'text/html')
        return res.end(html)
    }
    // The bundle plus the font files webpack emitted next to it.
    const file = path.join(output, path.normalize(pathname).replace(/^([/\\])+/, ''))
    if (!file.startsWith(output) || !fs.existsSync(file)) {
        res.statusCode = 404
        return res.end()
    }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : 'font/ttf')
    res.end(fs.readFileSync(file))
})

const near = (actual, expected, message) =>
    assert.ok(
        Math.abs(actual - expected) <= TOLERANCE,
        `${message}: expected ${expected.toFixed(1)}, got ${actual.toFixed(1)}`
    )

;(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const browser = await engine.launch({ headless: true })
    let failures = 0
    try {
        for (const width of WIDTHS) {
            const page = await browser.newPage({ viewport: { width: width + 32, height: 1400 } })
            const errors = []
            page.on('pageerror', error => errors.push(error.message))
            await page.goto(`http://127.0.0.1:${server.address().port}/?width=${width}`)
            await page.waitForFunction(() => window.__harnessReady)
            await page.waitForSelector('[data-testid="wiki-markdown"]')
            await page.evaluate(() => document.fonts && document.fonts.ready)
            await page.screenshot({ path: path.join(output, `wiki-${width}.png`), fullPage: true })
            const { wiki, edges, chips } = await page.evaluate(measure)
            assert.deepEqual(errors, [], 'page errors')
            const report = rows =>
                rows
                    .map(
                        r =>
                            `   d${r.depth} ${(r.marker || '•').padStart(3)} glyph ${r.glyphLeft.toFixed(1)}–${r.glyphRight.toFixed(1)}  text ${r.lines
                                .map(x => x.toFixed(1))
                                .join(', ')}`
                    )
                    .join('\n')
            console.log(
                `\n== width ${width}  heading ${edges.heading.toFixed(1)}  paragraph ${edges.paragraph.toFixed(1)}\n${report(wiki)}`
            )

            const checks = [
                [
                    'every wrapped line hangs under the first line of its item',
                    () => {
                        for (const item of wiki) {
                            assert.ok(item.lines.length >= 1, 'item has text')
                            item.lines.forEach((x, i) =>
                                near(x, item.lines[0], `${item.marker} d${item.depth} line ${i + 1}`)
                            )
                        }
                        assert.ok(
                            wiki.some(item => item.lines.length > 1),
                            'harness must contain wrapped items'
                        )
                    },
                ],
                [
                    'marker-to-text spacing is identical for every item at one depth',
                    () => {
                        for (const depth of [0, 1, 2]) {
                            const bullets = wiki.filter(i => i.depth === depth && i.marker === '•')
                            bullets.forEach(i => near(i.lines[0], bullets[0].lines[0], `bullet text start d${depth}`))
                            bullets.forEach(i => near(i.glyphLeft, bullets[0].glyphLeft, `bullet position d${depth}`))
                        }
                    },
                ],
                [
                    'top-level bullets sit on the heading/paragraph content edge, text a comfortable gap right of them',
                    () => {
                        near(edges.heading, 0, 'heading text start')
                        near(edges.paragraph, 0, 'paragraph text start')
                        const bullets = wiki.filter(i => i.depth === 0 && i.marker === '•')
                        assert.ok(bullets.length >= 4, 'harness must contain top-level bullets')
                        for (const bullet of bullets) {
                            near(bullet.glyphLeft, edges.paragraph, 'top-level bullet vs content edge')
                            const gap = bullet.lines[0] - bullet.glyphRight
                            assert.ok(gap >= 10 && gap <= 18, `bullet-to-text gap ${gap.toFixed(1)} not within 10–18px`)
                            assert.ok(bullet.lines[0] <= 24, `top-level text starts too far right (${bullet.lines[0]})`)
                        }
                    },
                ],
                [
                    'a nested list starts its bullets under its parent item text',
                    () => {
                        for (const depth of [1, 2]) {
                            const parent = wiki.find(i => i.depth === depth - 1 && i.marker === '•')
                            const child = wiki.find(i => i.depth === depth && i.marker === '•')
                            assert.ok(child, `harness must contain a depth-${depth} bullet`)
                            near(child.glyphLeft, parent.lines[0], `d${depth} bullet vs d${depth - 1} text`)
                            near(
                                child.lines[0] - child.glyphLeft,
                                parent.lines[0] - parent.glyphLeft,
                                `d${depth} marker-to-text spacing`
                            )
                        }
                    },
                ],
                [
                    'ordered markers are right-aligned, the widest on the content edge, and never touch the text',
                    () => {
                        const ordered = wiki.filter(i => /\d+\./.test(i.marker))
                        assert.equal(ordered.length, 10)
                        near(ordered[9].glyphLeft, edges.paragraph, '"10." vs content edge')
                        ordered.forEach(i => near(i.glyphRight, ordered[0].glyphRight, `${i.marker} right edge`))
                        ordered.forEach(i => near(i.lines[0], ordered[0].lines[0], `ordered text start ${i.marker}`))
                        ordered.forEach(i =>
                            assert.ok(i.glyphRight <= i.lines[0] - 4, `${i.marker} marker overlaps text`)
                        )
                        ordered.forEach(i =>
                            assert.ok(i.glyphLeft >= -TOLERANCE, `${i.marker} marker leaves the column`)
                        )
                    },
                ],
                [
                    'source chips render inside the item text',
                    () => {
                        const inList = chips.filter(chip => !Number.isNaN(chip.textLeft))
                        assert.ok(inList.length >= 8, `expected source chips in list items, got ${inList.length}`)
                        for (const chip of inList) {
                            assert.ok(chip.width > 20, `chip "${chip.label}" is not rendered`)
                            assert.ok(
                                chip.left >= chip.textLeft - TOLERANCE,
                                `chip "${chip.label}" sits under the marker`
                            )
                        }
                    },
                ],
            ]
            for (const [name, check] of checks) {
                try {
                    check()
                    console.log(`PASS [${width}] ${name}`)
                } catch (error) {
                    failures++
                    console.log(`FAIL [${width}] ${name}\n     ${error.message}`)
                }
            }
            await page.close()
        }
    } finally {
        await browser.close()
        server.close()
    }
    console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
    process.exit(failures ? 1 : 0)
})()
