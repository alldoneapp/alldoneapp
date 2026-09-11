// Real Web Audio through isolated Chromium. No microphone permissions, recordings,
// app login, provider sessions or network calls beyond the localhost test server.
const path = require('path')
const fs = require('fs')
const http = require('http')
const assert = require('assert')
const { execFileSync } = require('child_process')
const { chromium } = require('playwright')
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
            `harnessOut=${output}`,
        ],
        { cwd: root, stdio: 'inherit' }
    )
    const server = http.createServer((req, res) => {
        if (req.url.startsWith('/harness.js')) {
            res.setHeader('Content-Type', 'application/javascript')
            res.end(fs.readFileSync(path.join(output, 'harness.js')))
        } else
            res.end(
                '<!doctype html><title>Voice microphone test</title><body><script src="/harness.js"></script></body>'
            )
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let browser
    try {
        browser = await chromium.launch({
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=user-gesture-required'],
        })
        for (const scenario of ['normal', 'reverse', 'compatibility', 'playback']) {
            const page = await browser.newPage()
            page.on('pageerror', error => console.error('Browser error:', error.message))
            await page.goto(`http://127.0.0.1:${server.address().port}/?scenario=${scenario}`)
            await page.getByRole('button', { name: 'Test microphone selection' }).click()
            await page.waitForFunction(() => !!window.result, null, { timeout: 15000 })
            const result = await page.evaluate(() => window.result)
            if (scenario === 'playback') {
                assert.equal(result.unlocked, true, JSON.stringify(result))
                assert.equal(result.playing, true)
            } else {
                assert.equal(result.first, scenario === 'reverse' ? 'builtin' : 'usb', JSON.stringify(result))
                assert.equal(result.selected, scenario === 'normal' ? 'builtin' : result.first, JSON.stringify(result))
                assert.equal(result.activeTracks, 0)
            }
            console.log('PASS', scenario, JSON.stringify(result))
            await page.close()
        }
    } finally {
        await browser?.close()
        await new Promise(resolve => server.close(resolve))
    }
}
main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
