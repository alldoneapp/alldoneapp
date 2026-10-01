const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createRequire } = require('node:module')

const root = path.resolve(__dirname, '../..')
const buildDir = path.join(__dirname, '.build')

async function main() {
    if (!process.argv.includes('--skip-build')) {
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
                `harnessOut=${buildDir}`,
                '--env',
                `harnessSetup=${path.join(__dirname, 'webpack.setup.js')}`,
            ],
            { cwd: root, stdio: 'inherit' }
        )
    }
    const server = http.createServer((req, res) => {
        if (req.url === '/') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(
                '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}</style><div id="root"></div><script src="/harness.js"></script>'
            )
        } else {
            const file = path.join(buildDir, path.basename(req.url))
            if (!fs.existsSync(file)) {
                res.writeHead(404)
                res.end()
                return
            }
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
            res.end(fs.readFileSync(file))
        }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let browser
    try {
        const requireFunctions = createRequire(path.join(root, 'functions/package.json'))
        const chromium = requireFunctions('@sparticuz/chromium').default
        const puppeteer = requireFunctions('puppeteer-core')
        browser = await puppeteer.launch({
            executablePath: await chromium.executablePath(),
            args: [...chromium.args, '--disable-gpu'],
            headless: true,
        })
        for (const width of [1280, 390, 320]) {
            const page = await browser.newPage()
            await page.setViewport({ width, height: 600 })
            const errors = []
            page.on('pageerror', error => errors.push(error.message))
            await page.setRequestInterception(true)
            page.on('request', request =>
                request.url().startsWith('http://127.0.0.1:') ? request.continue() : request.abort()
            )
            await page.goto(`http://127.0.0.1:${server.address().port}/`)
            await page.waitForFunction(() => document.body.textContent.includes('ca. alle 60 Minuten'))
            await page.evaluate(
                async bytes => {
                    const font = await new FontFace('Roboto-Medium', new Uint8Array(bytes)).load()
                    document.fonts.add(font)
                },
                Array.from(fs.readFileSync(path.join(root, 'assets/fonts/Roboto-Medium.ttf')))
            )
            await page.waitForFunction(() => document.querySelector('a')?.getBoundingClientRect().height > 0)
            await page.evaluate(
                () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            )
            assert.equal(await page.$eval('a', link => link.getAttribute('href')), '/settings/integrations')
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
            const status = await page.$('[data-testid="chats-email-connection-status"]')
            await status.screenshot({ path: path.join(buildDir, `status-${width}.png`) })
            await page.keyboard.press('Tab')
            assert.equal(await page.evaluate(() => document.activeElement.tagName), 'A')
            await page.keyboard.press('Enter')
            assert.equal(await page.evaluate(() => window.__settingsTab), 'SETTINGS_INTEGRATIONS')
            await page.evaluate(() =>
                window.__setConfigs({
                    gmailLabeling_email_google_aaaaaaaa: { enabled: false, syncIntervalMinutes: 60 },
                })
            )
            await page.waitForFunction(() => document.body.textContent.includes('ist deaktiviert'))
            assert.equal(await page.evaluate(() => document.body.textContent.includes('ca. alle')), false)
            await page.evaluate(() =>
                window.__finishHealth({ results: [{ connectionId: 'email_google_aaaaaaaa', status: 'connected' }] })
            )
            await page.waitForFunction(
                () => !document.querySelector('[data-testid="chats-email-connection-status"]') && window.__unsubscribed
            )
            assert.deepEqual(errors, [])
            console.log(`PASS ${width}px: cadence, wrapping, keyboard link, disabled state and subscription cleanup`)
            await page.close()
        }
    } finally {
        if (browser) await browser.close()
        await new Promise(resolve => server.close(resolve))
    }
}
main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
