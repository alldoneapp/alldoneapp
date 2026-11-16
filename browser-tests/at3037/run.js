// AT-3037: in the task comment popup the queued note ("In der Warteschlange …", Jetzt senden /
// Entfernen) sat inside the 24px author row; once its label wrapped it overflowed the row and lay
// over the comment text. Checks, in light and dark mode, at the screenshot's popup width and on
// phones, that the note has its own line between header and text, overlaps nothing, stays inside
// the card, keeps both actions visible and is not faded with the queued comment.
// PLAYWRIGHT_MODULE may point to an external install; no app dependency changes.
const path = require('path')
const fs = require('fs')
const http = require('http')
const assert = require('node:assert/strict')
const { execFileSync } = require('child_process')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = path.resolve(__dirname, '../..')
const output = path.join(__dirname, '.build')
const shots = path.join(__dirname, 'screenshots')

async function main() {
    if (!process.argv.includes('--skip-build'))
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
                `harnessSetup=${path.join(__dirname, 'setup.js')}`,
                '--env',
                `harnessOut=${output}`,
            ],
            { cwd: root, stdio: 'inherit' }
        )
    const server = http.createServer((req, res) => {
        if (req.url.startsWith('/harness.js')) {
            res.setHeader('Content-Type', 'application/javascript')
            res.end(fs.readFileSync(path.join(output, 'harness.js')))
        } else if (req.url.startsWith('/fonts/'))
            res.end(fs.readFileSync(path.join(output, 'fonts', path.basename(req.url))))
        else
            res.end(
                '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script defer src="/harness.js"></script>'
            )
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    fs.mkdirSync(shots, { recursive: true })
    let browser
    let failures = 0
    try {
        browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
        // 720px: the comment popup of the reported screenshot; 432px: a narrow popup; 320px: the
        // narrowest phone (small-screen navigation).
        for (const mode of ['light', 'dark'])
            for (const width of [720, 432, 320]) {
                const page = await browser.newPage({ viewport: { width, height: 800 } })
                const errors = []
                page.on('pageerror', error => errors.push(error.message))
                await page.goto(`http://127.0.0.1:${server.address().port}/?mode=${mode}&small=${width <= 432 ? 1 : 0}`)
                await page.waitForFunction(() => window.harnessReady)
                await page.evaluate(() => document.fonts.ready)
                await page.waitForTimeout(200)
                const result = await page.evaluate(() => {
                    const rect = node => node && node.getBoundingClientRect()
                    const opaque = node => {
                        for (let n = node; n; n = n.parentElement)
                            if (parseFloat(getComputedStyle(n).opacity) < 1) return false
                        return true
                    }
                    const out = { horizontalOverflow: document.documentElement.scrollWidth - innerWidth }
                    const list = document.getElementById('comment-list')
                    const headers = [...list.querySelectorAll('[data-testid="feed-comment-header"]')]
                    const ids = ['queued', 'pending', 'answer']
                    for (const [i, headerNode] of headers.entries()) {
                        // Each comment's outer row: the header's grandparent (row > body > header).
                        const wrapper = headerNode.parentElement.parentElement
                        wrapper.dataset.id = ids[i]
                        const card = rect(list)
                        const header = wrapper.querySelector('[data-testid="feed-comment-header"]')
                        // The text wrapper is new with the fix; before it, measure the text itself.
                        const content =
                            wrapper.querySelector('[data-testid="feed-comment-content"]') ||
                            wrapper.querySelector('[data-testid="comment-inline-text"]')
                        const status = wrapper.querySelector('[aria-live="polite"]')
                        const buttons = [...wrapper.querySelectorAll('[role="button"]')].map(node => {
                            const r = rect(node)
                            return {
                                label: node.textContent,
                                visible: r.width > 0 && r.left >= card.left - 0.5 && r.right <= card.right + 0.5,
                                opaque: opaque(node),
                                color: getComputedStyle(node.firstElementChild || node).color,
                            }
                        })
                        const overflowing = [...wrapper.querySelectorAll('*')]
                            .filter(node => {
                                const r = rect(node)
                                return r.width > 0 && r.right > card.right + 0.5
                            })
                            .map(node => (node.textContent || '').slice(0, 40))
                        out[wrapper.dataset.id] = {
                            header: rect(header).toJSON(),
                            content: rect(content).toJSON(),
                            status: status && rect(status).toJSON(),
                            statusInHeader: !!status && header.contains(status),
                            statusOpaque: status && opaque(status),
                            statusBackground: status && getComputedStyle(status).backgroundColor,
                            cardBackground: getComputedStyle(list.parentElement).backgroundColor,
                            headerOpacity: opaque(header) ? 1 : 0.6,
                            contentOpacity: opaque(content) ? 1 : 0.6,
                            buttons,
                            overflowing,
                            // Author name and time must not be ellipsized to make room for the note.
                            truncated: [...headerNode.querySelectorAll('div[dir="auto"]')]
                                .filter(node => node.scrollWidth > node.clientWidth + 1)
                                .map(node => node.textContent),
                        }
                    }
                    return out
                })
                await page.screenshot({ path: path.join(shots, `comments-${mode}-${width}.png`), fullPage: true })
                const check = (ok, message) => {
                    if (!ok) failures++
                    console.log(`${ok ? 'ok  ' : 'FAIL'} [${mode} ${width}px] ${message}`)
                }
                const q = result.queued
                check(result.horizontalOverflow <= 0, `no sideways scroll (${result.horizontalOverflow}px)`)
                check(!q.statusInHeader, 'queued: note is not inside the 24px author row')
                check(
                    q.truncated.length === 0,
                    `queued: author name and time are not cut ${JSON.stringify(q.truncated)}`
                )
                check(
                    q.status && q.status.top >= q.header.bottom - 0.5,
                    `queued: note starts below the header (${q.status?.top} >= ${q.header.bottom})`
                )
                check(
                    q.status && q.status.bottom <= q.content.top + 0.5,
                    `queued: comment text starts below the note (${q.content.top} >= ${q.status?.bottom})`
                )
                check(q.overflowing.length === 0, `queued: nothing overflows the card ${JSON.stringify(q.overflowing)}`)
                check(
                    q.buttons.length === 2 && q.buttons.every(b => b.visible && b.opaque),
                    `queued: Jetzt senden / Entfernen visible and not faded ${JSON.stringify(q.buttons)}`
                )
                check(
                    q.statusBackground !== q.cardBackground,
                    `queued: note has its own surface (${q.statusBackground})`
                )
                check(q.headerOpacity < 1 && q.contentOpacity < 1, 'queued: header and text are dimmed')
                const p = result.pending
                check(p.statusInHeader, 'pending: sync status stays inline in the author row')
                check(p.status.bottom <= p.header.bottom + 0.5, 'pending: sync status fits the author row')
                check(p.headerOpacity === 1 && p.contentOpacity === 1, 'pending: comment is not dimmed')
                check(errors.length === 0, `no page errors ${JSON.stringify(errors)}`)
                await page.close()
            }
    } finally {
        if (browser) await browser.close()
        server.close()
    }
    assert.equal(failures, 0, `${failures} check(s) failed`)
}
main().catch(error => {
    console.error(error)
    process.exit(1)
})
