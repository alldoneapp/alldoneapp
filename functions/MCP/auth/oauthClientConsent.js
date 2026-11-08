// security audit 2026-11 (mcp-oauth-dcr-authorize-without-client-consent): anyone can register an
// OAuth client for the MCP server (open dynamic client registration, plus auto-registration of an
// unknown client_id on /authorize), with a redirect to a host they control. Signing in on the
// Alldone-branded page used to be all it took to hand that client 30-day MCP tokens for the
// signed-in account, and the page named neither the client nor where the code would be sent.
//
// The login page now says which app is asking and which host receives the authorization, and the
// authorization is only completed when the person presses the button that approves exactly that
// (completeAuthorizationCallback requires `consentApproved`, stored as consentGrantedAt). Known
// redirect hosts are named by us, never by the client's self-declared name, so a registration that
// calls itself "Claude" but redirects elsewhere is shown with its real destination.

const CLIENT_NAME_MAX_LENGTH = 60

// Redirect hosts whose owner we know. The name comes from this table, not from the registration.
const KNOWN_REDIRECT_HOSTS = {
    'claude.ai': 'Claude',
    'claude.com': 'Claude',
    'chatgpt.com': 'ChatGPT',
    'chat.openai.com': 'ChatGPT',
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

const sanitizeClientName = value => {
    if (typeof value !== 'string') return ''
    // Printable text only: no control characters, no line breaks, short enough for one line.
    const cleaned = value
        .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    return cleaned.slice(0, CLIENT_NAME_MAX_LENGTH)
}

const escapeHtml = value =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')

/**
 * What the consent screen tells the person about the app asking for access. `redirectUri` must be
 * the one STORED on the authorization session, not one taken from the login page's query.
 */
function describeOAuthClientForConsent(clientData, redirectUri) {
    let url = null
    try {
        url = redirectUri ? new URL(redirectUri) : null
    } catch (_) {
        url = null
    }
    const hostname = url ? url.hostname.toLowerCase() : ''
    const redirectHost = url ? url.host.toLowerCase() : ''
    const declaredName = sanitizeClientName(clientData?.clientName)

    if (url && url.protocol === 'https:' && KNOWN_REDIRECT_HOSTS[hostname]) {
        return { clientLabel: KNOWN_REDIRECT_HOSTS[hostname], redirectHost, kind: 'known' }
    }
    if (url && LOOPBACK_HOSTNAMES.has(hostname)) {
        // Claude Code, Codex and other local MCP clients finish the flow on this computer.
        return { clientLabel: declaredName || 'An app on this computer', redirectHost, kind: 'local' }
    }
    return {
        clientLabel: declaredName || 'An unknown app',
        redirectHost: redirectHost || 'an unknown address',
        kind: 'unverified',
    }
}

module.exports = {
    CLIENT_NAME_MAX_LENGTH,
    KNOWN_REDIRECT_HOSTS,
    describeOAuthClientForConsent,
    escapeHtml,
    sanitizeClientName,
}
