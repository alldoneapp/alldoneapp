/**
 * AT-3046: the Assistant sidebar's activity rows are cards (variant C).
 *
 *   node browser-tests/at3046/run.js [--skip-build] [--shots <dir>]
 *
 * Needs `web-bundler/node_modules` and Playwright with Chromium (PLAYWRIGHT_MODULE /
 * CHROMIUM_EXECUTABLE_PATH as for the other harnesses). For every sidebar width, in dark and light
 * mode, it checks that:
 *   - nothing leaves the pane and the chat has no sideways scroll range;
 *   - a card's title is one line with an ellipsis, its time sits on that line and stays whole;
 *   - the preview is at most two lines and the type label is one line inside the card;
 *   - "Project · Actor" shows only on the card from another project and the one from another actor;
 *   - an unread card has a blue (accent) edge, a read one the grey border colour;
 *   - hovering a card turns its border blue, and the card is one link to its object;
 *   - system notices (project switched, view opened) are one-line centred dividers.
 * Screenshots land in `.build/` (or `--shots`).
 */
const path = require('path')
const http = require('http')
const fs = require('fs')
const assert = require('assert/strict')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const shotsArg = process.argv.indexOf('--shots')
const SHOTS_DIR = shotsArg > 0 ? path.resolve(process.argv[shotsArg + 1]) : BUILD_DIR
const WIDTHS = [300, 380, 560]
const MODES = ['dark', 'light']

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>AT-3046</title>
<style>html,body,#root{margin:0;height:100%;width:100%;overflow:hidden}#root{display:flex}</style>
</head><body><div id="root"></div><script src="/harness.js"></script></body></html>`

if (!process.argv.includes('--skip-build')) {
    execFileSync(
        path.join(ROOT, 'web-bundler', 'node_modules', '.bin', 'webpack'),
        [
            '--config',
            path.join(ROOT, 'browser-tests', 'webpack.harness.js'),
            '--mode',
            'development',
            '--env',
            `harnessEntry=${path.join(__dirname, 'harness.entry.js')}`,
            '--env',
            `harnessOut=${BUILD_DIR}`,
        ],
        { cwd: path.join(ROOT, 'web-bundler'), stdio: 'inherit' }
    )
}
fs.writeFileSync(path.join(BUILD_DIR, 'index.html'), HTML)
fs.mkdirSync(SHOTS_DIR, { recursive: true })

const requirePlaywright = () => {
    if (process.env.PLAYWRIGHT_MODULE) return require(process.env.PLAYWRIGHT_MODULE)
    try {
        return require('playwright')
    } catch (_) {
        return require('/home/user/pw/node_modules/playwright')
    }
}

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.ttf': 'font/ttf' }
const serve = () =>
    new Promise(resolve => {
        const server = http.createServer((req, res) => {
            const url = req.url.split('?')[0]
            const file = path.join(BUILD_DIR, url === '/' ? 'index.html' : url)
            if (!file.startsWith(BUILD_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
                res.writeHead(404).end()
                return
            }
            res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream')
            res.end(fs.readFileSync(file))
        })
        server.listen(0, '127.0.0.1', () => resolve(server))
    })

const measure = () => {
    const log = document.querySelector('.anna-messages')
    const pane = log.getBoundingClientRect()
    const shell = getComputedStyle(document.querySelector('.anna-shell'))
    const toRgb = value => {
        const probe = document.createElement('span')
        probe.style.color = value
        document.body.appendChild(probe)
        const rgb = getComputedStyle(probe).color
        probe.remove()
        return rgb
    }
    const accent = toRgb(shell.getPropertyValue('--anna-accent').trim())
    const border = toRgb(shell.getPropertyValue('--anna-border').trim())
    const lineHeight = element => parseFloat(getComputedStyle(element).lineHeight)
    const cards = Array.from(log.querySelectorAll('[data-case]')).map(wrapper => {
        const card = wrapper.querySelector('a.anna-activity-card')
        const rect = card.getBoundingClientRect()
        const title = card.querySelector('.anna-activity-title')
        const time = card.querySelector('.anna-activity-head > time')
        const preview = card.querySelector('.anna-activity-preview')
        const labels = Array.from(card.querySelectorAll('.anna-activity-action'))
        const titleRect = title.getBoundingClientRect()
        const timeRect = time.getBoundingClientRect()
        const inside = element => {
            const r = element.getBoundingClientRect()
            return r.left >= rect.left - 0.5 && r.right <= rect.right + 0.5
        }
        return {
            case: wrapper.dataset.case,
            links: wrapper.querySelectorAll('a').length,
            inPane: rect.left >= pane.left - 0.5 && rect.right <= pane.right + 0.5,
            titleOneLine: titleRect.height <= lineHeight(title) + 1,
            titleEllipsis: getComputedStyle(title).textOverflow === 'ellipsis',
            titleTruncated: title.scrollWidth > title.clientWidth + 1,
            timeOnTitleLine: Math.abs(timeRect.bottom - titleRect.bottom) < 4,
            timeWhole: time.scrollWidth <= time.clientWidth + 1 && inside(time) && timeRect.height < 20,
            previewLines: preview ? Math.round(preview.getBoundingClientRect().height / lineHeight(preview)) : 0,
            labels: labels.map(label => ({
                text: label.textContent,
                inside: inside(label),
                oneLine: label.getBoundingClientRect().height <= 17,
                icon: getComputedStyle(label, '::before').content,
            })),
            meta: card.querySelector('.anna-activity-meta')?.textContent || null,
            edge: getComputedStyle(card, '::before').backgroundColor,
            unread: card.classList.contains('anna-activity-card-unread'),
            background: getComputedStyle(card).backgroundColor,
        }
    })
    // System notices are thin centred dividers: one line, text and time both inside the pane.
    const notices = Array.from(log.querySelectorAll('.anna-project-switch-notice, .anna-view-notice')).map(node => {
        const rect = node.getBoundingClientRect()
        const time = node.querySelector('time').getBoundingClientRect()
        return {
            oneLine: rect.height < 24,
            inPane: rect.left >= pane.left - 0.5 && rect.right <= pane.right + 0.5 && time.right <= pane.right + 0.5,
            line: getComputedStyle(node, '::before').height,
        }
    })
    return {
        notices,
        accent,
        border,
        surface: getComputedStyle(document.querySelector('.anna-shell')).getPropertyValue('--anna-surface').trim(),
        clientWidth: log.clientWidth,
        scrollWidth: log.scrollWidth,
        cards,
    }
}

;(async () => {
    const server = await serve()
    const { chromium } = requirePlaywright()
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined })
    const failures = []
    const check = (condition, message) => {
        if (!condition) failures.push(message)
    }
    try {
        for (const mode of MODES)
            for (const width of WIDTHS) {
                const page = await browser.newPage({
                    viewport: { width: Math.max(1100, width + 700), height: 1100 },
                    deviceScaleFactor: 2,
                })
                const errors = []
                page.on('pageerror', error => errors.push(error.message))
                await page.goto(`http://127.0.0.1:${server.address().port}/?width=${width}&mode=${mode}`)
                await page.waitForSelector('[data-case="not-enriched"]')
                await page.evaluate(() => document.fonts.ready)
                await page.waitForTimeout(300)
                const result = await page.evaluate(measure)
                // The desktop sidebar really is this wide (a narrow window would switch to mobile).
                const chatWidth = await page.evaluate(() =>
                    Math.round(document.querySelector('.anna-conversation').getBoundingClientRect().width)
                )
                check(Math.abs(chatWidth - width) <= 2, `${mode} ${width}px: chat is ${chatWidth}px wide`)
                const tag = `${mode} ${width}px`
                const byCase = Object.fromEntries(result.cards.map(card => [card.case, card]))
                check(errors.length === 0, `${tag}: runtime errors: ${errors.join('; ')}`)
                check(result.scrollWidth <= result.clientWidth, `${tag}: horizontal scroll range`)
                check(result.cards.length === 7, `${tag}: expected 7 cards, got ${result.cards.length}`)
                for (const card of result.cards) {
                    const at = `${tag} "${card.case}"`
                    check(card.links === 1, `${at}: not exactly one link`)
                    check(card.inPane, `${at}: card leaves the pane`)
                    check(card.titleOneLine && card.titleEllipsis, `${at}: title not one ellipsised line`)
                    check(card.timeOnTitleLine && card.timeWhole, `${at}: time not whole on the title line`)
                    check(card.previewLines <= 2, `${at}: preview has ${card.previewLines} lines`)
                    check(card.background !== 'rgba(0, 0, 0, 0)', `${at}: card has no background`)
                    for (const label of card.labels) {
                        check(label.inside && label.oneLine, `${at}: label "${label.text}" not one line inside`)
                        check(label.icon && label.icon !== 'none', `${at}: label "${label.text}" lost its icon`)
                    }
                    check(
                        card.edge === (card.unread ? result.accent : result.border),
                        `${at}: edge ${card.edge} for ${card.unread ? 'unread' : 'read'}`
                    )
                }
                check(result.notices.length === 2, `${tag}: system notices missing`)
                for (const notice of result.notices)
                    check(
                        notice.oneLine && notice.inPane && notice.line === '1px',
                        `${tag}: system notice ${JSON.stringify(notice)}`
                    )
                check(byCase['unread-long'].titleTruncated, `${tag}: long title not shortened`)
                check(byCase['unread-long'].previewLines === 2, `${tag}: long preview not clamped to 2 lines`)
                check(
                    JSON.stringify(byCase.grouped.labels.map(label => label.text)) ===
                        JSON.stringify(['Aufgabe als erledigt markiert', 'Antwort']),
                    `${tag}: grouped labels ${JSON.stringify(byCase.grouped.labels.map(label => label.text))}`
                )
                check(byCase['not-enriched'].labels.length === 0, `${tag}: not-enriched card repeats its title`)
                const metas = Object.fromEntries(result.cards.map(card => [card.case, card.meta]))
                check(
                    JSON.stringify(metas) ===
                        JSON.stringify({
                            'unread-reply': null,
                            'unread-long': null,
                            grouped: null,
                            'read-reply': null,
                            'other-project': 'Alldone Business · Daniela',
                            'other-actor': 'Alldone Product · Daniela',
                            'not-enriched': null,
                        }),
                    `${tag}: project/actor lines ${JSON.stringify(metas)}`
                )
                await page.screenshot({ path: path.join(SHOTS_DIR, `cards-${mode}-${width}.png`) })
                // Hover: the whole card is the target, its border turns blue.
                const target = page.locator('[data-case="read-reply"] a')
                await target.hover()
                await page.waitForTimeout(200)
                const hoverBorder = await target.evaluate(node => getComputedStyle(node).borderTopColor)
                check(hoverBorder === result.accent, `${tag}: hover border ${hoverBorder}`)
                if (width === 380)
                    await page.screenshot({ path: path.join(SHOTS_DIR, `cards-${mode}-${width}-hover.png`) })
                console.log(tag, JSON.stringify({ cards: result.cards.length, errors: errors.length, hoverBorder }))
                await page.close()
            }
    } finally {
        await browser.close()
        server.close()
    }
    if (failures.length) {
        console.error(`FAILED:\n- ${failures.join('\n- ')}`)
        process.exit(1)
    }
    console.log('AT-3046 activity card checks passed')
})()
