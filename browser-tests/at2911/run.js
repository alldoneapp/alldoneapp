// AT-2911: the assistant workspace bezel and the REAL floating "+" with its popup menus.
// Usage (repo root, Node 22, web-bundler deps + Playwright installed):
//   node browser-tests/at2911/run.js            # build + run
//   node browser-tests/at2911/run.js --skip-build
const path = require('path')
const fs = require('fs')
const http = require('http')
const assert = require('assert/strict')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '../..')
const BUILD = path.join(__dirname, '.build')
const GAP = 24 // FLOATING_ACTION_VIEWPORT_GAP
const BEZEL = 6
const BEZEL_COLOR = 'rgb(198, 205, 210)' // colors.Grey400
const HEIGHT = 900

if (!process.argv.includes('--skip-build'))
    execFileSync(
        path.join(ROOT, 'web-bundler/node_modules/.bin/webpack'),
        [
            '--config',
            path.join(ROOT, 'browser-tests/webpack.harness.js'),
            '--mode',
            'development',
            '--no-cache',
            '--env',
            `harnessEntry=${path.join(__dirname, 'harness.entry.js')}`,
            '--env',
            `harnessOut=${BUILD}`,
            '--env',
            `harnessSetup=${path.join(__dirname, 'webpack.setup.js')}`,
        ],
        { cwd: path.join(ROOT, 'web-bundler'), stdio: 'inherit' }
    )

const html =
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body,#root{margin:0;height:100%;width:100%;overflow:hidden}#root{display:flex}</style></head><body><div id="root"></div><script src="/harness.js"></script></body></html>'
const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0]
    if (url === '/' || !url.includes('.')) {
        res.setHeader('Content-Type', 'text/html')
        res.end(html)
        return
    }
    const file = path.join(BUILD, url)
    if (!file.startsWith(BUILD) || !fs.existsSync(file)) {
        res.writeHead(404).end()
        return
    }
    res.setHeader('Content-Type', file.endsWith('.ttf') ? 'font/ttf' : 'application/javascript')
    res.end(fs.readFileSync(file))
})

const near = (a, b, tolerance = 1) => Math.abs(a - b) <= tolerance
const inside = (box, pane) =>
    box.left >= pane.left - 1 && box.top >= pane.top - 1 && box.right <= pane.right + 1 && box.bottom <= pane.bottom + 1
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

async function open(page, width, query = '') {
    await page.setViewportSize({ width, height: HEIGHT })
    await page.goto(`http://127.0.0.1:${server.address().port}/?assistant=1${query}`)
    await page.waitForFunction(() => window.__ready)
    await page
        .locator('[data-testid="floating-add-task-button"]')
        .waitFor({ state: query.includes('chatOnly') ? 'attached' : 'visible' })
    await page.waitForTimeout(400)
}

const measure = page =>
    page.evaluate(() => {
        const rect = selector => {
            const node = document.querySelector(selector)
            return node ? node.getBoundingClientRect().toJSON() : null
        }
        const stage = document.querySelector('.anna-stage')
        if (!stage) return { missing: document.getElementById('root').outerHTML.slice(0, 400), url: location.href }
        const workspace = document.querySelector('.anna-workspace')
        const stageStyle = getComputedStyle(stage)
        const workspaceStyle = getComputedStyle(workspace)
        const loader = [...document.querySelectorAll('.anna-workspace-content *')].find(
            node => node.getAttribute('aria-label') === 'Loading' || node.getAttribute('role') === 'progressbar'
        )
        return {
            window: { width: innerWidth, height: innerHeight },
            divider: rect('.anna-divider'),
            stage: rect('.anna-stage'),
            content: rect('.anna-workspace-content'),
            plus: rect('[data-testid="floating-add-task-button"]'),
            label: rect('.anna-working-label'),
            loader: loader ? loader.getBoundingClientRect().toJSON() : null,
            border: ['Top', 'Right', 'Bottom', 'Left'].map(side => parseFloat(stageStyle[`border${side}Width`])),
            borderColors: ['Top', 'Right', 'Bottom', 'Left'].map(side => stageStyle[`border${side}Color`]),
            padding: ['Top', 'Right', 'Bottom', 'Left'].map(side => parseFloat(workspaceStyle[`padding${side}`])),
            viewport: window.__alldoneWorkspaceViewport,
            scrollWidth: document.documentElement.scrollWidth,
        }
    })

function checkPlus(m, label) {
    assert.ok(m.plus, `${label}: "+" rendered`)
    assert.ok(near(m.plus.right, m.content.right - GAP), `${label}: "+" right gap ${JSON.stringify(m)}`)
    assert.ok(near(m.plus.bottom, m.content.bottom - GAP), `${label}: "+" bottom gap ${JSON.stringify(m)}`)
    assert.ok(inside(m.plus, m.content), `${label}: "+" inside the app`)
    if (m.loader)
        assert.ok(
            near(m.loader.top + m.loader.height / 2, m.plus.top + m.plus.height / 2),
            `${label}: loader shares the "+" baseline`
        )
}

