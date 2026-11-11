#!/usr/bin/env node
/**
 * Tells open clients that a new web version is live (`increaseVersionSecondGen` bumps
 * `info/version`, which shows the "new version" notice and reloads the app).
 *
 * The function only accepts an administrator's Firebase ID token or a Google-signed identity
 * token of one of its own project's service accounts (security audit 2026-11, AT-2971). The
 * CI job used to call it with a bare `curl` GET, which got 405 and still passed, because curl
 * exits 0 on an HTTP error, so no client was told about a deploy after 2026-11-08.
 *
 * This mints an identity token for the deploy service account that
 * `ci/useFirebaseDeployCredentials.sh` exposes as GOOGLE_APPLICATION_CREDENTIALS (audience: the
 * function URL), POSTs with it, and fails the job on anything but a 2xx.
 *
 * Usage: node ci/bumpAppVersion.js <function url>
 * Node built-ins only: the job image has no repository dependencies installed.
 */
const crypto = require('crypto')
const fs = require('fs')

const TOKEN_URL = 'https://oauth2.googleapis.com/token'

const base64url = value =>
    Buffer.from(value).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

const signAssertion = (key, audience, now = Math.floor(Date.now() / 1000)) => {
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: key.private_key_id }))
    const claims = base64url(
        JSON.stringify({
            iss: key.client_email,
            sub: key.client_email,
            aud: TOKEN_URL,
            target_audience: audience,
            iat: now,
            exp: now + 600,
        })
    )
    const signature = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(key.private_key)
    return `${header}.${claims}.${base64url(signature)}`
}

const functionAudience = url => {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
}

const fetchIdentityToken = async (key, audience, fetchImpl = fetch) => {
    const response = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: signAssertion(key, audience),
        }).toString(),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || !body.id_token) {
        throw new Error(
            `could not get an identity token (${response.status}): ${body.error_description || body.error || 'no id_token'}`
        )
    }
    return body.id_token
}

const bumpAppVersion = async ({ url, keyFile, fetchImpl = fetch }) => {
    if (!url) throw new Error('usage: node ci/bumpAppVersion.js <function url>')
    if (!keyFile)
        throw new Error('GOOGLE_APPLICATION_CREDENTIALS is not set; source ci/useFirebaseDeployCredentials.sh first')
    const key = JSON.parse(fs.readFileSync(keyFile, 'utf8'))
    const token = await fetchIdentityToken(key, functionAudience(url), fetchImpl)
    const response = await fetchImpl(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    const text = await response.text()
    if (!response.ok) throw new Error(`the version function answered ${response.status}: ${text}`)
    return text
}

module.exports = { bumpAppVersion, functionAudience, signAssertion }

if (require.main === module) {
    bumpAppVersion({ url: process.argv[2], keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS })
        .then(text => console.log(`bumpAppVersion: ${text}`))
        .catch(error => {
            console.error(`bumpAppVersion: ERROR: ${error.message}`)
            process.exit(1)
        })
}
