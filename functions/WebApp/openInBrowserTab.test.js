/**
 * AT-2345 — the out-of-scope bounce used to escape an installed PWA window.
 *
 * It is a redirector, so the interesting tests are the ones that prove it is NOT an open
 * redirect: anything that is not an Alldone origin must be refused with 400, never 302'd.
 */
const { handleOpenInBrowserTab, isAllowedRedirectTarget } = require('./openInBrowserTab')

const makeRes = () => {
    const res = {
        headers: {},
        statusCode: null,
        body: null,
        redirectedTo: null,
        redirectStatus: null,
    }
    res.set = (key, value) => {
        res.headers[key] = value
        return res
    }
    res.status = code => {
        res.statusCode = code
        return res
    }
    res.send = body => {
        res.body = body
        return res
    }
    res.redirect = (status, url) => {
        res.redirectStatus = status
        res.redirectedTo = url
        return res
    }
    return res
}

describe('isAllowedRedirectTarget', () => {
    test.each([
        'https://my.alldone.app/projects/p1/notes/n1/editor',
        'https://mystaging.alldone.app/projects/p1/notes/n1/editor',
        'https://alldone.app/',
        'https://alldonealeph.web.app/projects/p1',
        'https://alldonestaging.firebaseapp.com/projects/p1',
        'https://alldonestaging--webpack-my-branch-a1b2c3d4.web.app/projects/p1',
        'http://localhost:19006/projects/p1',
    ])('allows the Alldone origin %s', url => {
        expect(isAllowedRedirectTarget(url)).not.toBeNull()
    })

    test.each([
        ['a foreign origin', 'https://evil.example.com/phish'],
        ['a lookalike suffix', 'https://alldone.app.evil.com/phish'],
        ['a lookalike prefix', 'https://notalldone.app/phish'],
        ['an unrelated web.app site', 'https://someoneelse.web.app/phish'],
        ['a preview-channel lookalike', 'https://alldonestaging--x.web.app.evil.com/phish'],
        ['plain http on a real host', 'http://my.alldone.app/projects/p1'],
        ['a javascript: url', 'javascript:alert(1)'],
        ['a data: url', 'data:text/html,<script>alert(1)</script>'],
        ['a protocol-relative url', '//evil.example.com/phish'],
        ['a relative path', '/projects/p1'],
        ['an empty string', ''],
        ['a non-string', 42],
        ['undefined', undefined],
    ])('refuses %s', (_label, url) => {
        expect(isAllowedRedirectTarget(url)).toBeNull()
    })

    test('refuses an absurdly long url', () => {
        expect(isAllowedRedirectTarget(`https://my.alldone.app/${'a'.repeat(3000)}`)).toBeNull()
    })
})

describe('handleOpenInBrowserTab', () => {
    test('302s to an allowlisted Alldone url', () => {
        const res = makeRes()
        const target = 'https://my.alldone.app/projects/p1/notes/n1/editor'

        handleOpenInBrowserTab({ query: { u: target } }, res)

        expect(res.redirectStatus).toBe(302)
        expect(res.redirectedTo).toBe(target)
        expect(res.statusCode).toBeNull()
    })

    test('never caches the redirect and leaks no referrer', () => {
        const res = makeRes()

        handleOpenInBrowserTab({ query: { u: 'https://my.alldone.app/projects/p1' } }, res)

        expect(res.headers['Cache-Control']).toBe('no-store')
        expect(res.headers['Referrer-Policy']).toBe('no-referrer')
    })

    test('rejects a foreign target with 400 instead of redirecting to it', () => {
        const res = makeRes()

        handleOpenInBrowserTab({ query: { u: 'https://evil.example.com' } }, res)

        expect(res.statusCode).toBe(400)
        expect(res.redirectedTo).toBeNull()
    })

    test('rejects a missing target', () => {
        const res = makeRes()

        handleOpenInBrowserTab({ query: {} }, res)

        expect(res.statusCode).toBe(400)
        expect(res.redirectedTo).toBeNull()
    })

    test('handles a repeated query parameter by validating the first value', () => {
        const res = makeRes()

        handleOpenInBrowserTab({ query: { u: ['https://evil.example.com', 'https://my.alldone.app/x'] } }, res)

        expect(res.statusCode).toBe(400)
        expect(res.redirectedTo).toBeNull()
    })

    test('survives a request with no query object at all', () => {
        const res = makeRes()

        expect(() => handleOpenInBrowserTab({}, res)).not.toThrow()
        expect(res.statusCode).toBe(400)
    })
})