function checkBezel(m, label) {
    assert.deepEqual(m.border, [BEZEL, BEZEL, BEZEL, BEZEL], `${label}: even bezel`)
    assert.ok(near(m.stage.left, m.divider.right), `${label}: bezel starts at the divider`)
    assert.ok(near(m.stage.right, m.window.width) && near(m.stage.top, 0) && near(m.stage.bottom, HEIGHT), label)
    assert.equal(m.padding[0], 0, `${label}: no top padding`)
    assert.equal(m.padding[2], 0, `${label}: no bottom padding`)
    assert.ok(m.padding[1] > 0 && m.padding[1] === m.padding[3], `${label}: even horizontal padding`)
    assert.ok(near(m.content.top, BEZEL) && near(m.content.bottom, HEIGHT - BEZEL), `${label}: app touches bezel`)
    assert.ok(near(m.content.left, m.stage.left + BEZEL + m.padding[3]), `${label}: left padding inside bezel`)
    assert.ok(near(m.content.right, m.stage.right - BEZEL - m.padding[1]), `${label}: right padding inside bezel`)
    for (const key of ['left', 'top', 'right', 'bottom'])
        assert.ok(near(m.viewport[key], m.content[key]), `${label}: workspace viewport = app box (${key})`)
    assert.ok(m.scrollWidth <= m.window.width, `${label}: no horizontal overflow`)
}

// Tag the create-task popup's controls once; their order is stable in RichCreateTaskModal.
const tagControls = page =>
    page.evaluate(() => {
        const popup =
            document.querySelector('[data-testid="bottom-sheet"]') ||
            document.querySelector('.react-tiny-popover-container')
        const clickable = [...popup.querySelectorAll('*')].filter(
            node =>
                getComputedStyle(node).cursor === 'pointer' &&
                !(node.parentElement && getComputedStyle(node.parentElement).cursor === 'pointer')
        )
        const dictate = clickable.findIndex(node => node.getAttribute('aria-label') === 'Dictate')
        clickable[dictate - 1]?.setAttribute('data-at2911', 'assignee')
        clickable[dictate + 1]?.setAttribute('data-at2911', 'due-date')
        clickable[dictate + 4]?.setAttribute('data-at2911', 'recurring')
        return dictate
    })

const popupBox = page =>
    page.evaluate(() => {
        const sheet = document.querySelector('[data-testid="bottom-sheet"]')
        if (sheet) return { kind: 'sheet', ...sheet.getBoundingClientRect().toJSON() }
        const containers = [...document.querySelectorAll('.react-tiny-popover-container')]
        const boxes = containers.map(node => {
            // The vendored container is position:fixed with overflow:visible here; measure the card.
            const card = node.querySelector('div') || node
            const rect = card.getBoundingClientRect()
            return rect.width ? rect.toJSON() : node.getBoundingClientRect().toJSON()
        })
        return boxes.length ? { kind: 'popover', count: boxes.length, ...boxes[boxes.length - 1] } : null
    })

async function openCreateTask(page) {
    await page
        .locator(
            '[data-testid="floating-add-task-button"] [role="button"], [data-testid="floating-add-task-button"] button'
        )
        .first()
        .click()
    await page.locator('.ql-editor').waitFor({ state: 'visible' })
    await page.waitForTimeout(300)
}

async function waitInside(page, label) {
    // Popovers settle over a couple of frames after a content swap or a resize.
    let last
    for (let attempt = 0; attempt < 20; attempt++) {
        const m = await measure(page)
        if (m.missing) throw new Error(JSON.stringify(m))
        const box = await popupBox(page)
        last = { box, content: m.content }
        if (box && inside(box, m.content)) return last
        await page.waitForTimeout(100)
    }
    await page.screenshot({ path: path.join(BUILD, `failure-${label.replace(/\W+/g, '-')}.png`) })
    throw new Error(`${label}: popup outside the app ${JSON.stringify(last)}`)
}

