const { extractPageContent, fetchWebPage, isFetchableUrl, THIN_PAGE_TEXT_CHARS } = require('./webPageFetcher')

const htmlResponse = (html, { status = 200, url = 'https://example.com/team', contentType = 'text/html' } = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: new Headers({ 'content-type': contentType }),
    arrayBuffer: async () => Buffer.from(html, 'utf8'),
})

const SAMPLE_PAGE = `<!doctype html><html><head>
<title>Team &amp; People | Example GmbH</title>
<meta name="description" content="Meet the people behind Example">
<meta property="og:image" content="/img/anna.jpg">
<link rel="canonical" href="https://example.com/team/">
<script>window.tracking = 'x'</script>
<style>.a{}</style>
</head><body>
<nav><a href="/about">About</a></nav>
<h1>Our team</h1>
<div><p>Anna Somova is the <b>CTO</b> of Example GmbH.</p><p>She lives in Berlin &ndash; since 2019.</p></div>
<a href="https://github.com/annasomova">GitHub</a>
<a href="mailto:anna@example.com">Mail</a>
<img src="/img/anna.jpg" alt="Anna Somova">
<script>document.write('noise')</script>
</body></html>`

describe('isFetchableUrl', () => {
    test('accepts public http(s) URLs and adds a scheme to a bare host', () => {
        expect(isFetchableUrl('https://example.com/team')).toEqual({ ok: true, url: 'https://example.com/team' })
        expect(isFetchableUrl('example.com/about').url).toBe('https://example.com/about')
    })

    test('refuses LinkedIn up front instead of paying for a login redirect', () => {
        const result = isFetchableUrl('https://www.linkedin.com/in/anna-somova')
        expect(result.ok).toBe(false)
        expect(result.blockedHost).toBe(true)
        expect(result.reason).toMatch(/web_search/)
        expect(isFetchableUrl('https://media.licdn.com/dms/image/x').ok).toBe(false)
    })

    test('refuses private, loopback and metadata addresses', () => {
        for (const url of [
            'http://localhost:5001/x',
            'http://127.0.0.1/',
            'http://10.0.0.5/admin',
            'http://192.168.1.1/',
            'http://172.16.0.1/',
            'http://169.254.169.254/computeMetadata/v1/',
            'http://metadata.google.internal/',
            'http://[::1]/',
            'http://service.internal/',
        ]) {
            expect(isFetchableUrl(url).ok).toBe(false)
        }
    })

    test('refuses non-http schemes and garbage', () => {
        expect(isFetchableUrl('ftp://example.com/file').ok).toBe(false)
        expect(isFetchableUrl('').ok).toBe(false)
        expect(isFetchableUrl('http://').ok).toBe(false)
    })
})

describe('extractPageContent', () => {
    test('pulls title, description, social image, canonical url and readable text', () => {
        const page = extractPageContent(SAMPLE_PAGE, 'https://example.com/team')
        expect(page.title).toBe('Team & People | Example GmbH')
        expect(page.description).toBe('Meet the people behind Example')
        expect(page.ogImage).toBe('https://example.com/img/anna.jpg')
        expect(page.canonicalUrl).toBe('https://example.com/team/')
        expect(page.text).toContain('Anna Somova is the CTO of Example GmbH.')
        expect(page.text).toContain('Berlin – since 2019')
        expect(page.text).not.toContain('tracking')
        expect(page.text).not.toContain('noise')
        expect(page.text).not.toContain('.a{}')
    })

    test('returns absolute links without mailto/javascript ones, and the images', () => {
        const page = extractPageContent(SAMPLE_PAGE, 'https://example.com/team')
        expect(page.links).toEqual([
            { url: 'https://example.com/about', text: 'About' },
            { url: 'https://github.com/annasomova', text: 'GitHub' },
        ])
        expect(page.images).toEqual([{ url: 'https://example.com/img/anna.jpg', alt: 'Anna Somova' }])
    })

    test('truncates the text to maxChars and says so', () => {
        const page = extractPageContent(`<html><body><p>${'word '.repeat(500)}</p></body></html>`, 'https://x.com', {
            maxChars: 100,
        })
        expect(page.text).toHaveLength(100)
        expect(page.truncated).toBe(true)
    })
})

