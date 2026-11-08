const { assertPublicUrl, fetchPublicUrl, OutboundUrlError } = require('./outboundUrlGuard')

const publicLookup = jest.fn(async () => [{ address: '93.184.216.34', family: 4 }])
const redirect = (location, status = 302) => ({ status, headers: new Headers({ location }) })
const ok = () => ({ status: 200, ok: true, headers: new Headers({}) })

describe('outbound URL guard', () => {
    test.each([
        'ftp://example.com/',
        'http://user:pw@example.com/',
        'http://127.0.0.1/',
        'http://[::ffff:7f00:1]/',
        'http://[fe80::1]/',
        'http://100.64.0.1/',
        'http://metadata.google.internal./',
        'http://localhost./',
        'http://intranet/',
    ])('refuses %s without resolving it', async url => {
        const lookup = jest.fn(publicLookup)
        await expect(assertPublicUrl(url, { lookup })).rejects.toBeInstanceOf(OutboundUrlError)
    })

    test('refuses a name when any of its addresses is private', async () => {
        const lookup = jest.fn(async () => [
            { address: '93.184.216.34', family: 4 },
            { address: 'fd12::1', family: 6 },
        ])
        await expect(assertPublicUrl('https://example.com/', { lookup })).rejects.toMatchObject({
            code: 'private_host',
        })
    })

    test('httpsOnly refuses http', async () => {
        await expect(
            assertPublicUrl('http://example.com/', { lookup: publicLookup, httpsOnly: true })
        ).rejects.toMatchObject({ code: 'unsupported_scheme' })
    })

    test('turns a 303 into a GET without a body and re-checks the hop', async () => {
        const fetchImpl = jest.fn().mockResolvedValueOnce(redirect('/next', 303)).mockResolvedValueOnce(ok())
        const { url } = await fetchPublicUrl(
            'https://example.com/a',
            { method: 'POST', body: 'x' },
            { fetchImpl, lookup: publicLookup }
        )
        expect(url).toBe('https://example.com/next')
        expect(fetchImpl.mock.calls[1][1]).toMatchObject({ method: 'GET', redirect: 'manual' })
        expect(fetchImpl.mock.calls[1][1].body).toBeUndefined()
    })

    test('stops after maxRedirects', async () => {
        const fetchImpl = jest.fn(async () => redirect('/loop'))
        await expect(
            fetchPublicUrl('https://example.com/', {}, { fetchImpl, lookup: publicLookup, maxRedirects: 2 })
        ).rejects.toMatchObject({ code: 'too_many_redirects' })
        expect(fetchImpl).toHaveBeenCalledTimes(3)
    })
})
