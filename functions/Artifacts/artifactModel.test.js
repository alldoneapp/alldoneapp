const fs = require('fs')
const path = require('path')

const {
    ARTIFACT_KINDS,
    ARTIFACT_SERVER_FIELDS,
    buildArtifactIsPublicFor,
    buildArtifactPublicUrl,
    buildArtifactServePath,
    buildArtifactServeUrl,
    getArtifactKindForMimeType,
    getLostReaderIds,
    getMimeTypeForPath,
    getTitleFromFileName,
    isActiveMimeType,
    mapArtifactData,
    normalizeArtifactPath,
    parseArtifactPublicPath,
    parseArtifactServePath,
    resolveArtifactPublicBaseUrl,
    resolveEntryPath,
    resolveRequestedFilePath,
    sortArtifactsByLastEdition,
} = require('./artifactModel')

const SECRET = 'abcdefghijklmnopqrstuvwxyz012345'
const TOKEN = 'tok_abcdefghijklmnopqr'

describe('public links', () => {
    it('live on artifacts.alldone.app in production and on the serve function everywhere else', () => {
        expect(resolveArtifactPublicBaseUrl('alldonealeph', 'https://fn.example/serveArtifact')).toBe(
            'https://artifacts.alldone.app'
        )
        expect(resolveArtifactPublicBaseUrl('alldonestaging', 'https://fn.example/serveArtifact')).toBe(
            'https://fn.example/serveArtifact'
        )
        expect(buildArtifactPublicUrl('https://artifacts.alldone.app/', TOKEN)).toBe(
            `https://artifacts.alldone.app/${TOKEN}/`
        )
        expect(buildArtifactPublicUrl('https://artifacts.alldone.app', 'short')).toBeNull()
    })

    it('parse the token and the file under it, with or without the function name', () => {
        expect(parseArtifactPublicPath(`/${TOKEN}/assets/Bericht%20Q3.html`)).toEqual({
            publicToken: TOKEN,
            path: 'assets/Bericht Q3.html',
            trailingSlash: true,
        })
        expect(parseArtifactPublicPath(`/serveArtifact/${TOKEN}`)).toEqual({
            publicToken: TOKEN,
            path: '',
            trailingSlash: false,
        })
    })

    it('never mistake an internal address, a stray file or a short segment for a token', () => {
        expect(parseArtifactPublicPath(`/a/project/artifact/${SECRET}/`)).toBeNull()
        expect(parseArtifactPublicPath('/favicon.ico')).toBeNull()
        expect(parseArtifactPublicPath('/')).toBeNull()
        expect(parseArtifactPublicPath('/serveArtifact')).toBeNull()
        expect(parseArtifactPublicPath(`/${TOKEN}/%E0%A4%A`)).toBeNull()
    })

    it('are read from the artifact only when the token is well formed', () => {
        expect(
            mapArtifactData('a1', { publicLink: { token: TOKEN, createdAt: 5, createdBy: 'u' } }).publicLink
        ).toEqual({ token: TOKEN, createdAt: 5, createdBy: 'u' })
        expect(mapArtifactData('a1', { publicLink: { token: 'x' } }).publicLink).toBeNull()
        expect(mapArtifactData('a1', {}).publicLink).toBeNull()
    })
})

describe('normalizeArtifactPath', () => {
    it('keeps a relative path as written', () => {
        expect(normalizeArtifactPath('assets/app.js')).toBe('assets/app.js')
        expect(normalizeArtifactPath('Bericht Q3.html')).toBe('Bericht Q3.html')
    })

    it('drops leading slashes and turns backslashes into slashes', () => {
        expect(normalizeArtifactPath('/index.html')).toBe('index.html')
        expect(normalizeArtifactPath('assets\\logo.png')).toBe('assets/logo.png')
    })

    it.each(['', '../secret', 'a/../b', 'a//b', './a', 'a/.', 'bad\u0000name'])('refuses %p', path => {
        expect(() => normalizeArtifactPath(path)).toThrow()
    })
})

