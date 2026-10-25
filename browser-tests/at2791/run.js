// npm install --prefix /tmp/at2791-browser playwright
// NODE_PATH=/tmp/at2791-browser/node_modules node browser-tests/at2791/run.js
const { chromium } = require('playwright')
const http = require('http')
const fs = require('fs')
const path = require('path')
const assert = require('assert/strict')
const root = path.resolve(__dirname, '../..')
const server = http.createServer((req, res) => {
    if (req.url === '/') {
        res.setHeader('Content-Type', 'text/html')
        res.end(
            '<!doctype html><button onclick="startTest().then(() => window.started = true)">Start generated audio</button><script type="module" src="/browser-tests/at2791/harness.js"></script>'
        )
        return
    }
    const relative = req.url.replace(/^\//, '')
    if (!/^(utils|hooks|browser-tests\/at2791)\/[\w/.\-]+$/.test(relative) || relative.includes('..')) {
        res.writeHead(404)
        res.end()
        return
    }
    const filename = path.resolve(root, relative.endsWith('.js') ? relative : `${relative}.js`)
    res.setHeader('Content-Type', 'text/javascript')
    try {
        res.end(fs.readFileSync(filename))
    } catch (_) {
        res.writeHead(404)
        res.end()
    }
})

async function main() {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let browser
    try {
        browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
        const page = await browser.newPage()
        page.on('pageerror', error => console.error(error))
        await page.goto(`http://127.0.0.1:${server.address().port}`)
        await page.getByRole('button').click()
        await page.waitForFunction(() => window.started)
        // A short real-time browser test, expressly NOT a one-hour/device endurance test.
        await page.waitForTimeout(21500)
        const captured = await page.evaluate(() => window.stopTest())
        assert.deepEqual(captured.errors, [])
        assert.equal(captured.tracksStopped, true)
        assert(captured.decoded.length >= 3)
        for (const chunk of captured.decoded.slice(0, -1)) {
            assert.equal(chunk.sampleRate, 16000)
            assert.equal(chunk.frames, 160000)
            assert(chunk.peak > 0.1)
        }
        assert(captured.decoded.at(-1).frames > 0 && captured.decoded.at(-1).frames < 160000)
        await page.reload()
        await page.waitForFunction(() => window.recoverTest)
        const recovered = await page.evaluate(() => window.recoverTest())
        assert.equal(recovered.restored, captured.decoded.length)
        assert.equal(recovered.offlineRetained, recovered.restored)
        assert.equal(recovered.remaining, 0)
        assert.deepEqual(
            recovered.order,
            captured.decoded.map((_, index) => index)
        )
        console.log(
            'PASS generated audio → real AudioWorklet → independent WAV decoding → real IndexedDB → reload/offline/order/final flush/cleanup',
            JSON.stringify({ captured, recovered })
        )
    } finally {
        await browser?.close()
        await new Promise(resolve => server.close(resolve))
    }
}
main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
