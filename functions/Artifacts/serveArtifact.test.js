const { Writable } = require('stream')

const { KnowledgeFirestoreDouble } = require('../KnowledgeBase/__fixtures__/knowledgeFirestoreDouble')
const { ArtifactBucketDouble } = require('./__fixtures__/artifactBucketDouble')
const { commitArtifactVersion } = require('./artifactStore')
const { ARTIFACT_BRIDGE_CONTENT_SECURITY_POLICY, ARTIFACT_BRIDGE_SCRIPT } = require('./artifactDataBridge')
const {
    ACTIVE_CONTENT_SECURITY_POLICY,
    clearServeArtifactCaches,
    handleServeArtifactRequest,
} = require('./serveArtifact')

const PROJECT_ID = 'project-a'
const SECRET = 'secret-one-aaaaaaaaaaaaaaaaaaaaaa'
const NOW = 1_800_000_000_000
const base64 = text => Buffer.from(text).toString('base64')

let db
let bucket

// Enough of an express response to observe status, headers and the streamed body.
function createResponse() {
    const chunks = []
    const res = new Writable({
        write(chunk, _encoding, callback) {
            chunks.push(Buffer.from(chunk))
            callback()
        },
    })
    res.statusCode = 200
    res.headers = {}
    res.headersSent = false
    res.status = code => {
        res.statusCode = code
        return res
    }
    res.set = (name, value) => {
        if (typeof name === 'object') Object.entries(name).forEach(([key, val]) => (res.headers[key] = val))
        else res.headers[name] = value
        return res
    }
    res.send = body => {
        res.headersSent = true
        chunks.push(Buffer.from(body))
        res.emit('finish')
    }
    const end = res.end.bind(res)
    res.end = (...args) => {
        res.headersSent = true
        return end(...args)
    }
    res.body = () => Buffer.concat(chunks).toString()
    return res
}

async function request(path, { method = 'GET', headers = {}, query = {} } = {}) {
    const res = createResponse()
    const req = { method, path, query, get: name => headers[name.toLowerCase()] }
    await handleServeArtifactRequest(req, res, { db, bucket, now: NOW })
    return res
}

async function seed(files, extra = {}) {
    const ids = ['artifact1', 'version1', 'version2']
    await commitArtifactVersion({
        db,
        bucket,
        now: NOW,
        newId: () => ids.shift(),
        newSecret: () => SECRET,
        userId: 'owner',
        projectId: PROJECT_ID,
        files,
        ...extra,
    })
}

const artifactUrl = path => `/serveArtifact/a/${PROJECT_ID}/artifact1/${SECRET}/${path}`

beforeEach(() => {
    clearServeArtifactCaches()
    db = new KnowledgeFirestoreDouble({ [`projects/${PROJECT_ID}`]: { userIds: ['owner'] } })
    bucket = new ArtifactBucketDouble()
})

it('serves an HTML artifact sandboxed, without sniffing and without leaking its address', async () => {
    await seed([{ path: 'index.html', base64: base64('<h1>Hi</h1>') }])

    const res = await request(artifactUrl(''))

    expect(res.statusCode).toBe(200)
    expect(res.body()).toBe('<h1>Hi</h1>')
    expect(res.headers).toMatchObject({
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': ACTIVE_CONTENT_SECURITY_POLICY,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'private, max-age=60',
    })
    expect(ACTIVE_CONTENT_SECURITY_POLICY).toMatch(/^sandbox /)
    expect(ACTIVE_CONTENT_SECURITY_POLICY).not.toContain('allow-same-origin')
    expect(ACTIVE_CONTENT_SECURITY_POLICY).not.toContain('allow-top-navigation')
})

it('sandboxes an SVG too, because it can carry script', async () => {
    await seed([{ path: 'chart.svg', base64: base64('<svg xmlns="http://www.w3.org/2000/svg"/>') }])
    const res = await request(artifactUrl('chart.svg'))
    expect(res.headers['Content-Security-Policy']).toBe(ACTIVE_CONTENT_SECURITY_POLICY)
})

it('serves a PDF inline and an unknown type as a download, neither sandboxed', async () => {
    await seed([
        { path: 'report.pdf', base64: base64('%PDF-1.7') },
        { path: 'data.bin', base64: base64('raw') },
    ])

    const pdf = await request(artifactUrl('report.pdf'))
    expect(pdf.headers['Content-Type']).toBe('application/pdf')
    expect(pdf.headers['Content-Disposition']).toMatch(/^inline; /)
    expect(pdf.headers['Content-Security-Policy']).toBeUndefined()

    const bin = await request(artifactUrl('data.bin'))
    expect(bin.headers['Content-Type']).toBe('application/octet-stream')
    expect(bin.headers['Content-Disposition']).toMatch(/^attachment; /)
})

it('resolves relative files of a multi-file artifact under the same address', async () => {
    await seed([
        { path: 'index.html', base64: base64('<script src="assets/app.js"></script>') },
        { path: 'assets/app.js', base64: base64('console.log(1)') },
    ])

    const res = await request(artifactUrl('assets/app.js'))
    expect(res.statusCode).toBe(200)
    expect(res.body()).toBe('console.log(1)')
    expect(res.headers['Content-Type']).toBe('text/javascript; charset=utf-8')
})

