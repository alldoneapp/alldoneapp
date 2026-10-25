const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const WS = require(process.env.WS_MODULE || 'ws')
const WebSocketServer = WS.WebSocketServer || WS.Server
const { setupWSConnection } = require(path.join(__dirname, '../../node_modules/y-websocket/bin/utils.js'))
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = path.resolve(__dirname, '../..')
const output = path.join(__dirname, '.build')
if (!process.argv.includes('--skip-build'))
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
        { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=1400' } }
    )
fs.writeFileSync(
    path.join(output, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px sans-serif;margin:16px}.editor-host{width:900px}.ql-editor{white-space:pre-wrap}</style></head><body><script src="/harness.js"></script></body></html>'
)

async function main() {
    const server = http.createServer((request, response) => {
        const file = request.url === '/harness.js' ? 'harness.js' : 'index.html'
        response.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : 'text/html')
        response.end(fs.readFileSync(path.join(output, file)))
    })
    const sockets = new WebSocketServer({ server })
    sockets.on('connection', setupWSConnection)
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] }).catch(error => {
        sockets.close()
        server.close()
        throw error
    })
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => {
        const url = new URL(route.request().url())
        return url.hostname === '127.0.0.1' ? route.continue() : route.abort()
    })
    try {
        await page.goto(`http://127.0.0.1:${server.address().port}/`)
        await page.waitForFunction(() => window.__ready)
        const deferred = await page.evaluate(() => window.verifyDeferredEmbeds())
        assert(deferred.pendingBefore > 0, JSON.stringify(deferred))
        assert(deferred.rootsBefore < deferred.total)
        assert(deferred.afterScroll > deferred.rootsBefore)
        assert.equal(deferred.beforeHeight, deferred.afterHeight)
        assert.equal(deferred.beforeWidth, deferred.afterWidth)
        assert.equal(deferred.pendingAfterFind, 0)
        assert(deferred.deltaUnchanged)
        assert(deferred.selectionUnchanged)
        assert.equal(deferred.rootsAfterClose, 0)
        console.log(
            'PASS deferred embeds, reserved geometry, native-find activation, unchanged Delta, teardown',
            deferred
        )
        await page.evaluate(() => window.scrollTo(0, 0))
        const opening = await page.evaluate(
            url => window.startSyncScenario(url),
            `ws://127.0.0.1:${server.address().port}`
        )
        assert(opening.cachedShown)
        await page.waitForFunction(() => {
            const f = window.verifySync()
            return (
                f.synced &&
                f.localText === f.remoteText &&
                f.localText.includes('Remote') &&
                f.localText.includes('Local')
            )
        })
        await page.evaluate(() => window.editDisconnected())
        await page.evaluate(() => window.reconnectClients())
        await page.waitForFunction(() => {
            const f = window.verifySync()
            return (
                f.synced &&
                f.localText === f.remoteText &&
                f.localText.includes('Offline-local') &&
                f.localText.includes('Offline-remote')
            )
        })
        const converged = await page.evaluate(() => window.verifySync())
        const reopened = await page.evaluate(() => window.reopenOfflineCache())
        assert.equal(reopened, converged.localText)
        console.log(
            'PASS real IndexedDB cached open before download, two WebSocket clients, concurrent offline edits, reconnect, offline reopen',
            { readyMs: opening.readyMs, text: reopened }
        )
        const profile = await page.evaluate(() => window.profileNotes())
        assert.equal(errors.length, 0, errors.join('\n'))
        fs.writeFileSync(
            path.join(output, 'measurements.json'),
            JSON.stringify(
                {
                    environment: 'Headless Chromium 141, synthetic isolated editor, local VM',
                    deferred,
                    opening,
                    profile,
                },
                null,
                2
            )
        )
        console.table(
            profile.map(row => ({
                size: row.size,
                shape: row.shape,
                typingBefore: row.before.typingMedianMs.toFixed(2),
                typingAfter: row.after.typingMedianMs.toFixed(2),
                htmlBefore: row.before.htmlMedianMs.toFixed(2),
                htmlAfter: row.after.htmlMedianMs.toFixed(2),
                mentionBefore: row.before.mentionsMedianMs.toFixed(2),
                mentionAfter: row.after.mentionsMedianMs.toFixed(2),
                encodeAfter: row.after.encodeMedianMs.toFixed(2),
            }))
        )
        console.log('PASS all 10k/50k/100k profile fixtures; results: browser-tests/at2690/.build/measurements.json')
    } finally {
        await browser.close()
        for (const client of sockets.clients) client.terminate()
        sockets.close()
        server.close()
    }
}
main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