describe('fetchWebPage', () => {
    test('reads a page directly and reports the source', async () => {
        const fetchImpl = jest.fn(async () => htmlResponse(SAMPLE_PAGE))
        const result = await fetchWebPage('https://example.com/team', { fetchImpl })
        expect(result.success).toBe(true)
        expect(result.source).toBe('direct')
        expect(result.title).toBe('Team & People | Example GmbH')
        expect(result.ogImage).toBe('https://example.com/img/anna.jpg')
        expect(fetchImpl).toHaveBeenCalledTimes(1)
        expect(fetchImpl.mock.calls[0][1].headers['User-Agent']).toMatch(/AlldoneBot/)
    })

    test('never fetches a blocked host', async () => {
        const fetchImpl = jest.fn()
        const result = await fetchWebPage('https://linkedin.com/in/someone', { fetchImpl })
        expect(result).toMatchObject({ success: false, blockedHost: true })
        expect(fetchImpl).not.toHaveBeenCalled()
    })

    test('falls back to the rendering service when the site blocks a plain fetch', async () => {
        const fetchImpl = jest.fn(async () => htmlResponse('Forbidden', { status: 403 }))
        const extract = jest.fn(async () => ({
            results: [
                { url: 'https://example.com/team', title: 'Rendered', rawContent: 'Anna Somova, CTO.', images: [] },
            ],
            failedResults: [],
        }))
        const result = await fetchWebPage('https://example.com/team', {
            fetchImpl,
            tavilyApiKey: 'tvly-key',
            tavilyClientFactory: () => ({ extract }),
        })
        expect(result.success).toBe(true)
        expect(result.source).toBe('tavily')
        expect(result.text).toBe('Anna Somova, CTO.')
        expect(extract).toHaveBeenCalledWith(['https://example.com/team'], expect.any(Object))
    })

    test('reports the HTTP failure when no rendering service is configured', async () => {
        const fetchImpl = jest.fn(async () => htmlResponse('Forbidden', { status: 403 }))
        const result = await fetchWebPage('https://example.com/team', { fetchImpl, tavilyApiKey: 'your_key_here' })
        expect(result.success).toBe(false)
        expect(result.error).toMatch(/HTTP 403/)
    })

    test('reports a timeout as a page problem rather than throwing', async () => {
        const fetchImpl = jest.fn(async () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            throw error
        })
        const result = await fetchWebPage('https://example.com/slow', { fetchImpl, timeoutMs: 50 })
        expect(result.success).toBe(false)
        expect(result.error).toMatch(/did not respond/)
    })

    test('renders a JavaScript-only page through the service when the direct read is empty', async () => {
        const thin = '<html><head><title>App</title></head><body><div id="root"></div></body></html>'
        const fetchImpl = jest.fn(async () => htmlResponse(thin))
        const extract = jest.fn(async () => ({
            results: [
                { url: 'https://spa.example.com', title: 'App', rawContent: 'x'.repeat(THIN_PAGE_TEXT_CHARS + 50) },
            ],
        }))
        const result = await fetchWebPage('https://spa.example.com', {
            fetchImpl,
            tavilyApiKey: 'tvly-key',
            tavilyClientFactory: () => ({ extract }),
        })
        expect(result.source).toBe('tavily')
        expect(result.title).toBe('App')
    })

    test('refuses binary content types instead of returning garbage text', async () => {
        const fetchImpl = jest.fn(async () => htmlResponse('%PDF-1.4', { contentType: 'application/pdf' }))
        const result = await fetchWebPage('https://example.com/cv.pdf', { fetchImpl })
        expect(result.success).toBe(false)
        expect(result.error).toMatch(/application\/pdf/)
    })
})
