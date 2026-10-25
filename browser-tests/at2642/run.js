/** Browser paint regression for the AT-2642 General Tasks header. Run: node browser-tests/at2642/run.js */
const fs = require('fs')
const http = require('http')
const path = require('path')
const { execFileSync } = require('child_process')

const root = path.resolve(__dirname, '../..')
const out = path.join(__dirname, '.build')
const entry = path.join(__dirname, 'harness.entry.js')
const webpack = path.join(root, 'web-bundler/node_modules/.bin/webpack')

async function main() {
    if (!process.argv.includes('--skip-build'))
        execFileSync(
            webpack,
            [
                '--config',
                path.join(root, 'browser-tests/webpack.harness.js'),
                '--mode',
                'development',
                '--env',
                `harnessEntry=${entry}`,
                '--env',
                `harnessOut=${out}`,
            ],
            { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=1400' } }
        )
    fs.writeFileSync(
        path.join(out, 'index.html'),
        '<!doctype html><html><head><meta charset="utf-8"><style>@font-face{font-family:Roboto-Regular;src:url(/Roboto-Regular.ttf)}@font-face{font-family:Roboto-Medium;src:url(/Roboto-Medium.ttf)}@font-face{font-family:alldone;src:url(/alldone.ttf)}body{margin:0}</style></head><body><div id="root"></div><script src="/harness.js"></script></body></html>'
    )
    const server = http.createServer((request, response) => {
        const name = request.url === '/' ? 'index.html' : path.basename(request.url)
        const font = name.endsWith('.ttf')
        response.setHeader(
            'Content-Type',
            font ? 'font/ttf' : name.endsWith('.js') ? 'application/javascript' : 'text/html'
        )
        response.end(fs.readFileSync(path.join(font ? root + '/assets/fonts' : out, name)))
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

    const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    try {
        const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
        const errors = []
        page.on('pageerror', error => errors.push(error.stack || error.message))
        await page.goto(`http://127.0.0.1:${server.address().port}`)
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(500)
        if (errors.length) throw new Error(`Browser render error: ${errors.join('; ')}`)
        const title = page.getByText('General tasks: Alldone Consulting')
        await title.waitFor({ state: 'attached' })
        const row = page.getByTestId('general-tasks-row')
        const header = title.locator('..')
        const background = page.getByText('Reminder')
        const initial = await page.evaluate(() => {
            const titleNode = [...document.querySelectorAll('*')].find(
                node => node.textContent === 'General tasks: Alldone Consulting' && node.children.length === 0
            )
            const headerNode = titleNode.parentElement
            const reminderNode = [...document.querySelectorAll('*')].find(
                node => node.textContent === 'Reminder' && node.children.length === 0
            )
            const titleBox = titleNode.getBoundingClientRect()
            const reminderBox = reminderNode.getBoundingClientRect()
            const rowBox = document.querySelector('[data-testid="general-tasks-row"]').getBoundingClientRect()
            return {
                surface: getComputedStyle(headerNode).backgroundColor,
                expected: getComputedStyle(document.querySelector('[data-testid="general-tasks-row"]').parentElement)
                    .backgroundColor,
                titleX: titleBox.x,
                titleHeight: titleBox.height,
                headerHeight: headerNode.getBoundingClientRect().height,
                rowLeft: rowBox.left,
                headerLeft: headerNode.getBoundingClientRect().left,
                reminderX: reminderBox.x,
                headerRight: headerNode.getBoundingClientRect().right,
                topmostAtReminder: document.elementFromPoint(reminderBox.x + 2, reminderBox.y + 2).textContent,
            }
        })
        if (initial.surface !== initial.expected) throw new Error(`Idle row is transparent: ${JSON.stringify(initial)}`)
        if (initial.titleHeight < 20) throw new Error(`Idle title is hidden: ${JSON.stringify(initial)}`)
        if (Math.abs(initial.rowLeft - initial.headerLeft) > 1) {
            throw new Error(`Idle row is displaced: ${JSON.stringify(initial)}`)
        }
        if (!initial.topmostAtReminder.includes('General tasks:')) {
            throw new Error(`Reminder paints above idle row: ${JSON.stringify(initial)}`)
        }
        if (initial.titleX >= initial.reminderX) throw new Error(`Idle title shifted: ${JSON.stringify(initial)}`)
        await row.screenshot({ path: path.join(out, 'idle.png') })

        const box = await header.boundingBox()
        await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2)
        await page.mouse.down()
        await page.mouse.move(box.x + box.width * 0.7 - 250, box.y + box.height / 2, { steps: 12 })
        await page.waitForTimeout(100)
        const revealed = await background.evaluate(node => {
            const box = node.getBoundingClientRect()
            const titleNode = [...document.querySelectorAll('*')].find(
                candidate =>
                    candidate.textContent === 'General tasks: Alldone Consulting' && candidate.children.length === 0
            )
            return { actionX: box.x, headerRight: titleNode.parentElement.getBoundingClientRect().right }
        })
        await row.screenshot({ path: path.join(out, 'swiped.png') })
        await page.mouse.up()
        if (revealed.headerRight > revealed.actionX) {
            throw new Error(`Left swipe did not reveal Reminder: ${JSON.stringify(revealed)}`)
        }
        await page.waitForTimeout(500)
        const settled = await page.evaluate(() => {
            const titleNode = [...document.querySelectorAll('*')].find(
                node => node.textContent === 'General tasks: Alldone Consulting' && node.children.length === 0
            )
            return {
                rowLeft: document.querySelector('[data-testid="general-tasks-row"]').getBoundingClientRect().left,
                headerLeft: titleNode.parentElement.getBoundingClientRect().left,
            }
        })
        if (Math.abs(settled.rowLeft - settled.headerLeft) > 1) {
            throw new Error(`Row did not settle after Reminder swipe: ${JSON.stringify(settled)}`)
        }

        await page.goto(`http://127.0.0.1:${server.address().port}`)
        const properties = page.getByText('Properties')
        await properties.waitFor({ state: 'attached' })
        const oppositeBox = await page.getByText('General tasks: Alldone Consulting').locator('..').boundingBox()
        await page.mouse.move(oppositeBox.x + oppositeBox.width * 0.3, oppositeBox.y + oppositeBox.height / 2)
        await page.mouse.down()
        await page.mouse.move(oppositeBox.x + oppositeBox.width * 0.3 + 250, oppositeBox.y + oppositeBox.height / 2, {
            steps: 12,
        })
        await page.waitForTimeout(100)
        const opposite = await properties.evaluate(node => {
            const titleNode = [...document.querySelectorAll('*')].find(
                candidate =>
                    candidate.textContent === 'General tasks: Alldone Consulting' && candidate.children.length === 0
            )
            return {
                actionRight: node.getBoundingClientRect().right,
                headerLeft: titleNode.parentElement.getBoundingClientRect().left,
            }
        })
        await page.getByTestId('general-tasks-row').screenshot({ path: path.join(out, 'properties.png') })
        await page.mouse.up()
        if (opposite.headerLeft < opposite.actionRight) {
            throw new Error(`Right swipe did not reveal Properties: ${JSON.stringify(opposite)}`)
        }
        if (errors.length) throw new Error(errors.join('\n'))
        console.log('AT-2642 browser check passed: idle surface covered; both swipe actions visible at 1366px')
    } finally {
        await browser.close()
        await new Promise(resolve => server.close(resolve))
    }
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