it('serves a pinned version as immutable even after a newer one exists', async () => {
    await seed([{ path: 'index.html', base64: base64('v1') }])
    expect((await request(artifactUrl(''))).body()).toBe('v1')
    await seed([{ path: 'index.html', base64: base64('v2') }], { artifactId: 'artifact1' })

    // The artifact document is cached for up to a minute per instance.
    expect((await request(artifactUrl(''))).body()).toBe('v1')

    clearServeArtifactCaches()
    expect((await request(artifactUrl(''))).body()).toBe('v2')

    const pinned = await request(`/a/${PROJECT_ID}/artifact1/${SECRET}/~version1/index.html`)
    expect(pinned.body()).toBe('v1')
    expect(pinned.headers['Cache-Control']).toBe('private, max-age=31536000, immutable')
})

it('answers a wrong secret, a missing artifact and a missing file with the same 404', async () => {
    await seed([{ path: 'index.html', base64: base64('<h1>Hi</h1>') }])

    const wrongSecret = await request(`/a/${PROJECT_ID}/artifact1/secret-two-bbbbbbbbbbbbbbbbbbbbbb/`)
    const missingArtifact = await request(`/a/${PROJECT_ID}/artifact9/${SECRET}/`)
    const missingFile = await request(artifactUrl('nope.html'))
    const traversal = await request(artifactUrl('..%2F..%2Fsecret'))

    ;[wrongSecret, missingArtifact, missingFile, traversal].forEach(res => {
        expect(res.statusCode).toBe(404)
        expect(res.body()).toBe('Not found')
    })
})

it('stops serving the old address once the secret is rotated', async () => {
    await seed([{ path: 'index.html', base64: base64('<h1>Hi</h1>') }])
    await db.doc(`artifactItems/${PROJECT_ID}/artifacts/artifact1`).update({
        serveSecret: 'secret-two-bbbbbbbbbbbbbbbbbbbbbb',
    })
    clearServeArtifactCaches()

    expect((await request(artifactUrl(''))).statusCode).toBe(404)
    expect((await request(`/a/${PROJECT_ID}/artifact1/secret-two-bbbbbbbbbbbbbbbbbbbbbb/`)).statusCode).toBe(200)
})

it('answers a matching ETag with 304 and refuses methods other than GET and HEAD', async () => {
    await seed([{ path: 'index.html', base64: base64('<h1>Hi</h1>') }])
    const first = await request(artifactUrl(''))

    const revalidated = await request(artifactUrl(''), { headers: { 'if-none-match': first.headers.ETag } })
    expect(revalidated.statusCode).toBe(304)

    const head = await request(artifactUrl(''), { method: 'HEAD' })
    expect(head.statusCode).toBe(200)
    expect(head.body()).toBe('')

    expect((await request(artifactUrl(''), { method: 'POST' })).statusCode).toBe(405)
})

describe('live data bridge', () => {
    it('serves the bridge script under every artifact address, but only under a real one', async () => {
        await seed([{ path: 'reports/index.html', base64: base64('<h1>Hi</h1>') }])

        for (const path of ['_alldone/bridge.js', 'reports/_alldone/bridge.js']) {
            const res = await request(artifactUrl(path))
            expect(res.statusCode).toBe(200)
            expect(res.body()).toBe(ARTIFACT_BRIDGE_SCRIPT)
            expect(res.headers['Content-Type']).toBe('text/javascript; charset=utf-8')
        }
        const wrongSecret = await request(
            `/serveArtifact/a/${PROJECT_ID}/artifact1/${'x'.repeat(32)}/_alldone/bridge.js`
        )
        expect(wrongSecret.statusCode).toBe(404)
    })

    it('locks a page down when it is framed for the bridge, whatever the artifact document says', async () => {
        await seed([{ path: 'index.html', base64: base64('<h1>Hi</h1>') }])

        const bridged = await request(artifactUrl(''), { query: { 'alldone-bridge': '1' } })
        expect(bridged.headers['Content-Security-Policy']).toBe(ARTIFACT_BRIDGE_CONTENT_SECURITY_POLICY)
        expect(ARTIFACT_BRIDGE_CONTENT_SECURITY_POLICY).toMatch(/^sandbox allow-scripts;/)
        expect(ARTIFACT_BRIDGE_CONTENT_SECURITY_POLICY).toContain("connect-src 'none'")
        expect(ARTIFACT_BRIDGE_CONTENT_SECURITY_POLICY).toContain("form-action 'none'")
        expect(ARTIFACT_BRIDGE_CONTENT_SECURITY_POLICY).toContain("default-src 'none'")
        expect(ARTIFACT_BRIDGE_CONTENT_SECURITY_POLICY).not.toMatch(/allow-(same-origin|popups|forms|top-navigation)/)

        const plain = await request(artifactUrl(''))
        expect(plain.headers['Content-Security-Policy']).toBe(ACTIVE_CONTENT_SECURITY_POLICY)
    })
})
