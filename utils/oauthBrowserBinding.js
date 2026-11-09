// Binds an OAuth connect flow to this browser (security audit NV-23).
//
// The browser that starts a Google, Microsoft or MCP-server connect keeps a random nonce in a
// first-party cookie scoped to the callback path, and sends only its SHA-256 to the server. The
// callback (served on this origin through a hosting rewrite) completes the flow only when the
// request carries that cookie, so a consent URL forwarded to somebody else cannot connect their
// account to this user. The server side is functions/Utils/oauthBrowserBinding.js.
//
// The cookie must be called `__session`: Firebase Hosting strips every other cookie before it
// forwards a request to a function.

export const GOOGLE_OAUTH_CALLBACK_PATH = '/googleOAuthCallback'
export const MICROSOFT_OAUTH_CALLBACK_PATH = '/microsoftOAuthCallback'
export const MCP_CLIENT_OAUTH_CALLBACK_PATH = '/mcpClientOAuthCallback'

const BINDING_COOKIE = '__session'
const BINDING_MAX_AGE_SECONDS = 15 * 60

function toBase64Url(bytes) {
    let binary = ''
    bytes.forEach(byte => {
        binary += String.fromCharCode(byte)
    })
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function toHex(buffer) {
    return Array.from(new Uint8Array(buffer))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('')
}

/** Sets the binding cookie for `callbackPath` and resolves with the hash to send to the server. */
export async function createOAuthBrowserBinding(callbackPath) {
    const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : null
    if (!cryptoApi?.getRandomValues || !cryptoApi?.subtle || typeof document === 'undefined') {
        throw new Error('This browser cannot start a secure connection.')
    }
    const bytes = new Uint8Array(32)
    cryptoApi.getRandomValues(bytes)
    const nonce = toBase64Url(bytes)
    document.cookie = `${BINDING_COOKIE}=${nonce}; Path=${callbackPath}; Max-Age=${BINDING_MAX_AGE_SECONDS}; Secure; SameSite=Lax`
    const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(nonce))
    return toHex(digest)
}
