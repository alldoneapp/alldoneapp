const path = require('path')
const fs = require('fs')
const http = require('http')
const assert = require('assert/strict')
const { execFileSync } = require('child_process')
const ROOT = path.resolve(__dirname, '../..')
const BUILD = path.join(__dirname, '.build')
const readInput = node => node.evaluate(element => element.value ?? element.textContent)
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
    res.setHeader(
        'Content-Type',
        file.endsWith('.html') ? 'text/html' : file.endsWith('.ttf') ? 'font/ttf' : 'application/javascript'
    )
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
    await closeChat(page)
    assert.equal(await readInput(globalDraft), 'Draft survives global resize')
    const full = await page.getByTestId('global-dialog-overlay').boundingBox()
    assert.ok(
        Math.abs(full.x) <= 1 && Math.abs(full.width - width) <= 1,
        'Fullscreen dialog must regain the complete viewport'
    )
    await page.getByText('Close dialog', { exact: true }).click()
    await page.getByText('Zoom out to assistant', { exact: true }).click()
    if (width <= 760) await showWorkspace(page)
    if (width === 1024) {
        await page.setViewportSize({ width: 1100, height: 900 })
        await page.locator('.anna-divider').focus()
        await page.keyboard.press('Home')
    }
    await page.getByText('Open centered popup', { exact: true }).click()
    await inWorkspace(page.getByTestId('popup-form'))
    await page.getByLabel('Popup draft').fill('Draft survives presentation switch')
    const popupDraft = await page.getByLabel('Popup draft').elementHandle()
    if (width === 1024) {
        // ResizeObserver, not a window resize: cross the sheet breakpoint with
        // the real divider while retaining the exact same input DOM node.
        await page.locator('.anna-divider').focus()
        for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight')
        await page.getByTestId('bottom-sheet').waitFor({ state: 'visible' })
        assert.equal(await readInput(popupDraft), 'Draft survives presentation switch')
        await inWorkspace(page.getByTestId('bottom-sheet'))
        await inWorkspace(page.getByTestId('bottom-sheet-backdrop'))
        await page.screenshot({ path: path.join(BUILD, 'sheet-after-divider.png') })
        await page.locator('.anna-divider').focus()
        await page.keyboard.press('ArrowLeft')
        await page.getByTestId('bottom-sheet').waitFor({ state: 'detached' })
        assert.equal(await readInput(popupDraft), 'Draft survives presentation switch')
    }
    await page.screenshot({ path: path.join(BUILD, `popup-${width}.png`) })
    await page.keyboard.press('Escape')
    await page.getByLabel('Popup draft').waitFor({ state: 'detached' })
    await page.getByText('Open anchored popup', { exact: true }).click()
    await inWorkspace(page.getByTestId('popup-form'))
    await page.keyboard.press('Escape')
    await page.getByLabel('Popup draft').waitFor({ state: 'detached' })
    if (width === 1024) await page.setViewportSize({ width, height: 900 })
    await page.getByText('Toggle notifications', { exact: true }).click()
    if (width > 760) await page.getByLabel('Message Carl Code Mentor').fill('Unsent conversation draft')
}
async function checkImmediateSending(page, width) {
    // A slow thread lookup and slow delivery must not delay the bubble or input.
    await page.goto(`http://127.0.0.1:${server.address().port}/?assistant=1&slowConversation=1&slowSending=1`)
    const input = page.getByLabel('Message Carl Code Mentor')
    await input.waitFor({ state: 'visible' })
    assert.equal(await page.locator('.anna-header').getByText('Take control', { exact: true }).count(), 0)
    if (width <= 760) await showWorkspace(page)
    const controlChanges = []
    const trackControl = message => {
        if (message.text().startsWith('Anna fixture workspace control:')) controlChanges.push(message.text())
    }
    page.on('console', trackControl)
    await page.getByLabel('Workspace draft').click()
    await page.getByLabel('Workspace draft').fill('Direct editing keeps assistant changes available')
    await page.getByLabel('Workspace draft').press('ArrowLeft')
    await page.mouse.wheel(0, 100)
    if (width <= 760) await showChat(page)
    await input.fill('First quick message')
    await input.press('Enter')
    await page.getByText('First quick message', { exact: true }).waitFor({ timeout: 1000 })
    assert.equal(await readInput(input), '')
    assert.equal(await input.isEnabled(), true)
    assert.equal(await input.evaluate(element => element === document.activeElement), true)
    await input.fill('Second quick message')
    await page.getByLabel('Send message', { exact: true }).click()
    await page.getByText('Second quick message', { exact: true }).waitFor({ timeout: 1000 })
    assert.equal(await input.evaluate(element => element === document.activeElement), true)
    await input.fill('A later draft that must survive')
    if (width <= 760) await showWorkspace(page)
    await page.getByLabel('Workspace draft').fill('Editing while the assistant is working')
    if (width <= 760) await showChat(page)
    await page.screenshot({ path: path.join(BUILD, `immediate-send-${width}.png`) })
    await page.getByText('Connection interrupted', { exact: false }).waitFor({ timeout: 20000 })
    assert.equal(await readInput(input), 'A later draft that must survive')
    assert.equal(await page.getByText('First quick message', { exact: true }).count(), 1)
    assert.equal(await page.getByText('Second quick message', { exact: true }).count(), 1)
    await page.locator('.anna-message-user').getByRole('button', { name: 'Retry', exact: true }).click()
    await page.getByText('Carl Code Mentor is working…', { exact: true }).waitFor({ state: 'detached' })
    assert.equal(await readInput(input), 'A later draft that must survive')
    assert.equal(await page.getByText('First quick message', { exact: true }).count(), 1)
    assert.equal(await page.getByText('Second quick message', { exact: true }).count(), 1)
    await page.screenshot({ path: path.join(BUILD, `sent-messages-${width}.png`) })
    assert.deepEqual(controlChanges, [], 'Using Alldone must not acquire or release a workspace lock')
    page.off('console', trackControl)
}
async function checkWorkspaceReveal(page, width) {
    await page.goto(`http://127.0.0.1:${server.address().port}/?assistant=1&reveal=1&revealList=1`)
    const navigations = []
    const trackNavigation = message => {
        if (message.text().startsWith('Anna fixture navigation: ')) navigations.push(message.text())
    }
    page.on('console', trackNavigation)
    const input = page.getByLabel('Message Carl Code Mentor')
    const ring = page.locator('.anna-reveal-ring')
    const workspace = page.getByTestId('workspace-scroll')
    const create = async () => {
        if (width <= 760) await showChat(page)
        await input.fill('Create a task for the launch')
        await input.press('Enter')
        if (width <= 760) {
            assert.equal(await page.locator('.anna-stage').getAttribute('aria-hidden'), 'true')
            await showWorkspace(page)
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
    assert.equal(new URL(page.url()).pathname, '/projects/p1/user/a1/tasks/open', 'Reveal in the actual assignee list')
    assert.equal(await page.locator('.anna-reveal-label').innerText(), '✓\nCreated by Carl Code Mentor')
    if (width > 760) assert.equal(await readInput(input), 'Keep this unsent draft')
    await page.screenshot({ path: path.join(BUILD, `reveal-${width}.png`) })
    await ring.waitFor({ state: 'detached', timeout: 5000 })
    assert.equal(
        new URL(page.url()).pathname,
        '/projects/p1/user/a1/tasks/open',
        'Do not return home while the request is still running'
    )
    await page.waitForURL(url => url.pathname === '/projects/tasks/open')
    await firstHome
    assert.equal(new URL(page.url()).searchParams.get('assistant'), '1', 'Keep assistant mode on home')
    if (width > 760) assert.equal(await readInput(input), 'Keep this unsent draft')
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
    page.off('console', trackNavigation)
    assert.ok(
        navigations.every(path => !path.endsWith('/properties')),
        'Saved tasks should remain in the list'
    )
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    console.log(
        `PASS ${width}px: navigate to assignee list and reveal in real ScrollView; home only after completed request; user interaction cancels return; drafts and reduced motion are preserved`
    )
}
async function showWorkspace(page) {
    if ((await page.locator('.anna-stage').getAttribute('aria-hidden')) !== 'true') return
    if (page.viewportSize().width <= 760) {
        const picker = page.locator('.anna-header-picker select')
        const surface = await picker.evaluate(select => {
            const label = select.selectedOptions[0].textContent
            return [...select.options].find(option => option.value && option.textContent.startsWith(label)).value
        })
        await picker.selectOption(surface)
    } else await page.getByRole('button', { name: 'Show workspace', exact: true }).click()
}
async function showChat(page) {
    if (await page.locator('.anna-workspace-switcher select').isVisible())
        await page.locator('.anna-workspace-switcher select').selectOption('chat')
}
async function closeChat(page) {
    await showChat(page)
    await page.getByRole('button', { name: 'Close chat — Alldone only', exact: true }).click()
}
async function selectWorkspaceSurface(page, surface) {
    if (page.viewportSize().width <= 760) {
        await showWorkspace(page)
        await page.locator('.anna-workspace-switcher select').selectOption(surface)
    } else {
        await page.locator('.anna-header-picker select').selectOption(surface.startsWith('vm:') ? 'vms' : surface)
        if (surface.startsWith('vm:'))
            await page.getByLabel('VM session', { exact: true }).selectOption(surface.slice(3))
    }
}
async function assertSelectedSurface(page, surface) {
    assert.equal(
        await page
            .locator(
                page.viewportSize().width <= 760 ? '.anna-workspace-switcher select' : '.anna-header-picker select'
            )
            .inputValue(),
        surface
    )
}
async function assertClearOfSelector(page, locator) {
    if (page.viewportSize().width > 760) return
    const selector = await page.locator('.anna-workspace-switcher').boundingBox()
    const target = await locator.boundingBox()
    const overlaps =
        target.x < selector.x + selector.width &&
        target.x + target.width > selector.x &&
        target.y < selector.y + selector.height &&
        target.y + target.height > selector.y
    assert.equal(overlaps, false, 'Floating picker must not cover surface controls or titles')
}
async function checkSurfaceSelectorLayout(page, width) {
    await page.goto(`http://127.0.0.1:${server.address().port}/?assistant=1&vm=1&floating=1`)
    await page.getByLabel('Message Carl Code Mentor').fill('Keep this mobile draft')
    const selector = page.locator('.anna-workspace-switcher')
    if (width > 760) {
        assert.equal(await selector.count(), 0)
        assert.equal(await page.locator('.anna-header-picker').isVisible(), true)
        return
    }
    assert.equal(await selector.count(), 0, 'No workspace selector over the chat')
    assert.equal(await page.locator('.anna-header-picker').count(), 1)
    assert.ok((await page.locator('.anna-header').boundingBox()).height <= 80, 'Only one header row')
    await page.screenshot({ path: path.join(BUILD, `compact-chat-${width}.png`) })
    await showWorkspace(page)
    const bounds = await selector.boundingBox()
    const stage = await page.locator('.anna-stage').boundingBox()
    const add = await page.getByTestId('floating-task-action').boundingBox()
    assert.ok(Math.abs(bounds.height - add.height) <= 1, 'Both controls have the same height')
    assert.ok(Math.abs(bounds.y - add.y) <= 1, 'Both controls share the same baseline')
    assert.ok(Math.abs(bounds.x - stage.x - (stage.x + stage.width - add.x - add.width)) <= 1, 'Mirrored edge spacing')
    assert.ok(bounds.x + bounds.width + 12 <= add.x, 'Leave a gap between the selector and add button')
    await page.getByTestId('loading-data-spinner').waitFor({ state: 'visible' })
    await assertClearOfSelector(page, page.getByTestId('loading-data-spinner'))
    assert.equal(await selector.evaluate(node => getComputedStyle(node).position), 'absolute')
    assert.equal(await selector.locator('option').count(), 6, 'Chat, Alldone, Browser, VMs and both sessions')
    await page.screenshot({ path: path.join(BUILD, `floating-workspace-${width}.png`) })
    await selector.locator('select').focus()
    assert.equal(await selector.locator('select').evaluate(node => node === document.activeElement), true)
    await selector.locator('select').selectOption('browser')
    await assertSelectedSurface(page, 'browser')
    await closeChat(page)
    assert.equal(await selector.count(), 0, 'Fullscreen Alldone has no floating selector')
    console.info(
        `PASS ${width}px: bottom-left selector aligned with add button; no spinner overlap; keyboard focus and fullscreen`
    )
}
async function checkBrowserLogin(page, width) {
    let captures = 0
    const countCapture = message => {
        if (message.text() === 'Anna fixture login action: snapshot') captures++
    }
    page.on('console', countCapture)
    await page.goto(`http://127.0.0.1:${server.address().port}/?assistant=1&login=1`)
    const chat = page.getByLabel('Message Carl Code Mentor')
    await chat.fill('Keep my chat draft')
    await page.getByText('browser_takeover_start', { exact: true }).click()
    const login = page.locator('.anna-browser-takeover')
    const input = login.getByLabel('browser_takeover_type_placeholder')
    await login.getByLabel('browser_takeover_viewport').waitFor({ state: 'visible' })
    assert.equal(await input.getAttribute('type'), 'password')
    assert.equal(await page.locator('.anna-messages input').count(), 0, 'Login fields must never appear in the chat')
    assert.equal(await page.locator('.anna-stage').getAttribute('aria-hidden'), 'false')
    const frame = await login.getByLabel('browser_takeover_viewport').boundingBox()
    const pane = await page.locator('.anna-browser-surface').boundingBox()
    assert.ok(frame.width > pane.width * 0.85, 'The login browser should use the main pane width')
    await assertClearOfSelector(page, input)
    await input.fill('Fixture private input')
    await selectWorkspaceSurface(page, 'alldone')
    await selectWorkspaceSurface(page, 'browser')
    assert.equal(await readInput(input), 'Fixture private input', 'Pane changes preserve the same controller')
    if (width <= 760) await showChat(page)
    assert.equal(await readInput(chat), 'Keep my chat draft')
    await page.getByText('Open browser', { exact: true }).click()
    assert.equal(await readInput(input), 'Fixture private input')
    if (width <= 760) await showChat(page)
    await chat.fill('A message while signing in')
    await chat.press('Enter')
    await page.getByText('Carl Code Mentor is working…', { exact: true }).waitFor({ state: 'detached' })
    if (width <= 760) await showWorkspace(page)
    assert.equal(await readInput(input), 'Fixture private input', 'Sending chat does not close or release login')
    assert.equal(captures, 1, 'Switching panes or reopening must not create another paid snapshot')
    await login.getByText('browser_takeover_type', { exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.anna-browser-takeover input')?.value === '')
    await page.screenshot({ path: path.join(BUILD, `login-${width}.png`) })
    await login.getByText('browser_takeover_done', { exact: true }).click()
    await login.waitFor({ state: 'detached' })
    if (width <= 760) await showChat(page)
    await page.getByText('browser_takeover_completed', { exact: true }).waitFor({ state: 'visible' })
    assert.equal(await page.locator('.anna-browser-takeover').count(), 0)
    page.off('console', countCapture)
    console.log(
        `PASS ${width}px: login exclusively in main browser pane; private input survives pane switches; chat remains usable; one controller and successful hand-back`
    )
}

async function checkVmWorkspace(page, width) {
    await page.goto(`http://127.0.0.1:${server.address().port}/projects/tasks/open?assistant=1&vm=1`)
    const chat = page.getByLabel('Message Carl Code Mentor')
    await chat.fill('Keep this unsent message')
    if (width <= 760) await showWorkspace(page)
    await page.getByLabel('Workspace draft').fill('Keep the workspace edit')
    const selectVm = () => selectWorkspaceSurface(page, 'vm:vm1', /^VM: Prepare the launch report/)
    await selectVm()
    await page.locator('.anna-vm-terminal pre').waitFor({ state: 'visible' })
    await assertClearOfSelector(page, page.locator('.anna-vm-surface:not(.anna-surface-hidden) h2'))
    await assertClearOfSelector(page, page.locator('.anna-vm-surface:not(.anna-surface-hidden) .anna-vm-task-link'))
    assert.match(await page.locator('.anna-vm-terminal pre').textContent(), /Reading launch.md/)
    assert.equal(await page.getByLabel('Workspace draft').isVisible(), false)
    await page.evaluate(() => window.__annaVmFixture('running', '💻 npm test\nChecking the report output…'))
    await page.getByText('💻 npm test\nChecking the report output…', { exact: true }).waitFor()
    assert.equal(
        await page
            .locator(width <= 760 ? '.anna-workspace-switcher option[value^="vm:"]' : '.anna-vm-selector option')
            .count(),
        2
    )
    const bounds = await page.locator('.anna-vm-terminal').boundingBox()
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: path.join(BUILD, `vm-live-${width}.png`) })
    await page.evaluate(() => window.__annaVmFixture('awaiting_user', 'Please review the plan.'))
    await page.getByText('Request changes', { exact: true }).click()
    await page.getByPlaceholder('What should change in the plan?').fill('Keep this feedback draft')
    await selectWorkspaceSurface(page, 'browser')
    await selectVm()
    assert.equal(
        await page.getByPlaceholder('What should change in the plan?').inputValue(),
        'Keep this feedback draft'
    )
    await page.getByText('Execute plan', { exact: true }).click()
    await page.getByText('💻 npm test\nTests are running…', { exact: true }).waitFor()
    await page.evaluate(() => window.__annaVmFixture('completed', 'The launch report is ready.'))
    await page.getByText('The launch report is ready.', { exact: true }).waitFor()
    assert.equal(await page.locator('.anna-vm-terminal').count(), 0)
    await selectWorkspaceSurface(page, 'alldone')
    assert.equal(await page.getByLabel('Workspace draft').inputValue(), 'Keep the workspace edit')
    if (width <= 760) await showChat(page)
    assert.equal(await readInput(chat), 'Keep this unsent message')
    console.info(`VM workspace passed at ${width}px`)
}

async function checkBrowserReturn(page, width) {
    await page.goto(`http://127.0.0.1:${server.address().port}/projects/tasks/open?assistant=1`)
    await page.getByLabel('Message Carl Code Mentor').fill('Unsent chat draft')
    if (width <= 760) await showWorkspace(page)
    await page.getByLabel('Workspace draft').fill('Unsent Alldone edit')
    await page.evaluate(() => window.__annaBrowserFixture('running'))
    await page.locator('.anna-browser-workspace').waitFor({ state: 'visible' })
    await assertClearOfSelector(page, page.locator('.anna-browser-heading button'))
    if (width <= 760) await page.screenshot({ path: path.join(BUILD, `floating-browser-${width}.png`) })
    await assertSelectedSurface(page, 'browser')
    await page.evaluate(() => window.__annaBrowserFixture('awaiting_user'))
    await assertSelectedSurface(page, 'browser')
    await page.evaluate(() => window.__annaBrowserFixture('completed'))
    await page.getByLabel('Workspace draft').waitFor({ state: 'visible' })
    await assertSelectedSurface(page, 'alldone')
    assert.equal(await page.getByLabel('Workspace draft').inputValue(), 'Unsent Alldone edit')
    // The same browser session may serve a later request; a human gesture then keeps it open.
    await page.evaluate(() => window.__annaBrowserFixture('running', 'browse2'))
    await page.locator('.anna-browser-heading strong').click()
    await page.evaluate(() => window.__annaBrowserFixture('completed', 'browse2'))
    await assertSelectedSurface(page, 'browser')
    await selectWorkspaceSurface(page, 'alldone')
    if (width <= 760) await showChat(page)
    assert.equal(await readInput(page.getByLabel('Message Carl Code Mentor')), 'Unsent chat draft')
    console.info(`PASS ${width}px: browser returns on completion, preserves drafts and respects human interaction`)
}

async function checkDictation(page, width) {
    await page.goto(`http://127.0.0.1:${server.address().port}/?assistant=1`)
    const input = page.getByLabel('Message Carl Code Mentor')
    const mic = page.getByLabel('Dictate', { exact: true })
    const phone = page.getByRole('button', { name: 'Talk with Carl Code Mentor', exact: true })
    await input.fill('Please ')
    await mic.click()
    await page.getByLabel('Stop dictation', { exact: true }).waitFor({ state: 'visible' })
    assert.equal(await phone.isDisabled(), true)
    assert.equal(await input.isEnabled(), true)
    await page.screenshot({ path: path.join(BUILD, `dictation-recording-${width}.png`) })
    await page.getByLabel('Stop dictation', { exact: true }).click()
    await page.waitForFunction(() => !!window.__annaDictationRequest)
    await input.fill('Please remember: ')
    assert.equal(await page.getByRole('button', { name: 'Send message', exact: true }).isDisabled(), true)
    const request = await page.evaluate(() => window.__annaDictationRequest)
    assert.equal(request.projectId, 'p1')
    assert.equal(request.targetKind, 'generic')
    assert.equal(request.currentText, 'Please ')
    await page.evaluate(() => window.__annaFinishDictation('Call Sam tomorrow.'))
    await page.waitForFunction(() =>
        document.querySelector('.anna-composer .ql-editor').textContent.includes('Call Sam')
    )
    assert.equal(await readInput(input), 'Please remember: Call Sam tomorrow.')
    assert.equal(await phone.isEnabled(), true)
    assert.equal(
        await page.locator('.anna-messages').getByText('Please remember: Call Sam tomorrow.', { exact: true }).count(),
        0,
        'Dictation must not auto-send'
    )
    const geometry = await page.locator('.anna-composer-field').evaluate(field => ({
        width: field.clientWidth,
        scrollWidth: field.scrollWidth,
        children: [...field.children].map(child => child.getBoundingClientRect().toJSON()),
    }))
    assert.ok(geometry.scrollWidth <= geometry.width + 1, JSON.stringify(geometry))
    for (let index = 1; index < geometry.children.length; index++)
        assert.ok(geometry.children[index - 1].right <= geometry.children[index].left, 'Composer controls overlap')
    await page.screenshot({ path: path.join(BUILD, `dictation-ready-${width}.png`) })
    // Holding uses the same recording gesture and keeps its status card inside the chat pane.
    const box = await mic.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    const card = page.getByTestId('ramble-hold-card')
    await card.waitFor({ state: 'visible' })
    const cardBox = await card.boundingBox()
    const chatBox = await page.locator('.anna-conversation').boundingBox()
    assert.ok(cardBox.x >= chatBox.x && cardBox.x + cardBox.width <= chatBox.x + chatBox.width)
    await page.screenshot({ path: path.join(BUILD, `dictation-hold-${width}.png`) })
    await page.mouse.move(box.x - 130, box.y - 130)
    await page.mouse.up()
    await mic.waitFor({ state: 'visible' })
    assert.equal(await readInput(input), 'Please remember: Call Sam tomorrow.')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.anna-composer .ql-editor').textContent === '')
    await page.getByText('Please remember: Call Sam tomorrow.', { exact: true }).waitFor({ state: 'visible' })
    console.info(`PASS ${width}px: dictation inserts editable text; call exclusion, cancellation and layout work`)
}

async function checkAssistantLayouts(page, width) {
    await page.goto(`http://127.0.0.1:${server.address().port}/?assistant=1&vm=1`)
    const chat = page.getByLabel('Message Carl Code Mentor')
    await chat.fill('Keep the conversation draft')
    const chatNode = await chat.elementHandle()
    assert.equal(await page.locator('.anna-shell > header').count(), 0)
    const header = await page.locator('.anna-header').boundingBox()
    assert.ok(header.height <= 64, 'The header fits in one compact row')
    if (width > 760) {
        const stage = await page.locator('.anna-stage').boundingBox()
        assert.equal(stage.y, 0, 'Workspace starts at the top of the window')
        assert.ok(header.x + header.width <= stage.x, 'Header belongs entirely to the chat pane')
    } else {
        assert.equal(await page.locator('.anna-pane-toggle-right').count(), 0)
        await showWorkspace(page)
    }
    await page.getByLabel('Workspace draft').fill('Keep the workspace draft')
    const editorNode = await page.getByLabel('Workspace draft').elementHandle()
    await showChat(page)
    if (width > 760) {
        await page.getByRole('button', { name: 'Hide workspace — chat only' }).click()
        assert.equal(await page.getByLabel('Workspace draft').isVisible(), false)
        assert.equal(await page.locator('.anna-divider').isVisible(), false)
        await page.evaluate(() => window.__annaBrowserFixture('running'))
        assert.equal(await page.locator('.anna-chat-only').count(), 1, 'Background activity cannot reopen the pane')
        await page.getByRole('button', { name: 'Show workspace', exact: true }).click()
        assert.equal(await page.locator('.anna-header-picker select').inputValue(), 'alldone')
        assert.equal(await readInput(chatNode), 'Keep the conversation draft')
        await page.getByText('Open global dialog', { exact: true }).click()
        await page.getByLabel('Global dialog draft').fill('Keep this dialog draft')
        const dialogNode = await page.getByLabel('Global dialog draft').elementHandle()
        await page.getByRole('button', { name: 'Hide workspace — chat only' }).click()
        assert.equal(await page.getByLabel('Global dialog draft').isVisible(), false)
        await page.getByRole('button', { name: 'Show workspace', exact: true }).click()
        assert.equal(await readInput(dialogNode), 'Keep this dialog draft')
        await page.getByText('Close dialog', { exact: true }).click()
    }
    await selectWorkspaceSurface(page, 'browser')
    await closeChat(page)
    assert.equal(await page.getByLabel('Workspace draft').isVisible(), true)
    assert.equal(await chat.isVisible(), false)
    await page.getByText('Zoom out to assistant', { exact: true }).click()
    assert.equal(await readInput(chatNode), 'Keep the conversation draft')
    assert.equal(await readInput(editorNode), 'Keep the workspace draft')
    if (width > 760) {
        const divider = page.locator('.anna-divider')
        await divider.focus()
        await page.keyboard.press('ArrowRight')
        const preferred = await divider.getAttribute('aria-valuenow')
        await page.getByRole('button', { name: 'Hide workspace — chat only' }).click()
        await page.screenshot({ path: path.join(BUILD, `chat-only-${width}.png`) })
        await page.reload()
        await page.locator('.anna-chat-only').waitFor()
        await page.getByRole('button', { name: 'Show workspace', exact: true }).click()
        assert.equal(await divider.getAttribute('aria-valuenow'), preferred)
    }
    const geometry = await page
        .locator('.anna-header')
        .evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth }))
    assert.ok(geometry.scrollWidth <= geometry.width + 1, JSON.stringify(geometry))
    await page.screenshot({ path: path.join(BUILD, `new-layout-${width}.png`) })
    console.log(
        `PASS ${width}px: pane controls, top alignment, persistent drafts, hidden dialogs, chat-only reload and saved width`
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
        for (const width of process.env.FLOATING_WORKSPACE_ONLY || process.env.LAYOUT_ONLY
            ? [1440, 1024, 390, 320]
            : [1440, 1024, 390]) {
            const page = await browser.newPage({ viewport: { width, height: 900 } })
            const errors = []
            page.setDefaultTimeout(15000)
            page.on('pageerror', error => {
                errors.push(error.message)
                console.error(error.stack)
            })
            if (process.env.REVEAL_ONLY) {
                await checkWorkspaceReveal(page, width)
                assert.deepEqual(errors, [])
                await page.close()
                continue
            }
            if (process.env.LAYOUT_ONLY) {
                await checkAssistantLayouts(page, width)
                await page.goto(`http://127.0.0.1:${server.address().port}/?assistant=1`)
                await page.getByLabel('Message Carl Code Mentor').waitFor()
                if (width <= 760) await showWorkspace(page)
                await checkWorkspaceOverlays(page, width)
                await checkSurfaceSelectorLayout(page, width)
                await checkBrowserReturn(page, width)
                await checkVmWorkspace(page, width)
                await checkBrowserLogin(page, width)
                assert.deepEqual(errors, [])
                await page.close()
                continue
            }
            if (process.env.FLOATING_WORKSPACE_ONLY) {
                await checkSurfaceSelectorLayout(page, width)
                await checkBrowserReturn(page, width)
                await checkVmWorkspace(page, width)
                await checkBrowserLogin(page, width)
                assert.deepEqual(errors, [])
                await page.close()
                continue
            }
            if (process.env.SHARED_WORKSPACE_ONLY) {
                await checkImmediateSending(page, width)
                await checkWorkspaceReveal(page, width)
                await checkBrowserLogin(page, width)
                assert.deepEqual(errors, [])
                console.info(`PASS ${width}px: workspace editing keeps assistant work available without locks`)
                await page.close()
                continue
            }
            await checkDictation(page, width)
            if (process.env.DICTATION_ONLY) {
                assert.deepEqual(errors, [])
                await page.close()
                continue
            }
            await checkBrowserReturn(page, width)
            if (process.env.BROWSER_RETURN_ONLY) {
                await checkBrowserLogin(page, width)
                assert.deepEqual(errors, [])
                await page.close()
                continue
            }
            await checkVmWorkspace(page, width)
            if (process.env.VM_ONLY) {
                assert.deepEqual(errors, [])
                await page.close()
                continue
            }
            await checkBrowserLogin(page, width)
            if (process.env.LOGIN_ONLY) {
                assert.deepEqual(errors, [])
                await page.close()
                continue
            }
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
                assert.equal(await readInput(page.getByLabel('Message Carl Code Mentor')), 'Unsent conversation draft')
            }
            if (width <= 760) await showWorkspace(page)
            await page.getByLabel('Workspace draft').fill('Unsaved workspace edit')
            await checkWorkspaceOverlays(page, width)
            await page.screenshot({ path: path.join(BUILD, `workspace-${width}.png`) })
            const workspace = await page.getByLabel('Workspace draft').elementHandle()
            const chat = await page.getByLabel('Message Carl Code Mentor').elementHandle()
            await closeChat(page)
            assert.equal(await readInput(workspace), 'Unsaved workspace edit')
            await page.getByText('Zoom out to assistant', { exact: true }).click()
            if (width <= 760) await showChat(page)
            assert.equal(await readInput(chat), 'Unsent conversation draft')
            assert.equal(await readInput(workspace), 'Unsaved workspace edit')
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
            await page
                .getByRole('button', { name: 'Close chat — Alldone only', exact: true })
                .waitFor({ state: 'visible' })
            await closeChat(page)
            assert.equal(new URL(page.url()).searchParams.has('assistant'), false)
            await page.reload()
            await page.getByText('Zoom out to assistant', { exact: true }).waitFor({ state: 'visible' })
            assert.equal(
                await page.getByRole('button', { name: 'Close chat — Alldone only', exact: true }).isVisible(),
                false
            )
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
