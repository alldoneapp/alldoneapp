const path = require('path')
const fs = require('fs')
const http = require('http')
const assert = require('assert/strict')
const { execFileSync } = require('child_process')
const ROOT = path.resolve(__dirname, '../..')
const BUILD = path.join(__dirname, '.build')
execFileSync(
    path.join(ROOT, 'web-bundler/node_modules/.bin/webpack'),
    [
        '--config',
        path.join(ROOT, 'browser-tests/webpack.harness.js'),
        '--mode',
        'development',
        '--env',
        `harnessEntry=${path.join(__dirname, 'harness.entry.js')}`,
        '--env',
        `harnessOut=${BUILD}`,
        '--env',
        `harnessSetup=${path.join(__dirname, 'webpack.setup.js')}`,
    ],
    { cwd: path.join(ROOT, 'web-bundler'), stdio: 'inherit' }
)
fs.writeFileSync(
    path.join(BUILD, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><title>Launch | Alldone</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body,#root{margin:0;height:100%;width:100%;overflow:hidden}#root{display:flex}</style></head><body><div id="root"></div><script src="/harness.js"></script></body></html>'
)
const server = http.createServer((req, res) => {
    const file = path.join(BUILD, req.url === '/' || !req.url.includes('.') ? 'index.html' : req.url)
    if (!file.startsWith(BUILD) || !fs.existsSync(file)) {
        res.writeHead(404).end()
        return
    }
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : 'application/javascript')
    res.end(fs.readFileSync(file))
})
async function checkWorkspaceOverlays(page, width) {
    const inWorkspace = async locator => {
        await locator.waitFor({ state: 'visible' })
        await page
            .waitForFunction(
                element => {
                    const pane = document.querySelector('.anna-workspace-content').getBoundingClientRect()
                    const box = element.getBoundingClientRect()
                    return (
                        !!window.__alldoneWorkspaceViewport &&
                        box.x >= pane.x - 1 &&
                        box.y >= pane.y - 1 &&
                        box.right <= pane.right + 1 &&
                        box.bottom <= pane.bottom + 1
                    )
                },
                await locator.elementHandle(),
                { timeout: 3000 }
            )
            .catch(async error => {
                console.error(
                    await page.evaluate(() => ({
                        pane: window.__alldoneWorkspaceViewport,
                        popups: Array.from(document.querySelectorAll('.react-tiny-popover-container')).map(node => ({
                            rect: node.getBoundingClientRect().toJSON(),
                            style: node.getAttribute('style'),
                            html: node.innerHTML.slice(0, 900),
                        })),
                    }))
                )
                await page.screenshot({ path: path.join(BUILD, 'overlay-failure.png') })
                throw error
            })
        const pane = await page.locator('.anna-workspace-content').boundingBox()
        const box = await locator.boundingBox()
        assert.ok(
            box.x >= pane.x - 1 &&
                box.y >= pane.y - 1 &&
                box.x + box.width <= pane.x + pane.width + 1 &&
                box.y + box.height <= pane.y + pane.height + 1,
            JSON.stringify({ pane, box })
        )
        return { pane, box }
    }
    await page.getByText('Toggle notifications', { exact: true }).click()
    await inWorkspace(page.getByTestId('undo-notification'))
    await inWorkspace(page.getByText('Alldone is offline', { exact: true }))
    await page.getByText('Open global dialog', { exact: true }).click()
    const globalDraft = await page.getByLabel('Global dialog draft').elementHandle()
    await globalDraft.fill('Draft survives global resize')
    const { pane, box } = await inWorkspace(page.getByTestId('global-dialog-card'))
    assert.ok(
        Math.abs(box.x + box.width / 2 - pane.x - pane.width / 2) <= 1,
        'Global dialog must be centered in Alldone'
    )
    assert.ok(Math.abs(box.y - pane.y - 80) <= 1, 'Global dialog keeps its usual top gap inside Alldone')
    if (width > 760) {
        // A global modal must leave the separate assistant conversation usable.
        await page.getByLabel('Message Carl Code Mentor').fill('Chat remains interactive')
    }
    await page.screenshot({ path: path.join(BUILD, `dialog-${width}.png`) })
    await page.getByText('Zoom in Alldone', { exact: true }).click()
    assert.equal(await globalDraft.inputValue(), 'Draft survives global resize')
    const full = await page.getByTestId('global-dialog-overlay').boundingBox()
    assert.ok(
        Math.abs(full.x) <= 1 && Math.abs(full.width - width) <= 1,
        'Fullscreen dialog must regain the complete viewport'
    )
    await page.getByText('Close dialog', { exact: true }).click()
    await page.getByText('Zoom out to assistant', { exact: true }).click()
    if (width <= 760) await page.locator('.anna-mobile-tabs').getByText('Workspace', { exact: true }).click()
    await page.getByText('Open centered popup', { exact: true }).click()
    await inWorkspace(page.getByTestId('popup-form'))
    await page.getByLabel('Popup draft').fill('Draft survives presentation switch')
    const popupDraft = await page.getByLabel('Popup draft').elementHandle()
    if (width === 1024) {
        // ResizeObserver, not a window resize: cross the sheet breakpoint with
        // the real divider while retaining the exact same input DOM node.
        await page.locator('.anna-divider').focus()
        await page.keyboard.press('ArrowRight')
        await page.getByTestId('bottom-sheet').waitFor({ state: 'visible' })
        assert.equal(await popupDraft.inputValue(), 'Draft survives presentation switch')
        await inWorkspace(page.getByTestId('bottom-sheet'))
        await inWorkspace(page.getByTestId('bottom-sheet-backdrop'))
        await page.screenshot({ path: path.join(BUILD, 'sheet-after-divider.png') })
        await page.locator('.anna-divider').focus()
        await page.keyboard.press('ArrowLeft')
        await page.getByTestId('bottom-sheet').waitFor({ state: 'detached' })
        assert.equal(await popupDraft.inputValue(), 'Draft survives presentation switch')
    }
    await page.screenshot({ path: path.join(BUILD, `popup-${width}.png`) })
    await page.keyboard.press('Escape')
    await page.getByLabel('Popup draft').waitFor({ state: 'detached' })
    await page.getByText('Open anchored popup', { exact: true }).click()
    await inWorkspace(page.getByTestId('popup-form'))
    await page.keyboard.press('Escape')
    await page.getByLabel('Popup draft').waitFor({ state: 'detached' })
    await page.getByText('Toggle notifications', { exact: true }).click()
    if (width > 760) await page.getByLabel('Message Carl Code Mentor').fill('Unsent conversation draft')
}
async function checkImmediateSending(page, width) {
    // A slow thread lookup and slow delivery must not delay the bubble or input.
    await page.goto(`http://127.0.0.1:${server.address().port}/?assistant=1&slowConversation=1&slowSending=1`)
    const input = page.getByLabel('Message Carl Code Mentor')
    await input.waitFor({ state: 'visible' })
    assert.equal(await page.locator('.anna-header').getByText('Take control', { exact: true }).count(), 0)
    if (width <= 760) await page.locator('.anna-mobile-tabs').getByText('Workspace', { exact: true }).click()
    const taken = page.waitForEvent('console', {
        predicate: message => message.text() === 'Anna fixture workspace control: user',
    })
    await page.getByLabel('Workspace draft').click()
    await page.getByLabel('Workspace draft').fill('Direct editing automatically pauses assistant changes')
    await taken
    if (width <= 760) await page.locator('.anna-mobile-tabs').getByText('Chat', { exact: true }).click()
    const released = page.waitForEvent('console', {
        predicate: message => message.text() === 'Anna fixture workspace control: assistant',
    })
    released.catch(() => {})
    await input.fill('First quick message')
    await input.press('Enter')
    await page.getByText('First quick message', { exact: true }).waitFor({ timeout: 1000 })
    assert.equal(await input.inputValue(), '')
    assert.equal(await input.isEnabled(), true)
    assert.equal(await input.evaluate(element => element === document.activeElement), true)
    await input.fill('Second quick message')
    await page.getByLabel('Send message', { exact: true }).click()
    await page.getByText('Second quick message', { exact: true }).waitFor({ timeout: 1000 })
    assert.equal(await input.evaluate(element => element === document.activeElement), true)
    await input.fill('A later draft that must survive')
    await page.screenshot({ path: path.join(BUILD, `immediate-send-${width}.png`) })
    await released
    await page.getByText('Connection interrupted', { exact: false }).waitFor({ timeout: 20000 })
    assert.equal(await input.inputValue(), 'A later draft that must survive')
    assert.equal(await page.getByText('First quick message', { exact: true }).count(), 1)
    assert.equal(await page.getByText('Second quick message', { exact: true }).count(), 1)
    await page.locator('.anna-message-user').getByRole('button', { name: 'Retry', exact: true }).click()
    await page.getByText('Carl Code Mentor is working…', { exact: true }).waitFor({ state: 'detached' })
    assert.equal(await input.inputValue(), 'A later draft that must survive')
    assert.equal(await page.getByText('First quick message', { exact: true }).count(), 1)
    assert.equal(await page.getByText('Second quick message', { exact: true }).count(), 1)
    await page.screenshot({ path: path.join(BUILD, `sent-messages-${width}.png`) })
}
async function checkWorkspaceReveal(page, width) {
    await page.goto(`http://127.0.0.1:${server.address().port}/?assistant=1&reveal=1`)
    const input = page.getByLabel('Message Carl Code Mentor')
    const ring = page.locator('.anna-reveal-ring')
    const workspace = page.getByTestId('workspace-scroll')
    const create = async () => {
        if (width <= 760) await page.locator('.anna-mobile-tabs').getByText('Chat', { exact: true }).click()
        await input.fill('Create a task for the launch')
        await input.press('Enter')
        if (width <= 760) {
            assert.equal(await page.locator('.anna-stage').getAttribute('aria-hidden'), 'true')
            await page.locator('.anna-mobile-tabs').getByText('Workspace', { exact: true }).click()
        } else await input.fill('Keep this unsent draft')
        await ring.waitFor({ state: 'visible', timeout: 6000 }).catch(async error => {
            console.error(
                await workspace.evaluate(node => ({
                    scrollTop: node.scrollTop,
                    scrollHeight: node.scrollHeight,
                    clientHeight: node.clientHeight,
                    ownsScrollTo: Object.prototype.hasOwnProperty.call(node, 'scrollTo'),
                    reactNativeScrollView: typeof node.getScrollableNode === 'function',
                    target: node.querySelector('[data-anna-object-id]')?.getBoundingClientRect().toJSON(),
                }))
            )
            throw error
        })
    }
    const firstHome = page.waitForEvent('console', {
        predicate: message => message.text() === 'Anna fixture navigation: /projects/tasks/open',
    })
    firstHome.catch(() => {})
    await create()
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.anna-reveal-overlay')).opacity > 0.95)
    const target = page.locator('[data-anna-object-id="created-1"]')
    const box = await target.boundingBox()
    const outline = await ring.boundingBox()
    const pane = await page.locator('.anna-workspace-content').boundingBox()
    assert.ok(await workspace.evaluate(node => node.scrollTop > 500), 'Scroll to the saved task, not the chat')
    assert.ok(box.y >= pane.y && box.y + box.height <= pane.y + pane.height, 'Target must be in view')
    assert.ok(outline.x <= box.x && outline.x + outline.width >= box.x + box.width, 'Frame must enclose the real row')
    assert.ok(outline.x >= pane.x && outline.x + outline.width <= pane.x + pane.width, 'Frame stays inside Alldone')
    assert.equal(new URL(page.url()).pathname, '/', 'Keep the current list when its listener mounts the task')
    assert.equal(await page.locator('.anna-reveal-label').innerText(), '✓\nCreated by Carl Code Mentor')
    if (width > 760) assert.equal(await input.inputValue(), 'Keep this unsent draft')
    await page.screenshot({ path: path.join(BUILD, `reveal-${width}.png`) })
    await ring.waitFor({ state: 'detached', timeout: 5000 })
    assert.equal(new URL(page.url()).pathname, '/', 'Do not return home while the request is still running')
    await page.waitForURL(url => url.pathname === '/projects/tasks/open')
    await firstHome
    assert.equal(new URL(page.url()).searchParams.get('assistant'), '1', 'Keep assistant mode on home')
    if (width > 760) assert.equal(await input.inputValue(), 'Keep this unsent draft')
    let homeReturns = 0
    const trackHome = message => {
        if (message.text() === 'Anna fixture navigation: /projects/tasks/open') homeReturns++
    }
    page.on('console', trackHome)
    await create()
    await page.locator('[data-anna-object-id="created-2"]').click()
    await ring.waitFor({ state: 'detached', timeout: 1000 })
    await page.getByText('Carl Code Mentor is working…', { exact: true }).waitFor({ state: 'detached' })
    assert.equal(homeReturns, 0, 'Direct interaction cancels the return even if the request later completes')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await create()
    assert.equal(await ring.evaluate(node => getComputedStyle(node).animationName), 'none')
    await page.screenshot({ path: path.join(BUILD, `reveal-reduced-motion-${width}.png`) })
    await ring.waitFor({ state: 'detached', timeout: 5000 })
    await page.getByText('Carl Code Mentor is working…', { exact: true }).waitFor({ state: 'detached' })
    await page.waitForTimeout(250)
    assert.equal(homeReturns, 1, 'The next uninterrupted request returns home once')
    page.off('console', trackHome)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    console.log(
        `PASS ${width}px: real ScrollView reveal; home only after highlight and completed request; user interaction cancels return; drafts, assistant mode and reduced motion are preserved`
    )
}
async function main() {
    const { chromium } = require('playwright')
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const browser = await chromium.launch({
        headless: true,
        ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}),
    })
    try {
        for (const width of [1440, 1024, 390]) {
            const page = await browser.newPage({ viewport: { width, height: 900 } })
            const errors = []
            page.on('pageerror', error => errors.push(error.message))
            await checkWorkspaceReveal(page, width)
            if (process.env.REVEAL_ONLY) {
                assert.deepEqual(errors, [])
                await page.close()
                continue
            }
            const validated =
                width === 1440
                    ? page.waitForEvent('console', {
                          predicate: message => message.text() === 'Anna fixture conversation validated',
                      })
                    : null
            // Preserve the actual UI failure if it happens before this event;
            // closing the page must not replace it with an unhandled rejection.
            validated?.catch(() => {})
            await page.goto(`http://127.0.0.1:${server.address().port}/?assistant=1&slowConversation=1`)
            // The transport takes six seconds; the cached chat and composer
            // must already be usable before either backend request completes.
            await page.getByLabel('Message Carl Code Mentor').waitFor({ state: 'visible', timeout: 2000 })
            assert.equal(await page.getByText('Loading conversation…', { exact: true }).count(), 0)
            await page.getByLabel('Message Carl Code Mentor').fill('Unsent conversation draft')
            if (validated) {
                await validated
                assert.equal(
                    await page.getByLabel('Message Carl Code Mentor').inputValue(),
                    'Unsent conversation draft'
                )
            }
            if (width <= 760) await page.locator('.anna-mobile-tabs').getByText('Workspace', { exact: true }).click()
            await page.getByLabel('Workspace draft').fill('Unsaved workspace edit')
            await checkWorkspaceOverlays(page, width)
            await page.screenshot({ path: path.join(BUILD, `workspace-${width}.png`) })
            const workspace = await page.getByLabel('Workspace draft').elementHandle()
            const chat = await page.getByLabel('Message Carl Code Mentor').elementHandle()
            await page.getByText('Zoom in Alldone', { exact: true }).click()
            assert.equal(await workspace.inputValue(), 'Unsaved workspace edit')
            await page.getByText('Zoom out to assistant', { exact: true }).click()
            if (width <= 760) await page.locator('.anna-mobile-tabs').getByText('Chat', { exact: true }).click()
            assert.equal(await chat.inputValue(), 'Unsent conversation draft')
            assert.equal(await workspace.inputValue(), 'Unsaved workspace edit')
            const geometry = await page.evaluate(() => ({
                width: document.documentElement.clientWidth,
                scrollWidth: document.documentElement.scrollWidth,
                chat: document.querySelector('.anna-conversation').getBoundingClientRect().toJSON(),
                workspace: document.querySelector('.anna-stage').getBoundingClientRect().toJSON(),
            }))
            assert.ok(geometry.scrollWidth <= geometry.width + 1, JSON.stringify(geometry))
            if (width > 760) assert.ok(geometry.chat.right <= geometry.workspace.left, 'Desktop panes overlap')
            else assert.equal(await page.locator('.anna-stage').getAttribute('aria-hidden'), 'true')
            await page.screenshot({ path: path.join(BUILD, `chat-${width}.png`) })
            assert.equal(new URL(page.url()).searchParams.get('assistant'), '1')
            await page.reload()
            await page.getByText('Zoom in Alldone', { exact: true }).waitFor({ state: 'visible' })
            await page.getByText('Zoom in Alldone', { exact: true }).click()
            assert.equal(new URL(page.url()).searchParams.has('assistant'), false)
            await page.reload()
            await page.getByText('Zoom out to assistant', { exact: true }).waitFor({ state: 'visible' })
            assert.equal(await page.getByText('Zoom in Alldone', { exact: true }).isVisible(), false)
            await checkImmediateSending(page, width)
            assert.deepEqual(errors, [])
            console.log(
                `PASS ${width}px: cached chat opens during a six-second server delay; editors survive zoom; layouts survive reload; dialogs, popups and notifications stay inside Alldone; immediate messages, follow-up sends and retry preserve drafts; no overflow or runtime errors`
            )
            await page.close()
        }
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
