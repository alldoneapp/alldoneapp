/**
 * AT-3142 browser-level test — "Plan my day" in real Chromium.
 *
 * Drives the REAL DailyPlanEntry → DailyPlanModal (WorkspaceModal, useModalSizing, review and
 * postpone steps, utils/dailyPlan/dailyPlanModel.js) → Today pill + AppPopover summary with real
 * translations, against synthetic tasks. The callable wrapper is an in-memory fake
 * (dailyPlanBackend.js); every request that leaves 127.0.0.1 is aborted and fails the run.
 *
 * Checks: the cross-project capacity and per-project subtotals add up in the DOM, rows are in
 * priority order inside each project, Not today is collapsed per project, editing updates the
 * figures, the postpone step is destination-first with Someday unticked and reconciles, Apply
 * sends one consistent payload and switches Today to the plan filter, Undo restores, overload
 * and missing-calendar states, and no horizontal overflow at 390 px.
 *
 * Requirements (not part of CI's Jest jobs):
 *   nvm use 22
 *   (cd web-bundler && npm install)
 *   cp -R -f replacement_node_modules/* node_modules/
 *   npx playwright install chromium
 * Usage:
 *   node browser-tests/at3142/run.js [--skip-build] [--screenshots]
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const output = path.join(__dirname, '.build')
const shots = path.join(output, 'screenshots')

function build() {
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
            '--env',
            `harnessSetup=${path.join(__dirname, 'setup.js')}`,
        ],
        { cwd: root, stdio: 'inherit' }
    )
}

const html = `<!doctype html><html><head><meta charset="utf-8"><title>AT-3142 harness</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
@font-face {font-family:Roboto-Regular;src:url('/regular.ttf')}
@font-face {font-family:Roboto-Medium;src:url('/medium.ttf')}
@font-face {font-family:alldone;src:url('/icons.ttf')}
html, body {margin:0;background:#fff;font-family:Roboto-Regular}
</style></head><body><div id="root"></div><script src="/harness.js"></script></body></html>`

function serve() {
    const fonts = {
        '/icons.ttf': 'alldone.ttf',
        '/regular.ttf': 'Roboto-Regular.ttf',
        '/medium.ttf': 'Roboto-Medium.ttf',
    }
    const server = http.createServer((req, res) => {
        const url = req.url.split('?')[0]
        if (fonts[url]) {
            res.setHeader('Content-Type', 'font/ttf')
            res.end(fs.readFileSync(path.join(root, 'assets/fonts', fonts[url])))
        } else if (url.endsWith('.js') && fs.existsSync(path.join(output, url))) {
            res.setHeader('Content-Type', 'application/javascript')
            res.end(fs.readFileSync(path.join(output, url)))
        } else {
            res.setHeader('Content-Type', 'text/html')
            res.end(html)
        }
    })
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)))
}

const tid = id => `[data-testid="${id}"]`
const minutes = text => {
    const match = String(text).match(/(?:(\d+)h)?\s*(?:(\d+)m)?/)
    return (Number(match[1]) || 0) * 60 + (Number(match[2]) || 0)
}

async function openPage(browser, base, query, viewport, problems) {
    const page = await browser.newPage({ viewport })
    await page.route('**/*', route => {
        const url = route.request().url()
        if (url.startsWith(base)) return route.continue()
        problems.network.push(url)
        return route.abort()
    })
    page.on('console', message => {
        if (message.type() === 'error') problems.console.push(message.text())
    })
    page.on('pageerror', error => problems.console.push(String(error)))
    await page.goto(`${base}?${query}`)
    await page.waitForSelector(tid('daily-plan-open'))
    return page
}

async function noHorizontalOverflow(page, label) {
    const result = await page.evaluate(() => {
        const card = document.querySelector('[data-testid="daily-plan-modal"]')
        const overflowing = []
        if (card) {
            const box = card.getBoundingClientRect()
            card.querySelectorAll('*').forEach(node => {
                const rect = node.getBoundingClientRect()
                if (rect.width > 0 && (rect.right > box.right + 1 || rect.left < box.left - 1)) {
                    overflowing.push((node.getAttribute('data-testid') || node.tagName) + ':' + Math.round(rect.right))
                }
            })
        }
        return {
            page: document.documentElement.scrollWidth - window.innerWidth,
            card: card ? { right: card.getBoundingClientRect().right, width: window.innerWidth } : null,
            overflowing: overflowing.slice(0, 5),
        }
    })
    assert(result.page <= 0, `${label}: page scrolls horizontally by ${result.page}px`)
    if (result.card) assert(result.card.right <= result.card.width, `${label}: card leaves the viewport`)
    assert.deepEqual(result.overflowing, [], `${label}: elements overflow the card`)
}

const text = (page, id) => page.locator(tid(id)).first().innerText()

