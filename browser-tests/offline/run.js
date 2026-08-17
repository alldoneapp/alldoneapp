/**
 * Offline-support browser-level test (OFFLINE_SUPPORT_PLAN.md, Stage 8).
 * See harness.entry.js for why this needs a real browser.
 *
 * Asserted in real Chromium (Playwright context.setOffline drives the real
 * navigator.onLine + window online/offline events):
 *   1. connectionState starts '' and isBrowserOffline() is false.
 *   2. Online but cache-only: a cached snapshot is buffered first and the
 *      grace timer flushes it (the captive-portal / edge-triggered tell).
 *   3. Going offline flips connectionState to 'offline' (via the debounced
 *      listener) and isBrowserOffline() to true.
 *   4. While offline, a cached snapshot delivers IMMEDIATELY through the
 *      gate's default store-backed offline check.
 *   5. y-indexeddb round trip with REAL IndexedDB: content written with only
 *      the local persistence survives a full teardown and reopens through
 *      prepareSyncedNoteDocument with no Storage and no collaboration server,
 *      flagged for a Storage catch-up upload.
 *   6. A note with nothing anywhere still rejects (locked-and-retry).
 *   7. Going back online flips connectionState to 'online' (recovery).
 *
 * Requirements (this does NOT run in CI's Jest jobs):
 *   nvm use 22
 *   (cd web-bundler && npm install)
 *   cp -R -f replacement_node_modules/* node_modules/
 *   npx playwright install chromium
 * Usage:
 *   node browser-tests/offline/run.js
 */
const path = require('path')
const http = require('http')
const fs = require('fs')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const ENTRY = path.join(__dirname, 'harness.entry.js')

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>offline</title></head>
<body><div id="root"></div><script src="/harness.js"></script></body></html>`

function build() {
    const webpackBin = path.join(ROOT, 'web-bundler', 'node_modules', '.bin', 'webpack')
    if (!fs.existsSync(webpackBin)) {
        throw new Error('web-bundler dependencies are missing. Run: (cd web-bundler && npm install)')
    }
    execFileSync(
        webpackBin,
        [
            '--config',
            path.join(ROOT, 'browser-tests', 'webpack.harness.js'),
            '--mode',
            'development',
            '--env',
            `harnessEntry=${ENTRY}`,
            '--env',
            `harnessOut=${BUILD_DIR}`,
        ],
        { cwd: path.join(ROOT, 'web-bundler'), stdio: 'inherit' }
    )
    fs.writeFileSync(path.join(BUILD_DIR, 'index.html'), HTML)
}

function serve() {
    const server = http.createServer((req, res) => {
        const url = req.url.split('?')[0]
        const file = path.join(BUILD_DIR, url === '/' ? 'index.html' : url)
        if (!file.startsWith(BUILD_DIR) || !fs.existsSync(file)) {
            res.writeHead(404)
            res.end('not found')
            return
        }
        res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : 'application/javascript' })
        res.end(fs.readFileSync(file))
    })
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)))
}

function requirePlaywright() {
    try {
        return require('playwright')
    } catch (error) {
        const fallback = path.join(process.env.PLAYWRIGHT_HOME || '/home/user/repro', 'node_modules', 'playwright')
        return require(fallback)
    }
}

const failures = []
const check = (name, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  — ${detail}`}`)
    if (!ok) failures.push(name)
}

// The connectionState listener debounces transitions by 500ms; wait well past it.
const PAST_DEBOUNCE_MS = 900

async function run() {
    build()
    const server = await serve()
    const { chromium } = requirePlaywright()
    const browser = await chromium.launch()
    const context = await browser.newContext()
    const page = await context.newPage()
    const pageErrors = []
    page.on('pageerror', error => pageErrors.push(error.message))

    try {
        await page.goto(`http://127.0.0.1:${server.address().port}/`)
        await page.waitForFunction(() => window.__ready === true)

        // --- 1. initial state -------------------------------------------------
        check(
            'connectionState starts empty and the browser reports online',
            (await page.evaluate(() => window.harness.getConnectionState())) === '' &&
                (await page.evaluate(() => window.harness.isBrowserOffline())) === false
        )

        // --- 2. grace flush while online-but-cache-only -----------------------
        const grace = await page.evaluate(() => window.harness.deliverCachedSnapshotAfterGrace())
        check(
            'cache-only snapshots are buffered, then flushed by the grace timer',
            grace.immediate === 0 && grace.afterGrace === 1,
            JSON.stringify(grace)
        )

        // --- 3. going offline -------------------------------------------------
        await context.setOffline(true)
        await page.waitForTimeout(PAST_DEBOUNCE_MS)
        check(
            'going offline flips connectionState through the real events',
            (await page.evaluate(() => window.harness.getConnectionState())) === 'offline'
        )
        check(
            'isBrowserOffline reflects navigator.onLine',
            await page.evaluate(() => window.harness.isBrowserOffline())
        )

        // --- 4. immediate cached delivery while offline -----------------------
        check(
            'a cached snapshot delivers immediately while offline',
            (await page.evaluate(() => window.harness.deliverCachedSnapshotNow())) === 1
        )

        // --- 5. y-indexeddb note round trip (real IndexedDB) ------------------
        await page.evaluate(() => window.harness.noteOfflineWrite('Offline note content survives'))
        const reopened = await page.evaluate(() => window.harness.noteOfflineReopen())
        check(
            'note content written offline survives teardown via y-indexeddb',
            reopened.text === 'Offline note content survives',
            JSON.stringify(reopened)
        )
        check('the offline reopen reports no server sync', reopened.syncedWithServer === false)
        check(
            'the offline reopen flags a Storage catch-up upload',
            reopened.storageNeedsLocalCatchUp === true,
            JSON.stringify(reopened)
        )

        // --- 6. nothing-to-show keeps the locked-and-retry behavior ----------
        check(
            'a note with no content anywhere still rejects (editor stays locked)',
            await page.evaluate(() => window.harness.noteWithNothingToShowRejects())
        )

        // --- 7. recovery ------------------------------------------------------
        await context.setOffline(false)
        await page.waitForTimeout(PAST_DEBOUNCE_MS)
        check(
            'coming back online flips connectionState to the recovery state',
            (await page.evaluate(() => window.harness.getConnectionState())) === 'online'
        )

        check('no page errors were thrown', pageErrors.length === 0, pageErrors.join(' | '))
    } finally {
        await browser.close()
        server.close()
    }

    if (failures.length > 0) {
        console.error(`\n${failures.length} failing check(s)`)
        process.exit(1)
    }
    console.log('\nAll offline browser checks passed')
}

run().catch(error => {
    console.error(error)
    process.exit(1)
})
