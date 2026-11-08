import { createHash, webcrypto } from 'crypto'
import { TextEncoder } from 'util'

import { createOAuthBrowserBinding, GOOGLE_OAUTH_CALLBACK_PATH } from './oauthBrowserBinding'

// NV-23: the browser that starts an OAuth connect keeps a nonce in a cookie on the callback path
// and sends only its hash; the callback accepts the code only from a browser holding the nonce.
describe('createOAuthBrowserBinding', () => {
    let written
    let originalCrypto
    let originalTextEncoder

    beforeEach(() => {
        written = []
        jest.spyOn(document, 'cookie', 'set').mockImplementation(value => written.push(value))
        originalCrypto = globalThis.crypto
        originalTextEncoder = globalThis.TextEncoder
        Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
        globalThis.TextEncoder = TextEncoder
    })

    afterEach(() => {
        jest.restoreAllMocks()
        Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true })
        globalThis.TextEncoder = originalTextEncoder
    })

    test('keeps a fresh nonce in a path-scoped __session cookie and returns only its SHA-256', async () => {
        const hash = await createOAuthBrowserBinding(GOOGLE_OAUTH_CALLBACK_PATH)

        expect(written).toHaveLength(1)
        const match =
            /^__session=([A-Za-z0-9_-]{43}); Path=\/googleOAuthCallback; Max-Age=900; Secure; SameSite=Lax$/.exec(
                written[0]
            )
        expect(match).not.toBeNull()
        expect(hash).toBe(createHash('sha256').update(match[1]).digest('hex'))
        expect(hash).not.toContain(match[1])

        const second = await createOAuthBrowserBinding(GOOGLE_OAUTH_CALLBACK_PATH)
        expect(second).not.toBe(hash)
    })

    test('refuses to start without Web Crypto rather than sending an unbound flow', async () => {
        Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true })
        await expect(createOAuthBrowserBinding(GOOGLE_OAUTH_CALLBACK_PATH)).rejects.toThrow('secure connection')
        expect(written).toHaveLength(0)
    })
})