/** Planned minutes per project from the DOM headers must add up to the capacity card. */
async function assertSubtotalsAddUp(page, label) {
    const data = await page.evaluate(() => {
        const read = id => document.querySelector(`[data-testid="${id}"]`)?.innerText || ''
        const subtotals = [...document.querySelectorAll('[data-testid^="daily-plan-project-subtotal-"]')].map(
            node => node.innerText
        )
        return { planned: read('daily-plan-planned'), capacity: read('daily-plan-capacity'), subtotals }
    })
    const parse = value => {
        const match = value.match(/(\d+) selected · (.+)$/)
        return { count: Number(match[1]), minutes: match[2] }
    }
    const parts = data.subtotals.map(parse)
    const toMinutes = value => {
        let total = 0
        const hours = value.match(/(\d+)h/)
        const mins = value.match(/(\d+)m/)
        if (hours) total += Number(hours[1]) * 60
        if (mins) total += Number(mins[1])
        return total
    }
    const sum = parts.reduce((total, part) => total + toMinutes(part.minutes), 0)
    const count = parts.reduce((total, part) => total + part.count, 0)
    assert.equal(sum, toMinutes(data.planned), `${label}: project subtotals (${sum}m) ≠ planned (${data.planned})`)
    const capacityCount = Number(data.capacity.match(/planned · (\d+) tasks/)[1])
    assert.equal(count, capacityCount, `${label}: project counts ≠ overall count`)
    return { sum, count }
}

/** Within each project the selected rows must be Must → Should → Could. */
async function assertPriorityOrder(page, label) {
    const orders = await page.evaluate(() =>
        [...document.querySelectorAll('[data-testid^="daily-plan-project-"]')]
            .filter(node => /^daily-plan-project-[a-z]+$/.test(node.getAttribute('data-testid')))
            .map(node =>
                [...node.querySelectorAll('[data-testid^="daily-plan-tier-"]')].map(chip => chip.innerText.trim())
            )
    )
    const rank = { Must: 0, Should: 1, Could: 2 }
    orders.forEach((tiers, index) => {
        const ranks = tiers.map(tier => rank[tier])
        assert.deepEqual(
            ranks,
            [...ranks].sort((a, b) => a - b),
            `${label}: project ${index} not in priority order: ${tiers}`
        )
    })
}

async function reconciliation(page) {
    const value = await text(page, 'daily-plan-reconciliation')
    const [planned, postponed, stays, all] = value.match(/\d+/g).map(Number)
    assert.equal(planned + postponed + stays, all, `reconciliation does not add up: ${value}`)
    return { planned, postponed, stays, all }
}

