'use strict'

// Natural-height artifact frames (AT-2881), in real Chromium.
//
// jsdom computes no layout, so whether a framed page reports the right height, and whether a page
// whose height depends on its own viewport settles instead of growing forever, can only be seen in
// a browser. This drives the REAL serveArtifact handler (in-memory Firestore and Storage) on one
// origin and a stand-in app page on another, which frames each artifact with the sandbox
// ArtifactPreview uses and applies reported heights the way useArtifactFrameHeight does.
//
//   node browser-tests/artifacts/frameHeight.js        exit code 0 = pass

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
const { ARTIFACT_BRIDGE_SANDBOX } = require(path.join(REPO, 'functions/Artifacts/artifactDataBridge'))
const { ARTIFACT_FRAME_PROTOCOL, MAX_FRAME_CONTENT_HEIGHT, MIN_FRAME_CONTENT_HEIGHT } = require(
    path.join(REPO, 'functions/Artifacts/artifactFrameHeight')
)

const PROJECT_ID = 'project-a'
const SECRET = 'harness-secret-aaaaaaaaaaaaaaaaaaaa'

const previewSource = fs.readFileSync(path.join(REPO, 'components/ArtifactsView/ArtifactPreview.js'), 'utf8')
const sandboxMatch = previewSource.match(/ARTIFACT_IFRAME_SANDBOX\s*=\s*\n?\s*'([^']+)'/)
if (!sandboxMatch) throw new Error('Could not read ARTIFACT_IFRAME_SANDBOX from ArtifactPreview.js')
const IFRAME_SANDBOX = sandboxMatch[1]

// Each page also answers "do you still scroll?" so the harness can see the inner scrollbar is gone.
const OVERFLOW_PROBE = `<script>
window.addEventListener('message', function (e) {
  if (e.data !== 'overflow?') return;
  var root = document.documentElement;
  parent.postMessage({ type: 'overflow', id: location.pathname, overflow: root.scrollHeight - root.clientHeight }, '*');
});
</script>`

const page = (body, style = '') =>
    `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}${style}</style></head><body>${body}${OVERFLOW_PROBE}</body></html>`

const ARTIFACTS = {
    tall: page('<div style="height:3000px;background:linear-gradient(#fff,#ccc)">tall report</div>'),
    short: page('<div style="height:180px">short</div>'),
    dynamic: page(
        '<div id="box" style="height:300px">dynamic</div>' +
            `<script>
              setTimeout(function () { document.getElementById('box').style.height = '1200px' }, 400);
              setTimeout(function () { document.getElementById('box').style.height = '450px' }, 1200);
            </script>`
    ),
    viewportLoop: page('<div>grows with its viewport</div>', 'body{min-height:calc(100vh + 40px)}'),
    fullViewport: page('<div>exactly the viewport</div>', 'html,body{height:100%}'),
    absoluteBottom: page(
        '<div style="height:200px">flow</div><div style="position:absolute;top:900px;height:100px">absolute</div>'
    ),
    wide: page('<div style="width:4000px;height:700px">wide</div>'),
    bridged: page('<div style="height:1600px">bridged</div>'),
}

