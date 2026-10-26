/**
 * AT-2873 — wiki bullet lists are laid out like note bullet lists.
 *
 * Renders the REAL `WikiMarkdown` and a REAL notes list (Quill 2's list DOM + the notes editor's
 * `toolbar-styles.css`) at a desktop and a phone width and measures, per list item:
 *   - where the marker glyph is painted,
 *   - where the first line of text starts,
 *   - where every wrapped line of that item starts (via Range.getClientRects).
 *
 * Asserted contract:
 *   1. Every wrapped line of an item starts exactly where its first line starts (hanging indent),
 *      never under the marker.
 *   2. The gap between marker and text is the SAME for every item at one depth — it may not depend
 *      on how long the item is or how many source chips it carries (the reported defect).
 *   3. At the top level and one level down, text starts where the notes editor starts it, and the
 *      bullet is painted where notes paints it (±1px).
 *   4. Nested lists step right by the notes editor's indent step.
 *   5. Ordered markers (incl. a two-digit "10.") never shrink, overlap the text or move the text.
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

    const notesRoot = document.querySelector('[data-testid="notes"] .ql-editor')
    const notesLeft = notesRoot.getBoundingClientRect().left
    const notes = [...notesRoot.querySelectorAll('li')].map(li => {
        const ui = li.querySelector('.ql-ui')
        // The bullet is a ::before pseudo-element; measure it by its computed box.
        const before = getComputedStyle(ui, '::before')
        const uiRect = ui.getBoundingClientRect()
        const width = parseFloat(before.width)
        const marginLeft = parseFloat(before.marginLeft)
        // Paint the marker into a probe with the same font to find its advance width. Quill's
        // ordered content carries a trailing space ("1. "); the visible marker ends before it.
        const ordered = li.getAttribute('data-list') === 'ordered'
        const content = ordered ? `${[...li.parentElement.children].indexOf(li) + 1}.` : '•'
        const probe = document.createElement('span')
        probe.style.whiteSpace = 'pre'
        probe.textContent = ordered ? `${content} ` : content
        probe.style.font = before.font
        probe.style.letterSpacing = before.letterSpacing
        document.body.appendChild(probe)
        const fullWidth = probe.getBoundingClientRect().width
        probe.textContent = content
        const glyphWidth = probe.getBoundingClientRect().width
        probe.remove()
        const boxLeft = uiRect.left + marginLeft
        // text-align: right inside a 1.2em box — unless the content is wider, then it starts at the box.
        const contentRight = Math.max(boxLeft + width, boxLeft + fullWidth)
        const glyphRight = contentRight - (fullWidth - glyphWidth)
        return {
            marker: content,
            depth: Number((li.className.match(/ql-indent-(\d)/) || [0, 0])[1]),
            glyphLeft: glyphRight - glyphWidth - notesLeft,
            glyphRight: glyphRight - notesLeft,
            lines: lineStarts(li.querySelector('.notes-text')).map(x => x - notesLeft),
        }
    })
    return { wiki, notes }
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
            const { wiki, notes } = await page.evaluate(measure)
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
            console.log(`\n== width ${width}\n-- wiki\n${report(wiki)}\n-- notes\n${report(notes)}`)

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
                    'bullets and text sit where the notes editor puts them',
                    () => {
                        for (const depth of [0, 1, 2]) {
                            const w = wiki.find(i => i.depth === depth && i.marker === '•')
                            const n = notes.find(i => i.depth === depth && i.marker === '•')
                            near(w.lines[0], n.lines[0], `text start d${depth} vs notes`)
                            near(w.glyphRight, n.glyphRight, `bullet right edge d${depth} vs notes`)
                        }
                    },
                ],
                [
                    'ordered markers keep their width and never touch the text',
                    () => {
                        const ordered = wiki.filter(i => /\d+\./.test(i.marker))
                        const notesOrdered = notes.filter(i => /\d+\./.test(i.marker))
                        assert.equal(ordered.length, 10)
                        near(ordered[0].lines[0], notesOrdered[0].lines[0], 'ordered text start vs notes')
                        near(ordered[0].glyphRight, notesOrdered[0].glyphRight, 'ordered "1." right edge vs notes')
                        ordered.forEach(i => near(i.lines[0], ordered[0].lines[0], `ordered text start ${i.marker}`))
                        ordered.forEach(i =>
                            assert.ok(i.glyphRight <= i.lines[0] - 3, `${i.marker} marker overlaps text`)
                        )
                        ordered.forEach(i =>
                            assert.ok(i.glyphLeft >= -TOLERANCE, `${i.marker} marker leaves the column`)
                        )
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