describe('types', () => {
    it('derives the type from the file name only', () => {
        expect(getMimeTypeForPath('index.HTML')).toBe('text/html')
        expect(getMimeTypeForPath('chart.svg')).toBe('image/svg+xml')
        expect(getMimeTypeForPath('report.pdf')).toBe('application/pdf')
        expect(getMimeTypeForPath('no-extension')).toBe('application/octet-stream')
        expect(getMimeTypeForPath('.htaccess')).toBe('application/octet-stream')
    })

    it('treats every document a browser can run script in as active', () => {
        ;['text/html', 'image/svg+xml', 'application/xhtml+xml', 'application/xml'].forEach(type =>
            expect(isActiveMimeType(type)).toBe(true)
        )
        ;['application/pdf', 'image/png', 'text/plain', 'text/markdown'].forEach(type =>
            expect(isActiveMimeType(type)).toBe(false)
        )
    })

    it('maps types to the kinds the list shows', () => {
        expect(getArtifactKindForMimeType('text/html')).toBe(ARTIFACT_KINDS.WEB)
        expect(getArtifactKindForMimeType('text/markdown')).toBe(ARTIFACT_KINDS.MARKDOWN)
        expect(getArtifactKindForMimeType('application/pdf')).toBe(ARTIFACT_KINDS.PDF)
        expect(getArtifactKindForMimeType('image/svg+xml')).toBe(ARTIFACT_KINDS.IMAGE)
        expect(getArtifactKindForMimeType('text/csv')).toBe(ARTIFACT_KINDS.DATA)
        expect(getArtifactKindForMimeType('text/plain')).toBe(ARTIFACT_KINDS.TEXT)
        expect(getArtifactKindForMimeType('application/zip')).toBe(ARTIFACT_KINDS.FILE)
    })
})

describe('resolveEntryPath', () => {
    it('lands on the only file, else a root index.html, else the first HTML file', () => {
        expect(resolveEntryPath(['report.pdf'])).toBe('report.pdf')
        expect(resolveEntryPath(['app.js', 'index.html', 'page.html'])).toBe('index.html')
        expect(resolveEntryPath(['app.js', 'dashboard.html'])).toBe('dashboard.html')
        expect(resolveEntryPath(['a.png', 'b.png'])).toBe('a.png')
        expect(resolveEntryPath([])).toBeNull()
    })
})

describe('serve addresses', () => {
    const params = { projectId: 'project-a', artifactId: 'artifact_1', serveSecret: SECRET }

    it('round-trips the current version, a pinned version and encoded paths', () => {
        const current = buildArtifactServePath({ ...params, path: 'Bericht Q3.html' })
        expect(current).toBe(`/a/project-a/artifact_1/${SECRET}/Bericht%20Q3.html`)
        expect(parseArtifactServePath(current)).toEqual({ ...params, versionId: null, path: 'Bericht Q3.html' })

        const pinned = buildArtifactServePath({ ...params, versionId: 'v1', path: 'assets/app.js' })
        expect(parseArtifactServePath(pinned)).toEqual({ ...params, versionId: 'v1', path: 'assets/app.js' })
    })

    it('accepts the function name in front of the path', () => {
        expect(parseArtifactServePath(`/serveArtifact/a/project-a/artifact_1/${SECRET}/`)).toEqual({
            ...params,
            versionId: null,
            path: '',
        })
    })

    it('builds an absolute URL without doubling slashes', () => {
        expect(buildArtifactServeUrl('https://example.test/serveArtifact/', { ...params, path: 'x.html' })).toBe(
            `https://example.test/serveArtifact/a/project-a/artifact_1/${SECRET}/x.html`
        )
        expect(buildArtifactServeUrl('https://example.test', { ...params, serveSecret: null })).toBeNull()
    })

    it.each([
        '/a/project-a/artifact_1',
        '/a/project-a/artifact_1/short/index.html',
        `/a/project a/artifact_1/${SECRET}/index.html`,
        `/a/project-a/artifact_1/${SECRET}/~bad version/index.html`,
        `/b/project-a/artifact_1/${SECRET}/index.html`,
        `/a/project-a/artifact_1/${SECRET}/%E0%A4%A`,
    ])('refuses %p', path => {
        expect(parseArtifactServePath(path)).toBeNull()
    })

    it('resolves the entry file, a directory index and refuses traversal', () => {
        expect(resolveRequestedFilePath('', 'dashboard.html')).toBe('dashboard.html')
        expect(resolveRequestedFilePath('docs/', 'index.html')).toBe('docs/index.html')
        expect(resolveRequestedFilePath('../other/index.html', 'index.html')).toBeNull()
    })
})

