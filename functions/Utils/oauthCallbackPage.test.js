'use strict'

// Security audit 2026-11: the OAuth callback pages (served on the app origin) reflected `error`,
// `state` and error messages into HTML and <script> unencoded.

const fs = require('fs')
const path = require('path')
const { sendOpenerMessagePage, escapeHtml, scriptJson, normalizeOAuthErrorCode } = require('./oauthCallbackPage')

const PAYLOADS = [
    `</script><script>window.__pwned=1</script>`,
    `'});window.__pwned=1;//`,
    `<img src=x onerror="window.__pwned=1">`,
    '\u2028window.__pwned=1',
]

function capture() {
    const res = { headers: {}, body: '', statusCode: 0 }
    res.set = (k, v) => {
        res.headers[k.toLowerCase()] = v
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
    return res
}

describe('oauthCallbackPage', () => {
    test.each(PAYLOADS)('a hostile value cannot leave the script or the page markup: %s', payload => {
        const res = capture()
        sendOpenerMessagePage(
            res,
            { type: 'oauth_error', error: payload, state: payload },
            { bodyHtml: `<p>${escapeHtml(payload)}</p>` }
        )
        // Exactly one script element, the one we wrote.
        expect(res.body.match(/<script/g)).toHaveLength(1)
        expect(res.body.match(/<\/script>/g)).toHaveLength(1)
        expect(res.body).not.toContain('<img')
        const script = res.body.slice(res.body.indexOf('<script'))
        expect(script).not.toContain('\u2028')
        // The value still round-trips intact to the opener.
        const json = res.body.slice(res.body.indexOf('var m=') + 'var m='.length, res.body.indexOf(';["https://'))
        expect(JSON.parse(json).error).toBe(payload)
    })

    test('the page carries a nonce CSP that matches its only script', () => {
        const res = capture()
        sendOpenerMessagePage(res, { type: 'oauth_success' })
        const nonce = /'nonce-([^']+)'/.exec(res.headers['content-security-policy'])[1]
        expect(res.body).toContain(`<script nonce="${nonce}">`)
        expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
    })

    // NV-23: '*' handed the result to whatever page opened the popup.
    test('posts only to Alldone app origins, never to any origin', () => {
        const res = capture()
        sendOpenerMessagePage(res, { type: 'oauth_success' })
        expect(res.body).not.toContain("'*'")
        expect(res.body).not.toContain('"*"')
        expect(res.body).toContain('"https://my.alldone.app"')
        expect(res.body).toContain('postMessage(m,o)')

        const custom = capture()
        sendOpenerMessagePage(custom, { type: 'oauth_success' }, { targetOrigins: ['https://example.test'] })
        expect(custom.body).toContain('["https://example.test"].forEach')
    })

    test('the opener script delivers the message once per app origin and nowhere else', () => {
        const res = capture()
        sendOpenerMessagePage(res, { type: 'oauth_success', ok: true })
        const script = res.body.slice(
            res.body.indexOf('>', res.body.indexOf('<script')) + 1,
            res.body.indexOf('</script>')
        )
        const posted = []
        const window = { opener: { postMessage: (message, origin) => posted.push([message, origin]) }, close: () => {} }
        new Function('window', 'setTimeout', script)(window, fn => fn())
        expect(posted.length).toBeGreaterThan(1)
        posted.forEach(([message, origin]) => {
            expect(message).toEqual({ type: 'oauth_success', ok: true })
            expect(origin).toMatch(/^https:\/\//)
        })
    })

    test('provider error codes are kept only when they are plain codes', () => {
        expect(normalizeOAuthErrorCode('access_denied')).toBe('access_denied')
        expect(normalizeOAuthErrorCode(PAYLOADS[0])).toBe('oauth_failed')
        expect(scriptJson('</script>')).toBe('"\\u003c/script\\u003e"')
    })
})

describe('functions/index.js wiring (security audit 2026-11)', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
    const exportBody = name => {
        const start = source.indexOf(`exports.${name} = `)
        expect(start).toBeGreaterThan(-1)
        return source.slice(start, source.indexOf('\n)\n', start))
    }

    test.each(['googleOAuthCallback', 'microsoftOAuthCallback', 'mcpClientOAuthCallback'])(
        '%s renders only through the safe page helper',
        name => {
            const body = exportBody(name)
            expect(body).toContain('sendOpenerMessagePage')
            expect(body).not.toMatch(/res\.send\(`/)
            expect(body).not.toMatch(/<script>/)
        }
    )

    test('the removed public endpoints stay removed', () => {
        for (const name of ['sanityCheckSecondGen', 'getLinkPreviewDataSecondGen', 'backfillLastLogin']) {
            expect(source).not.toContain(`exports.${name} = `)
        }
    })

    test('increaseVersionSecondGen requires the administrator', () => {
        const body = exportBody('increaseVersionSecondGen')
        expect(body).toContain('verifyIdToken')
        expect(body).toContain('assertAdministrator(decoded.uid)')
    })

    test('executeWebhookForMessage requires a signed-in caller with task access', () => {
        const body = exportBody('executeWebhookForMessage')
        expect(body).toMatch(/if \(!uid\) throw new HttpsError\('unauthenticated'/)
        expect(body).toContain("assertObjectAccess(admin.firestore(), uid, projectId, 'tasks', objectId)")
        expect(body).toContain('userId: uid')
        expect(body).not.toContain('request.data)')
    })

    test.each(['generateBotWelcomeMessageSecondGen', 'generateBotWelcomeMessageToUserSecondGen'])(
        '%s resolves its identity through welcomeMessageAccess',
        name => {
            const body = exportBody(name)
            expect(body).toContain('resolveWelcomeMessageRequest(admin.firestore(), request')
            expect(body).not.toMatch(/data\.userId|userIdsToNotify,\n\s+guideName,\n\s+language,\n\s+userId/)
        }
    )
})
