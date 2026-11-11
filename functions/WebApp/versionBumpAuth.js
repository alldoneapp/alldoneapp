/**
 * Who may bump `info/version` (which makes every open client show the new-version notice and
 * reload): an administrator with a Firebase ID token, or the CI deploy through a Google-signed
 * identity token of a service account of this project (`ci/bumpAppVersion.js`).
 *
 * The second path exists because the security audit (2026-11-08, AT-2971) made the function
 * administrator-only while CI still called it with a bare GET, so every deploy since then
 * reloaded nobody. A service account of the project is infrastructure that can already deploy
 * the app itself, so letting it announce a deploy grants nothing new.
 */
const { OAuth2Client } = require('google-auth-library')

const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com'])

const decodePayload = token => {
    const parts = String(token || '').split('.')
    if (parts.length !== 3) return null
    try {
        return JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    } catch (error) {
        return null
    }
}

const isGoogleIdentityToken = token => GOOGLE_ISSUERS.has(decodePayload(token)?.iss)

// The token must name this function as its audience: its cloudfunctions.net URL or its own
// Cloud Run URL. Anything else is a token minted for another service.
const isVersionFunctionAudience = audience => {
    try {
        const { protocol, hostname, pathname } = new URL(audience)
        if (protocol !== 'https:') return false
        if (hostname.endsWith('.cloudfunctions.net')) return /^\/increaseVersionSecondGen\/?$/.test(pathname)
        if (hostname.endsWith('.run.app'))
            return hostname.startsWith('increaseversionsecondgen-') && /^\/?$/.test(pathname)
        return false
    } catch (error) {
        return false
    }
}

const getProjectId = () => {
    if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT
    if (process.env.GOOGLE_CLOUD_PROJECT) return process.env.GOOGLE_CLOUD_PROJECT
    try {
        return JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId || ''
    } catch (error) {
        return ''
    }
}

/**
 * Resolves with the service account's email when `token` is a valid Google identity token of a
 * service account of `projectId` addressed to this function; rejects otherwise.
 */
const verifyDeployIdentityToken = async (token, { projectId = getProjectId(), client = new OAuth2Client() } = {}) => {
    if (!projectId) throw new Error('unknown project')
    const audience = decodePayload(token)?.aud
    if (!isVersionFunctionAudience(audience)) throw new Error('wrong audience')
    const ticket = await client.verifyIdToken({ idToken: token, audience })
    const payload = ticket.getPayload() || {}
    if (!GOOGLE_ISSUERS.has(payload.iss)) throw new Error('wrong issuer')
    if (payload.email_verified !== true) throw new Error('unverified email')
    if (!String(payload.email || '').endsWith(`@${projectId}.iam.gserviceaccount.com`)) {
        throw new Error('not a service account of this project')
    }
    return payload.email
}

module.exports = { isGoogleIdentityToken, isVersionFunctionAudience, verifyDeployIdentityToken }
