'use strict'

// Artifact sandbox isolation, in real Chromium (ARTIFACTS_PLAN.md, Phase 0).
//
// An HTML artifact is code written by a model or uploaded by somebody. The promise is that it can
// run its own script and nothing else: it must not read the app's session, cookies or storage, must
// not reach into the page that frames it, must not navigate that page away, and must not read the
// storage of another artifact. jsdom cannot test any of this — the whole guarantee lives in how a
// browser applies origins, the CSP sandbox and the iframe sandbox — so this drives the REAL
// serveArtifact handler (with in-memory Firestore and Storage) on one origin and a stand-in app page
// on another, framing the artifact with the exact sandbox string ArtifactPreview uses.
//
//   node browser-tests/artifacts/run.js        exit code 0 = pass

const fs = require('fs')
const http = require('http')
const path = require('path')
const { createRequire } = require('module')
const { chromium } = require('playwright')

const REPO = path.join(__dirname, '..', '..')
const functionsRequire = createRequire(path.join(REPO, 'functions', 'package.json'))
const express = functionsRequire('express')
const { KnowledgeFirestoreDouble } = require(
    path.join(REPO, 'functions/KnowledgeBase/__fixtures__/knowledgeFirestoreDouble')
)
const { ArtifactBucketDouble } = require(path.join(REPO, 'functions/Artifacts/__fixtures__/artifactBucketDouble'))
const { commitArtifactVersion } = require(path.join(REPO, 'functions/Artifacts/artifactStore'))
const { handleServeArtifactRequest } = require(path.join(REPO, 'functions/Artifacts/serveArtifact'))
const { buildArtifactServeUrl } = require(path.join(REPO, 'functions/Artifacts/artifactModel'))

const PROJECT_ID = 'project-a'
const SECRET = 'harness-secret-aaaaaaaaaaaaaaaaaaaa'
const APP_SESSION = 'APP-SESSION-TOKEN-must-not-leak'

// The sandbox attribute is read from the component itself, so this test can never pass against a
// string the app does not actually ship.
const previewSource = fs.readFileSync(path.join(REPO, 'components/ArtifactsView/ArtifactPreview.js'), 'utf8')
const sandboxMatch = previewSource.match(/ARTIFACT_IFRAME_SANDBOX\s*=\s*\n?\s*'([^']+)'/)
if (!sandboxMatch) throw new Error('Could not read ARTIFACT_IFRAME_SANDBOX from ArtifactPreview.js')
const IFRAME_SANDBOX = sandboxMatch[1]

const PROBE_SCRIPT = `
(function () {
    var results = { origin: String(self.origin), relativeScriptLoaded: true }
    function probe(name, fn) {
        try { results[name] = { ok: true, value: String(fn()).slice(0, 120) } }
        catch (e) { results[name] = { ok: false, error: e && e.name } }
    }
    probe('parentDocument', function () { return parent.document.title })
    probe('parentLocalStorage', function () { return parent.localStorage.getItem('firebase:authUser') })
    probe('parentCookie', function () { return parent.document.cookie })
    probe('ownLocalStorage', function () { localStorage.setItem('artifact', 'x'); return localStorage.getItem('artifact') })
    probe('ownCookie', function () { return document.cookie })
    probe('indexedDB', function () { return indexedDB.open('firebaseLocalStorageDb') })
    var report = function () {
        if (window.parent !== window) parent.postMessage({ type: 'artifact-probe', results: results }, '*')
        document.body.setAttribute('data-results', JSON.stringify(results))
    }
    report()
    // The last thing it tries, when framed: replacing the app it sits in. (Opened on its own it is
    // the top window, and navigating itself away harms nobody.)
    if (window.parent !== window) {
        try { top.location.href = '${'APP_ORIGIN'}/hijacked' } catch (e) {}
    }
})()
`

async function seedArtifacts(db, bucket, appOrigin) {
    const probeScript = PROBE_SCRIPT.replace('APP_ORIGIN', appOrigin)
    const ids = ['bundle', 'bundle-v1', 'second', 'second-v1']
    const commit = (artifactId, files) =>
        commitArtifactVersion({
            db,
            bucket,
            newId: () => ids.shift(),
            newSecret: () => SECRET,
            userId: 'owner',
            projectId: PROJECT_ID,
            files,
            artifactId,
        })
    const b64 = text => Buffer.from(text).toString('base64')
    // A two-file artifact: the probe is a RELATIVE script, so its running proves bundles resolve.
    await commit(null, [
        {
            path: 'index.html',
            base64: b64('<!doctype html><title>artifact</title><body><script src="app.js"></script></body>'),
        },
        { path: 'app.js', base64: b64(probeScript) },
    ])
    await commit(null, [
        { path: 'probe.html', base64: b64('<!doctype html><body><script src="probe.js"></script></body>') },
        { path: 'probe.js', base64: b64(probeScript) },
    ])
}

function listen(app, host) {
    return new Promise(resolve => {
        const server = http.createServer(app).listen(0, host, () => resolve(server))
    })
}

function check(results, name, condition, detail) {
    results.push({ name, pass: !!condition, detail })
}

