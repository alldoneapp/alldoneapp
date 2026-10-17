const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const output = path.join(__dirname, '.build')

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
        const pathname = req.url.split('?')[0]
        if (pathname.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript')
            res.end(fs.readFileSync(path.join(output, path.basename(pathname))))
        } else if (pathname === '/alldone.ttf' || pathname === '/Roboto-Regular.ttf') {
            res.setHeader('Content-Type', 'font/ttf')
            res.end(fs.readFileSync(path.join(root, 'assets/fonts', path.basename(pathname))))
        } else {
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(
                `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@font-face{font-family:alldone;src:url('/alldone.ttf')}@font-face{font-family:Roboto-Regular;src:url('/Roboto-Regular.ttf')}body{margin:0;font-family:Roboto-Regular}</style><div id="root"></div><script defer src="/harness.js"></script>`
            )
        }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let browser
    try {
        browser = await require(process.env.PLAYWRIGHT_MODULE || 'playwright').chromium.launch({
            args: ['--no-sandbox'],
        })
        const address = `http://127.0.0.1:${server.address().port}/`
        for (const [name, width] of [
            ['desktop', 1280],
            ['mobile', 390],
        ]) {
            const page = await browser.newPage({ viewport: { width, height: 800 } })
            const errors = []
            page.on('pageerror', error => errors.push(error.message))
            await page.route('**/*', route =>
                route.request().url().startsWith(address) ? route.continue() : route.abort()
            )
            await page.goto(address)
            page.setDefaultTimeout(10000)
            await page.getByText('Anna Alldone – Mac menubar app', { exact: true }).waitFor()
            for (const tab of ['Zielauswahl', '@Notizen', '@Kontakte']) {
                await page.getByRole('button', { name: tab, exact: true }).click()
                const popup = page.getByTestId('popup')
                assert.equal(await popup.getByText('Alldone Product', { exact: true }).count(), 1)
                assert.equal(await popup.getByText('Weiteres Projekt', { exact: true }).count(), 1)
                const currentHeader = await popup.getByText('Alldone Product', { exact: true }).boundingBox()
                const currentRow = await popup
                    .getByText('Anna Alldone – Mac menubar app', { exact: true })
                    .boundingBox()
                assert(currentHeader.y < currentRow.y, 'current project header precedes its row')
                assert(currentHeader.x + currentHeader.width <= width, 'header fits viewport')
                await popup.getByText('Anna Alldone – Mac menubar app', { exact: true }).click()
                assert.equal(await page.getByLabel('Auswahl').textContent(), 'result-0:current')
                await popup.getByText('Release on AppStores (iOS and Android & Mac?)', { exact: true }).click()
                assert.equal(await page.getByLabel('Auswahl').textContent(), 'result-1:other')
                await page.screenshot({ path: path.join(output, `${name}-${tab.replace('@', '')}.png`) })
                await page.getByLabel('Suche').fill('menubar')
                assert.equal(await popup.getByText('Alldone Product', { exact: true }).count(), 1)
                await popup.getByText('Weiteres Projekt', { exact: true }).waitFor({ state: 'detached' })
                await page.getByLabel('Suche').fill('no match')
                await popup.getByText('Alldone Product', { exact: true }).waitFor({ state: 'detached' })
                await page.getByLabel('Suche').fill('mac')
                await popup.getByText('Weiteres Projekt', { exact: true }).waitFor()
            }
            assert.deepEqual(errors, [])
            await page.close()
        }
        console.log('PASS: project headers and row selection in 3 lists at desktop and mobile widths')
    } finally {
        await browser?.close()
        await new Promise(resolve => server.close(resolve))
    }
}
main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