async function seed(db, bucket) {
    const names = Object.keys(ARTIFACTS)
    const ids = names.flatMap(name => [name, `${name}-v1`])
    for (const name of names) {
        await commitArtifactVersion({
            db,
            bucket,
            newId: () => ids.shift(),
            newSecret: () => SECRET,
            userId: 'owner',
            projectId: PROJECT_ID,
            files: [{ path: 'index.html', base64: Buffer.from(ARTIFACTS[name]).toString('base64') }],
        })
    }
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
    await seed(db, bucket)

    const artifactApp = express()
    artifactApp.use((req, res) => handleServeArtifactRequest(req, res, { db, bucket, now: Date.now() }))
    const artifactServer = await listen(artifactApp, '127.0.0.1')
    const artifactOrigin = `http://127.0.0.1:${artifactServer.address().port}`
    const urlOf = (name, query = '') => `${artifactOrigin}/a/${PROJECT_ID}/${name}/${SECRET}/index.html${query}`

    const appApp = express()
    appApp.get('/app', (req, res) => {
        const frames = Object.keys(ARTIFACTS)
            .map(name =>
                name === 'bridged'
                    ? `<iframe id="${name}" src="${urlOf(name, '?alldone-bridge=1')}" sandbox="${ARTIFACT_BRIDGE_SANDBOX}"></iframe>`
                    : `<iframe id="${name}" src="${urlOf(name)}" sandbox="${IFRAME_SANDBOX}"></iframe>`
            )
            .join('\n')
        res.set('Content-Type', 'text/html; charset=utf-8')
        res.send(`<!doctype html><title>Alldone app</title>
<style>iframe{display:block;width:600px;height:500px;border:1px solid #ccc;box-sizing:content-box;margin-bottom:8px}</style>
<body>${frames}
<script>
  // What useArtifactFrameHeight does: this frame's window only, an opaque origin only, clamped.
  window.__reports = {}; window.__overflow = {}; window.__foreign = 0;
  window.addEventListener('message', function (event) {
    var frame = Array.prototype.find.call(document.querySelectorAll('iframe'), function (f) {
      return f.contentWindow === event.source;
    });
    var data = event.data || {};
    if (data.type === 'overflow' && frame) { window.__overflow[frame.id] = data.overflow; return; }
    if (data.protocol !== '${ARTIFACT_FRAME_PROTOCOL}' || data.type !== 'height') return;
    if (!frame || event.origin !== 'null') { window.__foreign += 1; return; }
    var h = Math.min(${MAX_FRAME_CONTENT_HEIGHT}, Math.max(${MIN_FRAME_CONTENT_HEIGHT}, Math.ceil(Number(data.height))));
    (window.__reports[frame.id] = window.__reports[frame.id] || []).push(h);
    frame.style.height = h + 'px';
  });
</script></body>`)
    })
    const appServer = await listen(appApp, 'localhost')
    const appOrigin = `http://localhost:${appServer.address().port}`

    const results = []
    const browser = await chromium.launch()
    try {
        const tab = await browser.newPage({ viewport: { width: 1000, height: 800 } })
        await tab.goto(`${appOrigin}/app`)
        await tab.waitForTimeout(4000)
        const state = await tab.evaluate(async () => {
            document.querySelectorAll('iframe').forEach(frame => frame.contentWindow.postMessage('overflow?', '*'))
            await new Promise(resolve => setTimeout(resolve, 300))
            const heights = {}
            document.querySelectorAll('iframe').forEach(frame => (heights[frame.id] = frame.clientHeight))
            return { reports: window.__reports, overflow: window.__overflow, heights, foreign: window.__foreign }
        })
        if (process.env.VERBOSE) console.log(JSON.stringify(state, null, 2))
        const { heights, overflow, reports } = state
        const count = name => (reports[name] || []).length

        check(results, 'a tall page is framed at its full height', heights.tall === 3000, heights.tall)
        check(results, 'a tall page no longer scrolls inside its frame', overflow.tall === 0, overflow.tall)
        check(results, 'a short page shrinks the frame to its height', heights.short === 180, heights.short)
        check(results, 'a page that changes is followed, up and down', heights.dynamic === 450, reports.dynamic)
        check(results, 'a changing page did not scroll at the end', overflow.dynamic === 0, overflow.dynamic)
        check(
            results,
            'a page that grows with its viewport settles instead of growing forever',
            count('viewportLoop') < 12 && heights.viewportLoop < 1500,
            { reports: reports.viewportLoop, height: heights.viewportLoop }
        )
        check(results, 'a 100% tall page is stable', count('fullViewport') <= 2, reports.fullViewport)
        check(
            results,
            'an absolutely positioned bottom is shown in full without flipping',
            heights.absoluteBottom === 1000 && overflow.absoluteBottom === 0 && count('absoluteBottom') < 6,
            { reports: reports.absoluteBottom, height: heights.absoluteBottom, overflow: overflow.absoluteBottom }
        )
        check(
            results,
            'a wide page keeps its horizontal scrollbar without a vertical one',
            overflow.wide === 0 && count('wide') < 6,
            { reports: reports.wide, height: heights.wide, overflow: overflow.wide }
        )
        check(
            results,
            'a data-bound page under the locked-down policy reports too',
            heights.bridged === 1600,
            heights.bridged
        )
        check(results, 'no height came from anywhere but the frames', state.foreign === 0, state.foreign)

        // Full screen: a top-level document gets the stored file, with no reporter in it.
        const direct = await browser.newPage()
        const response = await direct.goto(urlOf('tall'))
        const body = await response.text()
        check(results, 'full screen serves the stored bytes', body === ARTIFACTS.tall, body.length)
        const framedBody = await (await fetch(urlOf('tall'), { headers: { 'Sec-Fetch-Dest': 'iframe' } })).text()
        check(results, 'a framed load carries the reporter', framedBody.includes('data-alldone-frame-height'))
        const scriptsLeft = await tab.evaluate(() => document.querySelector('#tall').contentWindow.length)
        check(results, 'the frame is still a single document', scriptsLeft === 0, scriptsLeft)
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
    console.log(`\n${results.length - failed}/${results.length} passed`)
    process.exit(failed ? 1 : 0)
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