async function checkMenus(page, width, label) {
    const before = await measure(page)
    await openCreateTask(page)
    const { box } = await waitInside(page, `${label} create-task popup`)
    if (box.kind === 'popover') {
        assert.ok(near(box.right, before.plus.right, 2), `${label}: popup aligned with "+" ${JSON.stringify(box)}`)
        assert.ok(
            box.bottom <= before.plus.top - 12 + 1,
            `${label}: popup opens above "+" ${JSON.stringify({ box, plus: before.plus })}`
        )
    }
    await page.screenshot({ path: path.join(BUILD, `create-${label}.png`) })
    await page.locator('.ql-editor').fill('Prepare the launch')
    await page.waitForTimeout(200)
    const dictate = await tagControls(page)
    assert.ok(dictate > 0, `${label}: create-task controls found`)
    for (const control of ['due-date', 'assignee', 'recurring']) {
        await page.locator(`[data-at2911="${control}"]`).click()
        await page.waitForTimeout(400)
        const swapped = await waitInside(page, `${label} ${control} menu`)
        await page.screenshot({ path: path.join(BUILD, `menu-${control}-${label}.png`) })
        await page.keyboard.press('Escape')
        await page.waitForTimeout(300)
        if (!(await page.locator('.ql-editor').count())) await openCreateTask(page)
        if (!(await page.locator('[data-at2911="assignee"]').count())) {
            await page.locator('.ql-editor').fill('Prepare the launch')
            await page.waitForTimeout(200)
            await tagControls(page)
        }
        assert.ok(swapped.box.height > 0, `${label}: ${control} menu rendered`)
    }
    await page.locator('[data-testid="project-filter"]').click()
    await page.waitForTimeout(400)
    await waitInside(page, `${label} project menu`)
    await page.screenshot({ path: path.join(BUILD, `menu-project-${label}.png`) })
    for (let i = 0; i < 3 && (await page.locator('.ql-editor').count()); i++) {
        await page.keyboard.press('Escape')
        await page.waitForTimeout(250)
    }
}

