const dns = require('dns')
const { extractPageContent, fetchWebPage, isFetchableUrl, THIN_PAGE_TEXT_CHARS } = require('./webPageFetcher')

// Every fetch resolves its host first (outbound URL guard); keep the suite off the network.
const PUBLIC_ANSWER = [{ address: '93.184.216.34', family: 4 }]
beforeEach(() => {
    jest.spyOn(dns.promises, 'lookup').mockResolvedValue(PUBLIC_ANSWER)
})
afterEach(() => jest.restoreAllMocks())

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
            // NV-21: forms the old string regexes let through
            'http://[::ffff:127.0.0.1]/',
            'http://[::ffff:169.254.169.254]/computeMetadata/v1/',
            'http://[fd00::1]/',
            'http://[fe80::1]/',
            'http://[::]/',
            'http://100.100.100.200/',
            'http://metadata.google.internal./',
            'http://localhost./',
            'http://intranet/',
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
        expect(result.browserRecommended).toBeUndefined()
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

    test('recommends the real browser for a client-side fragment route even when the base shell is long', async () => {
        const appShell = `<html><head><title>Events</title></head><body>${'<a>Navigation</a>'.repeat(
            300
        )}</body></html>`
        const fetchImpl = jest.fn(async () =>
            htmlResponse(appShell, { url: 'https://events.example.com/calendar.html' })
        )

        const result = await fetchWebPage(
            'https://events.example.com/calendar.html#/setCard.detail.html/specific-event.html',
            { fetchImpl }
        )

        expect(result.success).toBe(true)
        expect(result.text.length).toBeGreaterThan(THIN_PAGE_TEXT_CHARS)
        expect(result.browserRecommended).toBe(true)
        expect(result.browserReason).toBe('client_side_fragment_route')
        expect(result.note).toMatch(/does not send the fragment/i)
        expect(result.note).toMatch(/browser_navigate/)
    })

    test('recommends the real browser when a direct fetch returns only a thin app shell', async () => {
        const fetchImpl = jest.fn(async () => htmlResponse('<html><body><div id="root"></div></body></html>'))
        const result = await fetchWebPage('https://spa.example.com/app', { fetchImpl })

        expect(result.success).toBe(true)
        expect(result.browserRecommended).toBe(true)
        expect(result.browserReason).toBe('client_rendered_app_shell')
        expect(result.note).toMatch(/browser_navigate/)
    })

    test('refuses binary content types instead of returning garbage text', async () => {
        const fetchImpl = jest.fn(async () => htmlResponse('%PDF-1.4', { contentType: 'application/pdf' }))
        const result = await fetchWebPage('https://example.com/cv.pdf', { fetchImpl })
        expect(result.success).toBe(false)
        expect(result.error).toMatch(/application\/pdf/)
    })
})

describe('fetchWebPage address policy (NV-21)', () => {
    const redirectResponse = location => ({
        ok: false,
        status: 302,
        url: '',
        headers: new Headers({ location }),
        arrayBuffer: async () => Buffer.alloc(0),
    })

    test('never fetches a public name whose DNS answer is private', async () => {
        dns.promises.lookup.mockResolvedValue([{ address: '10.1.2.3', family: 4 }])
        const fetchImpl = jest.fn()
        const result = await fetchWebPage('https://rebind.example.com/', {
            fetchImpl,
            tavilyApiKey: 'tvly-key',
            tavilyClientFactory: () => ({ extract: jest.fn() }),
        })
        expect(result).toMatchObject({ success: false, error: expect.stringMatching(/Private or internal/) })
        expect(fetchImpl).not.toHaveBeenCalled()
    })

    test('refuses an IPv4-mapped private DNS answer', async () => {
        dns.promises.lookup.mockResolvedValue([{ address: '::ffff:169.254.169.254', family: 6 }])
        const fetchImpl = jest.fn()
        const result = await fetchWebPage('https://mapped.example.com/', { fetchImpl })
        expect(result.success).toBe(false)
        expect(fetchImpl).not.toHaveBeenCalled()
    })

    test('follows redirects by hand and refuses a hop that points inward', async () => {
        const fetchImpl = jest.fn(async () => redirectResponse('http://127.0.0.1:8080/internal-secret'))
        const result = await fetchWebPage('https://example.com/start', { fetchImpl })
        expect(result).toMatchObject({ success: false, error: expect.stringMatching(/Private or internal/) })
        expect(fetchImpl).toHaveBeenCalledTimes(1)
        expect(fetchImpl.mock.calls[0][1].redirect).toBe('manual')
    })

    test('refuses a redirect hop whose name resolves privately', async () => {
        dns.promises.lookup.mockImplementation(async host =>
            host === 'inside.example.com' ? [{ address: 'fd00::5', family: 6 }] : PUBLIC_ANSWER
        )
        const fetchImpl = jest.fn(async () => redirectResponse('https://inside.example.com/'))
        const result = await fetchWebPage('https://example.com/start', { fetchImpl })
        expect(result.success).toBe(false)
        expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    test('follows a public redirect and reports the final URL', async () => {
        const fetchImpl = jest
            .fn()
            .mockResolvedValueOnce(redirectResponse('/team'))
            .mockResolvedValueOnce(htmlResponse(SAMPLE_PAGE, { url: '' }))
        const result = await fetchWebPage('https://example.com/start', { fetchImpl })
        expect(result.success).toBe(true)
        expect(result.finalUrl).toBe('https://example.com/team')
        expect(fetchImpl.mock.calls[1][0]).toBe('https://example.com/team')
    })

    test('a redirect to LinkedIn is refused like a direct request', async () => {
        const fetchImpl = jest.fn(async () => redirectResponse('https://www.linkedin.com/in/someone'))
        const result = await fetchWebPage('https://example.com/start', { fetchImpl })
        expect(result).toMatchObject({ success: false, blockedHost: true })
        expect(fetchImpl).toHaveBeenCalledTimes(1)
    })
})
