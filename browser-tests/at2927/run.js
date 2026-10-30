// AT-2927: the queued note of an Assistant Mode message must stay inside its bubble, keep the
// author name and its actions visible, and never make the chat scroll sideways.
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
        // 432px: the chat column of the reported screenshot; 320px: the narrowest phone.
        for (const width of [432, 320]) {
            const page = await browser.newPage({ viewport: { width, height: 700 } })
            const errors = []
            page.on('pageerror', error => errors.push(error.message))
            await page.goto(`http://127.0.0.1:${server.address().port}`)
            await page.evaluate(w => document.documentElement.style.setProperty('--chat-width', `${w}px`), width)
            await page.waitForFunction(() => window.harnessReady)
            await page.evaluate(() => document.fonts.ready)
            await page.waitForTimeout(200)
            const result = await page.evaluate(() => {
                const rect = node => node && node.getBoundingClientRect()
                const scroller = document.querySelector('.anna-messages')
                const scrollerRect = rect(scroller)
                const visibleRight = scrollerRect.left + scroller.clientWidth
                const out = { horizontalOverflow: scroller.scrollWidth - scroller.clientWidth, messages: {} }
                for (const article of document.querySelectorAll('article')) {
                    const bubble = rect(article)
                    const name = rect(article.querySelector('.anna-message-author-name'))
                    // Every element inside the message must end inside the bubble and the viewport.
                    const overflowing = [...article.querySelectorAll('*')]
                        .filter(node => {
                            const r = rect(node)
                            return r.width > 0 && (r.right > bubble.right + 0.5 || r.right > visibleRight + 0.5)
                        })
                        .map(node => (node.textContent || node.className).slice(0, 40))
                    const note = article.querySelector('.anna-message-queue-note')
                    const buttons = [...article.querySelectorAll('[role="button"]')].map(node => {
                        const r = rect(node)
                        return {
                            label: node.textContent,
                            visible: r.width > 0 && r.right <= bubble.right + 0.5 && r.left >= bubble.left,
                        }
                    })
                    const noteLabel =
                        note &&
                        [...note.querySelectorAll('div[dir], div')].find(
                            node => node.textContent.startsWith('In der Warteschlange') && node.children.length === 0
                        )
                    out.messages[article.dataset.id] = {
                        nameWidth: name.width,
                        overflowing,
                        buttons,
                        noteOpacity: note && getComputedStyle(note).opacity,
                        noteLabelColor: noteLabel && getComputedStyle(noteLabel).color,
                        noteLabelLines: noteLabel && Math.round(rect(noteLabel).height / 20),
                    }
                }
                return out
            })
            await page.screenshot({ path: path.join(shots, `chat-${width}.png`) })
            const check = (ok, message) => {
                if (!ok) failures++
                console.log(`${ok ? 'ok  ' : 'FAIL'} [${width}px] ${message}`)
            }
            check(result.horizontalOverflow <= 0, `chat does not scroll sideways (${result.horizontalOverflow}px)`)
            for (const [id, m] of Object.entries(result.messages))
                check(
                    m.overflowing.length === 0,
                    `${id}: nothing overflows the bubble ${JSON.stringify(m.overflowing)}`
                )
            const queued = result.messages.queued
            check(queued.nameWidth > 8, `queued: author name stays visible (${queued.nameWidth}px)`)
            check(
                queued.buttons.length === 2 && queued.buttons.every(b => b.visible),
                `queued: Send now / Remove visible ${JSON.stringify(queued.buttons)}`
            )
            check(queued.noteOpacity === '1', `queued: note is not faded (opacity ${queued.noteOpacity})`)
            check(result.messages.sending.nameWidth > 8, `sending: author name stays visible`)
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