async function main() {
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1440, height: HEIGHT } })
    const errors = []
    page.on('pageerror', error => {
        errors.push(error.message)
        console.error('pageerror', error.stack.slice(0, 600))
    })
    page.on('console', message => {
        if (message.type() === 'error' && !message.text().includes('findDOMNode'))
            console.error(message.text().slice(0, 1500))
    })
    await page.route(/https?:\/\/(?!127\.0\.0\.1)/, route => route.abort())
    page.setDefaultTimeout(10000)
    let passed = 0
    const pass = message => {
        passed++
        console.log(`PASS ${message}`)
    }
    try {
        for (const width of process.env.WIDTHS
            ? process.env.WIDTHS.split(',').map(Number)
            : [1600, 1440, 1373, 1100, 1024, 900]) {
            await open(page, width)
            const m = await measure(page)
            checkBezel(m, `${width}px`)
            assert.deepEqual(m.borderColors, Array(4).fill(BEZEL_COLOR), `${width}px: gray bezel`)
            checkPlus(m, `${width}px`)
            pass(
                `${width}px idle: 6px gray bezel at the column edges, padding ${m.padding[3]}px left/right only, "+" 24px from the app`
            )
            await page.screenshot({ path: path.join(BUILD, `idle-${width}.png`) })

            await page.evaluate(() => window.__setWorking(true))
            await page.waitForTimeout(350)
            const w = await measure(page)
            assert.ok(w.label, `${width}px: working label shown`)
            assert.ok(near(w.label.left + w.label.width / 2, w.stage.left + w.stage.width / 2, 1.5), 'label centred')
            assert.ok(near(w.label.bottom, w.stage.bottom - BEZEL), 'label rises from the bottom bezel')
            assert.ok(!overlaps(w.label, w.plus), `${width}px: label clear of "+" ${JSON.stringify([w.label, w.plus])}`)
            assert.ok(
                w.borderColors.every(color => color !== BEZEL_COLOR),
                `${width}px: bezel takes the accent`
            )
            checkPlus(w, `${width}px working`)
            await page.screenshot({ path: path.join(BUILD, `working-${width}.png`) })
            pass(`${width}px working: accent bezel, centred bottom label clear of "+"`)

            await checkMenus(page, width, `${width}px`)
            pass(`${width}px: create-task popup, due date, assignee, recurrence and project menus stay inside the app`)
        }

        // Resizing with the popup open: window shrink and divider drag (ResizeObserver path).
        await open(page, 1440)
        await openCreateTask(page)
        for (const width of [1200, 1024, 900, 1440]) {
            await page.setViewportSize({ width, height: HEIGHT })
            await page.waitForTimeout(400)
            await waitInside(page, `resize to ${width}px with popup open`)
        }
        await page.keyboard.press('Escape')
        await page.waitForTimeout(300)
        for (const chatWidth of [520, 330, 420]) {
            await page.evaluate(value => window.__setChatWidth(value), chatWidth)
            await page.waitForTimeout(300)
            const m = await measure(page)
            checkBezel(m, `chat ${chatWidth}px`)
            checkPlus(m, `chat ${chatWidth}px`)
        }
        // Fresh load: a second open of the same popup is placed lower (see the note at the end).
        await open(page, 1440)
        await page.evaluate(() => window.__setChatWidth(520))
        await page.waitForTimeout(300)
        await checkMenus(page, 1440, 'wide-chat')
        pass('window resize with the popup open, divider widths 520/330/420: bezel, "+" and menus follow the app')

        // A narrow app pane presents the popup as a bottom sheet. Nothing of it may paint
        // over the bottom bezel at rest, and an upward overdrag must still be backed.
        await open(page, 900, '&working=1')
        await openCreateTask(page)
        await page.getByTestId('bottom-sheet').waitFor({ state: 'visible' })
        await page.waitForTimeout(400)
        const sheetPaint = () =>
            page.evaluate(() => {
                const sheet = document.querySelector('[data-testid="bottom-sheet"]')
                const box = sheet.getBoundingClientRect()
                const stage = document.querySelector('.anna-stage').getBoundingClientRect()
                const x = box.left + box.width / 2
                const below = document.elementFromPoint(x, stage.bottom - 3)
                const bleed = sheet.firstElementChild.getBoundingClientRect()
                return { box: box.toJSON(), bezelVisible: !sheet.contains(below), bleed: bleed.toJSON() }
            })
        const rest = await sheetPaint()
        assert.ok(rest.box.bottom <= HEIGHT - BEZEL + 1, `sheet ends at the app edge ${JSON.stringify(rest)}`)
        assert.ok(rest.bezelVisible, `bottom bezel stays visible under the sheet ${JSON.stringify(rest)}`)
        await page.screenshot({ path: path.join(BUILD, 'sheet-rest-900.png') })
        const handle = await page.getByTestId('bottom-sheet-handle').boundingBox()
        await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
        await page.mouse.down()
        await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 - 30, { steps: 6 })
        await page.waitForTimeout(100)
        const lifted = await sheetPaint()
        await page.screenshot({ path: path.join(BUILD, 'sheet-overdrag-900.png') })
        await page.mouse.up()
        const lift = rest.box.bottom - lifted.box.bottom
        assert.ok(lift > 5, `overdrag lifted the sheet ${JSON.stringify({ rest, lifted })}`)
        assert.ok(near(lifted.bleed.height, lift, 2), `bleed backs exactly the lift ${JSON.stringify(lifted)}`)
        assert.ok(near(lifted.bleed.bottom, rest.box.bottom, 2), 'bleed ends at the resting sheet edge')
        await page.keyboard.press('Escape')
        pass(`900px bottom sheet: ends at the app edge, bezel visible, overdrag of ${Math.round(lift)}px backed`)

        // Unchanged modes.
        for (const [query, width, label] of [
            ['&chatOnly=1', 1440, 'chat-only'],
            ['&fullscreen=1', 1440, 'non-assistant'],
            ['', 760, 'mobile 760'],
            ['', 390, 'mobile 390'],
        ]) {
            await open(page, width, query)
            const m = await measure(page)
            assert.deepEqual(m.border, [0, 0, 0, 0], `${label}: no bezel`)
            assert.deepEqual(m.padding, [0, 0, 0, 0], `${label}: no workspace padding`)
            if (label !== 'chat-only') {
                checkPlus(m, label)
                if (label === 'non-assistant')
                    assert.ok(near(m.plus.right, width - GAP), 'non-assistant "+" at window edge')
                await page.evaluate(() => window.__setWorking(true))
                await page.waitForTimeout(200)
                assert.equal((await measure(page)).label, null, `${label}: no working label`)
                await checkMenus(page, width, label.replace(' ', '-'))
            }
            await page.screenshot({ path: path.join(BUILD, `${label.replace(' ', '-')}.png`) })
            pass(`${label}: no bezel or padding${label === 'chat-only' ? '' : ', "+" and menus as before'}`)
        }
        // Pre-existing, independent of AT-2911 (identical on master and outside assistant mode):
        // after the first open, every reopen of the create-task popup is positioned for a
        // shorter card and grows down over the hidden "+". Reported, not asserted.
        await open(page, 1440)
        const reopen = []
        for (let i = 0; i < 2; i++) {
            await openCreateTask(page)
            await page.waitForTimeout(500)
            reopen.push(await popupBox(page))
            await page.keyboard.press('Escape')
            await page.locator('.ql-editor').waitFor({ state: 'detached' })
        }
        const plus = (await measure(page)).plus
        console.log(
            `NOTE create-task popup bottom: first open ${reopen[0].bottom}px, reopen ${reopen[1].bottom}px ("+" top ${plus.top}px)`
        )
        assert.deepEqual(errors, [])
        console.log(`AT-2911 harness: ${passed} checks passed, no page errors`)
    } finally {
        await browser.close()
        server.close()
    }
}
main().catch(error => {
    console.error(error)
    server.close()
    process.exitCode = 1
})