async function main() {
    if (!process.argv.includes('--skip-build')) build()
    if (process.argv.includes('--screenshots')) fs.mkdirSync(shots, { recursive: true })
    const shot = async (page, name) => {
        if (process.argv.includes('--screenshots'))
            await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: false })
    }
    const server = await serve()
    const base = `http://127.0.0.1:${server.address().port}/`
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
    const browser = await chromium.launch({ args: ['--no-sandbox'] })
    const problems = { network: [], console: [] }
    const results = []
    const check = async (name, fn) => {
        try {
            await fn()
            results.push(`ok   ${name}`)
        } catch (error) {
            results.push(`FAIL ${name}\n     ${error.message.split('\n').join('\n     ')}`)
        }
    }

    try {
        await check('normal day: review, edit, postpone check, apply, focused Today, undo (desktop)', async () => {
            const page = await openPage(browser, base, 'scenario=normal', { width: 1280, height: 900 }, problems)
            await page.click(tid('daily-plan-open'))
            await page.waitForSelector(tid('daily-plan-review'))
            assert.equal(await text(page, 'daily-plan-time-to-work'), '7h 30m')
            const capacity = await text(page, 'daily-plan-capacity')
            assert.match(capacity, /plan up to 6h/)
            // The count comes from the calendar figure that was subtracted (2), not the task list.
            assert.match(capacity, /meetings counted: 2/)
            const projectOrder = await page.evaluate(() =>
                [...document.querySelectorAll('[data-testid^="daily-plan-project-subtotal-"]')].map(node =>
                    node.getAttribute('data-testid').replace('daily-plan-project-subtotal-', '')
                )
            )
            assert.deepEqual(projectOrder, ['product', 'client', 'home'])
            const first = await assertSubtotalsAddUp(page, 'initial')
            assert(first.sum <= 360, 'proposal exceeds the 80% budget')
            await assertPriorityOrder(page, 'initial')
            // Not today is collapsed per project.
            assert.equal(
                await page.locator('[data-testid^="daily-plan-row-client:"]').count(),
                await page.locator('[data-testid^="daily-plan-tier-client:"]').count()
            )
            await shot(page, '1-review-desktop')

            // Remove one planned task, add one back from a Not today list, change a priority.
            const firstRow = await page
                .locator('[data-testid^="daily-plan-toggle-product:"]')
                .first()
                .getAttribute('data-testid')
            await page.click(tid(firstRow))
            const afterRemove = await assertSubtotalsAddUp(page, 'after remove')
            assert(afterRemove.count === first.count - 1, 'remove did not reduce the count')
            await page.click(tid('daily-plan-later-toggle-home'))
            const laterRow = await page
                .locator('[data-testid^="daily-plan-row-home:"]')
                .last()
                .getAttribute('data-testid')
            await page.click(tid(laterRow.replace('daily-plan-row-', 'daily-plan-toggle-')))
            await assertSubtotalsAddUp(page, 'after add')
            const tierChip = await page
                .locator('[data-testid^="daily-plan-tier-client:"]')
                .first()
                .getAttribute('data-testid')
            await page.click(tid(tierChip))
            await assertSubtotalsAddUp(page, 'after tier change')
            await assertPriorityOrder(page, 'after tier change')

            // Search reaches into the collapsed lists of every project.
            await page.fill(tid('daily-plan-search'), 'invoice')
            assert.equal(await page.locator('[data-testid^="daily-plan-row-"]').count(), 1)
            await page.fill(tid('daily-plan-search'), '')

            // Postpone check: destination first, project second, Someday opt-in.
            await page.click(tid('daily-plan-next'))
            await page.waitForSelector(tid('daily-plan-postpone'))
            const before = await reconciliation(page)
            assert.equal(before.planned, afterRemove.count + 1)
            const someday = await text(page, 'daily-plan-destination-someday')
            assert.match(someday, /Someday · opt-in/)
            assert.match(someday, /0 of \d+ ticked/)
            await page.click(tid('daily-plan-destination-expand-someday'))
            const somedayProject = await page
                .locator('[data-testid^="daily-plan-destination-project-someday-"]')
                .first()
                .getAttribute('data-testid')
            await page.click(tid(somedayProject))
            const after = await reconciliation(page)
            assert(after.postponed > before.postponed, 'opting into Someday did not count')
            const totalRow = await text(page, 'daily-plan-reconcile-total')
            assert.deepEqual(totalRow.match(/\d+/g).map(Number), [
                after.planned,
                after.postponed,
                after.stays,
                after.all,
            ])
            await shot(page, '2-postpone-desktop')
            await noHorizontalOverflow(page, 'postpone desktop')

            // Apply: one payload, every due task exactly once, then focused Today and the pill.
            await page.click(tid('daily-plan-apply'))
            await page.waitForSelector(tid('daily-plan-pill'))
            const calls = await page.evaluate(() => window.__applyCalls)
            assert.equal(calls.length, 1)
            const payload = calls[0]
            assert.equal(payload.length, after.all)
            assert.equal(payload.filter(item => item.decision === 'plan').length, after.planned)
            assert.equal(payload.filter(item => item.decision === 'postpone').length, after.postponed)
            assert.equal(payload.filter(item => item.decision === 'keep').length, after.stays)
            assert(
                payload.some(item => item.confirmSomeday === true),
                'Someday opt-in not sent'
            )
            assert(!payload.some(item => item.taskId === 'meeting'), 'a meeting was part of the plan')
            const filters = await page.evaluate(() => window.__store.getState().taskPriorityFilters)
            assert.deepEqual(filters, ['must_do', 'should_do', 'could_do'])
            const pill = await text(page, 'daily-plan-pill')
            assert.match(pill, new RegExp(`${after.planned}/${after.planned} left`))
            await page.click(tid('daily-plan-pill'))
            await page.waitForSelector(tid('daily-plan-summary'))
            await page.waitForTimeout(600)
            const summary = await text(page, 'daily-plan-summary')
            assert.match(summary, /Alldone Product/)
            const visibility = await page.evaluate(() => {
                let node = document.querySelector('[data-testid="daily-plan-summary"]')
                let opacity = 1
                while (node && node !== document.body) {
                    opacity *= Number(getComputedStyle(node).opacity)
                    node = node.parentElement
                }
                const card = document.querySelector('[data-testid="daily-plan-summary"]')
                return { opacity, background: getComputedStyle(card).backgroundColor }
            })
            assert(visibility.opacity > 0.95, `summary popover is not opaque (${visibility.opacity})`)
            assert.notEqual(visibility.background, 'rgba(0, 0, 0, 0)', 'summary popover has no card colour')
            await shot(page, '3-today-plan-desktop')

            // Undo restores and leaves the normal Today.
            await page.click(tid('daily-plan-undo'))
            await page.waitForSelector(tid('daily-plan-open'))
            assert.equal(await page.evaluate(() => window.__undoCalls), 1)
            assert.deepEqual(await page.evaluate(() => window.__store.getState().taskPriorityFilters), [])
            await page.close()
        })

        await check('overload: Must alone over budget, nothing dropped, keep everything', async () => {
            const page = await openPage(browser, base, 'scenario=overload', { width: 1280, height: 900 }, problems)
            await page.click(tid('daily-plan-open'))
            await page.waitForSelector(tid('daily-plan-overload'))
            const overload = await text(page, 'daily-plan-overload')
            assert.match(overload, /Over by/)
            assert.match(overload, /Your Must tasks alone need/)
            const mustRows = await page.locator('[data-testid^="daily-plan-tier-"]', { hasText: 'Must' }).count()
            assert.equal(mustRows, 15, 'a Must task was dropped')
            await assertSubtotalsAddUp(page, 'overload')
            await shot(page, '4-overload')
            await page.click(tid('daily-plan-keep-all'))
            assert.equal(await page.locator(tid('daily-plan-overload')).count(), 0)
            assert.match(await text(page, 'daily-plan-remaining'), /Over by/)
            await page.close()
        })

        await check('missing calendar: provisional capacity, assumption, re-propose keeps edits', async () => {
            const page = await openPage(browser, base, 'scenario=nocal', { width: 1280, height: 900 }, problems)
            await page.click(tid('daily-plan-open'))
            await page.waitForSelector(tid('daily-plan-provisional'))
            assert.equal(await text(page, 'daily-plan-time-to-work'), '9h')
            assert.doesNotMatch(await text(page, 'daily-plan-capacity'), /meetings counted/)
            const plannedBefore = await text(page, 'daily-plan-planned')
            await page.click(tid('daily-plan-assume-180'))
            assert.equal(await text(page, 'daily-plan-time-to-work'), '6h')
            assert.equal(await text(page, 'daily-plan-planned'), plannedBefore, 'selection changed before Re-propose')
            await page.click(tid('daily-plan-repropose'))
            assert(minutes(await text(page, 'daily-plan-planned')) <= 288, 'Re-propose did not fit the new budget')
            await assertSubtotalsAddUp(page, 'after re-propose')
            await shot(page, '5-no-calendar')
            await page.close()
        })

        await check('milestone at risk: planned ahead of the project order with a visible reason', async () => {
            const page = await openPage(browser, base, 'scenario=milestone', { width: 1280, height: 900 }, problems)
            await page.click(tid('daily-plan-open'))
            await page.waitForSelector(tid('daily-plan-review'))
            const reason = await text(page, 'daily-plan-reason-home:home-5')
            assert.match(reason, /^Milestone .+ at risk · workdays left: 1 · 4h of 4h goal work needed today/)
            assert.match(reason, /ahead of project order/)
            assert.match(
                await text(page, 'daily-plan-order-note'),
                /Planned ahead of the project order for milestones at risk: 1\./
            )
            await assertSubtotalsAddUp(page, 'milestone')
            await noHorizontalOverflow(page, 'milestone desktop')
            await shot(page, '8-milestone-desktop')
            await page.close()
        })

        await check('phone width 390 px: review and postpone check fit, no horizontal overflow', async () => {
            const page = await openPage(browser, base, 'scenario=normal&mobile', { width: 390, height: 844 }, problems)
            await page.click(tid('daily-plan-open'))
            await page.waitForSelector(tid('daily-plan-review'))
            await page.click(tid('daily-plan-later-toggle-product'))
            await noHorizontalOverflow(page, 'review 390')
            await shot(page, '6-review-390')
            await page.click(tid('daily-plan-next'))
            await page.waitForSelector(tid('daily-plan-postpone'))
            await page.click(tid('daily-plan-destination-expand-3d'))
            await noHorizontalOverflow(page, 'postpone 390')
            await shot(page, '7-postpone-390')
            await page.keyboard.press('Escape')
            await page.waitForSelector(tid('daily-plan-modal'), { state: 'detached' })
            assert.equal(await page.evaluate(() => window.__applyCalls.length), 0, 'Escape applied the plan')
            await page.close()
        })

        await check('no network requests and no console errors', async () => {
            assert.deepEqual(problems.network, [])
            // The vendored react-tiny-popover inside AppPopover (the shared popover every new popup
            // must use) triggers React's dev-only findDOMNode deprecation warning; it is not from
            // this feature and does not exist in production builds. Anything else fails.
            const unexpected = problems.console.filter(
                message => !(/findDOMNode is deprecated/.test(message) && /at Popover /.test(message))
            )
            assert.deepEqual(unexpected, [])
        })
    } finally {
        await browser.close()
        server.close()
    }
    console.log(results.join('\n'))
    if (results.some(line => line.startsWith('FAIL'))) process.exit(1)
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