describe('access', () => {
    it('makes a private artifact visible to its owner only', () => {
        expect(buildArtifactIsPublicFor(true, 'owner')).toEqual(['owner'])
        expect(buildArtifactIsPublicFor(false, 'owner')).toEqual([0, 'owner'])
    })

    it('reports exactly the readers that lost access', () => {
        expect(getLostReaderIds({ readerIds: [0, 'a', 'b'] }, { readerIds: ['a'] })).toEqual([0, 'b'])
        expect(getLostReaderIds({ readerIds: ['a'] }, { readerIds: [0, 'a', 'b'] })).toEqual([])
        expect(getLostReaderIds({}, { readerIds: ['a'] })).toEqual([])
    })

    // The rules are the enforcement, this list is what the server code reads; they must name the
    // same fields or a client could write one the server then trusts.
    it('protects exactly the server-owned fields in firestore.rules', () => {
        const rules = fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8')
        const block = rules.match(/function artifactServerFieldsUnchanged\(\)[\s\S]*?\]\);/)
        expect(block).not.toBeNull()
        const ruleFields = [...block[0].matchAll(/'([A-Za-z]+)'/g)].map(match => match[1]).sort()
        expect(ruleFields).toEqual([...ARTIFACT_SERVER_FIELDS].sort())
    })
})

it('names an artifact after its file and sorts the newest edit first', () => {
    expect(getTitleFromFileName('sales_dashboard.html')).toBe('sales dashboard')
    expect(getTitleFromFileName('README')).toBe('README')
    expect(
        sortArtifactsByLastEdition([
            { id: 'a', lastEditionDate: T + 1 },
            { id: 'b', lastEditionDate: T + 3 },
            { id: 'c', lastEditionDate: T + 2 },
        ]).map(artifact => artifact.id)
    ).toEqual(['b', 'c', 'a'])
})

const T = Date.UTC(2026, 9, 1)

describe('legacy and malformed dates (AT-2887)', () => {
    // Legacy tasks from 2020 carry the old "Someday" sentinel as their edition stamp.
    const SENTINEL = Number.MAX_SAFE_INTEGER

    it('falls back to the creation time when the edition stamp is a sentinel', () => {
        expect(mapArtifactData('a', { lastEditionDate: SENTINEL, created: T }).lastEditionDate).toBe(T)
        expect(mapArtifactData('a', { lastEditionDate: SENTINEL }).lastEditionDate).toBe(0)
        expect(mapArtifactData('a', { created: { seconds: T / 1000, nanoseconds: 0 } }).created).toBe(T)
    })

    it('sorts a sentinel last instead of above every real date, deterministically', () => {
        expect(
            sortArtifactsByLastEdition([
                { id: 'sentinel', lastEditionDate: SENTINEL },
                { id: 'old', lastEditionDate: T - 1000 },
                { id: 'missing' },
                { id: 'new', lastEditionDate: T },
            ]).map(artifact => artifact.id)
        ).toEqual(['new', 'old', 'missing', 'sentinel'])
    })
})