async function main() {
    const db = new KnowledgeFirestoreDouble({ [`projects/${PROJECT_ID}`]: { userIds: ['owner'] } })
    const bucket = new ArtifactBucketDouble()

    let artifactOrigin = ''
    const appApp = express()
    appApp.get('/app', (req, res) => {
        const frameUrl = buildArtifactServeUrl(artifactOrigin, {
            projectId: PROJECT_ID,
            artifactId: 'bundle',
            serveSecret: SECRET,
            path: 'index.html',
        })
        res.set('Content-Type', 'text/html; charset=utf-8')
        res.send(`<!doctype html><title>Alldone app</title><body>
<script>
    localStorage.setItem('firebase:authUser', ${JSON.stringify(APP_SESSION)})
    document.cookie = 'session=${APP_SESSION}; path=/'
    window.__probe = null
    window.addEventListener('message', function (event) {
        if (event.data && event.data.type === 'artifact-probe') {
            window.__probe = { origin: event.origin, results: event.data.results }
        }
    })
</script>
<iframe id="artifact" src="${frameUrl}" sandbox="${IFRAME_SANDBOX}" referrerpolicy="no-referrer"></iframe>
</body>`)
    })
    appApp.get('/hijacked', (req, res) => res.send('hijacked'))
    const appServer = await listen(appApp, 'localhost')
    const appOrigin = `http://localhost:${appServer.address().port}`
    // The probe navigates "top" to the app's own origin, the most plausible hijack target.
    await seedArtifacts(db, bucket, appOrigin)

    const artifactApp = express()
    artifactApp.use((req, res) => handleServeArtifactRequest(req, res, { db, bucket, now: Date.now() }))
    const artifactServer = await listen(artifactApp, '127.0.0.1')
    artifactOrigin = `http://127.0.0.1:${artifactServer.address().port}`

    const results = []
    const browser = await chromium.launch()
    try {
        // 1. Headers, straight from the handler.
        const entryUrl = `${artifactOrigin}/a/${PROJECT_ID}/bundle/${SECRET}/index.html`
        const direct = await fetch(entryUrl)
        const csp = direct.headers.get('content-security-policy') || ''
        check(results, 'HTML is served with a CSP sandbox', csp.startsWith('sandbox '), csp)
        check(results, 'the CSP sandbox omits allow-same-origin', !csp.includes('allow-same-origin'), csp)
        check(results, 'the CSP sandbox omits allow-top-navigation', !csp.includes('allow-top-navigation'), csp)
        check(results, 'nosniff', direct.headers.get('x-content-type-options') === 'nosniff')
        check(results, 'no-referrer', direct.headers.get('referrer-policy') === 'no-referrer')
        const wrongSecret = await fetch(
            `${artifactOrigin}/a/${PROJECT_ID}/bundle/wrong-secret-bbbbbbbbbbbbbbbb/index.html`
        )
        check(results, 'a wrong secret is a 404', wrongSecret.status === 404, wrongSecret.status)

        // 2. Framed inside the app, exactly as ArtifactPreview frames it.
        const page = await browser.newPage()
        page.on('console', message => process.env.VERBOSE && console.log('[browser]', message.text()))
        await page.goto(`${appOrigin}/app`)
        await page.waitForFunction(() => window.__probe !== null, null, { timeout: 15000 })
        await page.waitForTimeout(500)
        const framed = await page.evaluate(() => window.__probe)
        const probe = framed.results
        check(results, 'the relative script of a bundle loads', probe.relativeScriptLoaded === true)
        check(results, 'the artifact runs in an opaque origin', probe.origin === 'null', probe.origin)
        check(results, 'it cannot read the app document', !probe.parentDocument.ok, probe.parentDocument)
        check(results, "it cannot read the app's session", !probe.parentLocalStorage.ok, probe.parentLocalStorage)
        check(results, "it cannot read the app's cookies", !probe.parentCookie.ok, probe.parentCookie)
        check(results, 'it has no storage of its own', !probe.ownLocalStorage.ok, probe.ownLocalStorage)
        check(results, 'it has no cookies of its own', !probe.ownCookie.ok, probe.ownCookie)
        check(results, 'it cannot open IndexedDB', !probe.indexedDB.ok, probe.indexedDB)
        check(results, 'it cannot navigate the app away', new URL(page.url()).pathname === '/app', page.url())
        check(results, 'nothing it reported contains the session', !JSON.stringify(framed).includes(APP_SESSION))

        // 3. Opened on its own ("Open full screen"): no iframe sandbox, so only the CSP header holds.
        const standalone = await browser.newPage()
        await standalone.goto(`${artifactOrigin}/a/${PROJECT_ID}/second/${SECRET}/probe.html`)
        await standalone.waitForSelector('body[data-results]', { state: 'attached', timeout: 15000 })
        const alone = JSON.parse(await standalone.getAttribute('body', 'data-results'))
        check(results, 'opened alone it still runs in an opaque origin', alone.origin === 'null', alone.origin)
        check(results, 'opened alone it still has no storage', !alone.ownLocalStorage.ok, alone.ownLocalStorage)
        check(results, 'opened alone it still has no cookies', !alone.ownCookie.ok, alone.ownCookie)
    } finally {
        await browser.close()
        artifactServer.close()
        appServer.close()
    }

    results.forEach(result =>
        console.log(
            `${result.pass ? 'PASS' : 'FAIL'}  ${result.name}${result.pass ? '' : `  ${JSON.stringify(result.detail)}`}`
        )
    )
    const failed = results.filter(result => !result.pass).length
    console.log(`\n${results.length - failed}/${results.length} checks passed`)
    process.exit(failed ? 1 : 0)
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
