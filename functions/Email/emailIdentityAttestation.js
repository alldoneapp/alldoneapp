'use strict'

const admin = require('firebase-admin')
const crypto = require('crypto')

// A connected mailbox is a CLAIM, and until AT-2483 nothing checked it (AT-2483).
//
// The Anna email channel decides who an inbound message belongs to from two kinds of
// evidence. A "verified primary email" is server-verified: Firebase Auth says the account
// logs in with that address. A "connected mailbox" was, by contrast, nothing but two
// pieces of Firestore data the account owner can write themselves — the OAuth token
// document under `users/{uid}/private/**` and the `apisConnected` / `emailConnections`
// entry on the user document (see the owner-writable rules for both). Only Cloud Functions
// ever write those in practice, but "in practice" is not a security boundary: anyone
// signed in could have fabricated a connection to somebody else's address.
//
// This module turns the claim into a proof. The provider — Google or Microsoft — is the
// only party that can say which mailbox a refresh token actually belongs to, so we ask it
// and record the answer in `verifiedEmailIdentities`, a collection no client can write
// (there is no rule for it, and the ruleset denies by default; Cloud Functions reach it
// through the Admin SDK). The attestation is written at two moments:
//
//   1. at OAuth connect time, where the handlers already learn the address from the
//      provider's own userinfo/Graph response, and
//   2. lazily, the first time an inbound email needs to weigh a connection that has no
//      attestation yet — which is what makes every connection that predates AT-2483 work
//      without a migration.
//
// Attestation alone is deliberately NOT sufficient to route mail: the account must ALSO
// currently list the address as a connected mailbox. Attestation answers "was ownership
// ever proven", the user document answers "is it still connected", and disconnecting must
// stop routing immediately even if the attestation has not been cleaned up yet.

const ATTESTATION_COLLECTION = 'verifiedEmailIdentities'
const ACCOUNTS_SUBCOLLECTION = 'accounts'

// A probe sits directly in front of an inbound webhook that already runs for ~10s, so it
// is bounded rather than left to the provider's own timeouts.
const OWNERSHIP_PROBE_TIMEOUT_MS = 8000

// A transient failure must not be re-probed on every inbound message of a busy mailbox.
// The negative cache is per Cloud Run instance on purpose: it costs no Firestore write,
// and losing it on a cold start only means one extra probe.
const NEGATIVE_CACHE_TTL_MS = 10 * 60 * 1000
const negativeProbeCache = new Map()

const PROOF_VERIFIED = 'verified'
const PROOF_REJECTED = 'rejected'
const PROOF_UNVERIFIABLE = 'unverifiable'

const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
const GMAIL_PROFILE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/profile'

function normalizeEmail(value = '') {
    return String(value || '')
        .trim()
        .toLowerCase()
}

// Hashed rather than raw: an email address is a legal document id, but the id of a
// server-only collection is the one place an address would sit unencrypted in a path that
// shows up in logs, exports and index entries.
function buildEmailIdentityKey(email = '') {
    const normalized = normalizeEmail(email)
    if (!normalized) return ''
    return crypto.createHash('sha256').update(normalized).digest('hex')
}

function attestationCollectionRef(email) {
    const key = buildEmailIdentityKey(email)
    if (!key) return null
    return admin.firestore().collection(ATTESTATION_COLLECTION).doc(key).collection(ACCOUNTS_SUBCOLLECTION)
}

// The OAuth token documents are named after the connection they belong to. Both shapes
// still exist in production: the account-level `googleAuth_email_google_ab12cd34` and the
// legacy per-project `googleAuth_{projectId}_gmail` / `googleAuth_{projectId}`.
const CREDENTIAL_DOC_PREFIXES = [
    { prefix: 'googleAuth_', provider: 'google', mailService: 'gmail' },
    { prefix: 'microsoftAuth_', provider: 'microsoft', mailService: 'email' },
]

function isConnectionId(value) {
    return typeof value === 'string' && /^(email|calendar)_(google|microsoft)_[0-9a-f]{8}$/.test(value)
}

// Returns null for any document that is not a provider credential document. Routing uses
// this as an allowlist: a hand-written `users/{uid}/private/whatever` carrying an `email`
// field is not a connection, whatever it claims about itself.
function parseCredentialDocId(docId = '') {
    const normalized = String(docId || '').trim()
    const match = CREDENTIAL_DOC_PREFIXES.find(entry => normalized.startsWith(entry.prefix))
    if (!match) return null

    const remainder = normalized.slice(match.prefix.length)
    if (!remainder) return null

    if (isConnectionId(remainder)) {
        // A calendar connection is not a mailbox, whatever the token document says.
        if (remainder.startsWith('calendar_')) return null
        return { provider: match.provider, reference: remainder, service: match.mailService }
    }

    const serviceSuffixMatch = remainder.match(/^(.*)_(gmail|email|calendar)$/)
    if (serviceSuffixMatch) {
        const [, reference, service] = serviceSuffixMatch
        if (service === 'calendar' || !reference) return null
        return { provider: match.provider, reference, service: match.mailService }
    }

    // Oldest shape: `googleAuth_{projectId}` with the service implied.
    return { provider: match.provider, reference: remainder, service: match.mailService }
}

async function getAttestedUserIdsForEmail(email) {
    const collectionRef = attestationCollectionRef(email)
    if (!collectionRef) return new Set()

    try {
        const snapshot = await collectionRef.get()
        const userIds = new Set()
        snapshot.docs.forEach(doc => {
            const data = doc.data() || {}
            if (data.revoked === true) return
            userIds.add(doc.id)
        })
        return userIds
    } catch (error) {
        console.warn('Email Channel: Could not read email identity attestations', {
            error: error.message,
        })
        return new Set()
    }
}

async function recordEmailIdentityAttestation({ userId, email, provider = '', connectionId = '', source = '' } = {}) {
    const normalizedUserId = String(userId || '').trim()
    const collectionRef = attestationCollectionRef(email)
    if (!normalizedUserId || !collectionRef) return false

    try {
        await collectionRef.doc(normalizedUserId).set(
            {
                userId: normalizedUserId,
                email: normalizeEmail(email),
                provider: String(provider || ''),
                connectionId: String(connectionId || ''),
                source: String(source || ''),
                attestedAt: Date.now(),
                revoked: false,
            },
            { merge: true }
        )
        return true
    } catch (error) {
        console.warn('Email Channel: Could not record email identity attestation', {
            userId: normalizedUserId,
            error: error.message,
        })
        return false
    }
}

async function removeEmailIdentityAttestation({ userId, email } = {}) {
    const normalizedUserId = String(userId || '').trim()
    const collectionRef = attestationCollectionRef(email)
    if (!normalizedUserId || !collectionRef) return false

    try {
        await collectionRef.doc(normalizedUserId).delete()
        return true
    } catch (error) {
        console.warn('Email Channel: Could not remove email identity attestation', {
            userId: normalizedUserId,
            error: error.message,
        })
        return false
    }
}

function withTimeout(promise, timeoutMs, label) {
    let timer = null
    const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    })
    return Promise.race([promise, timeout]).finally(() => {
        if (timer) clearTimeout(timer)
    })
}

// Credentials that the provider itself has rejected are not "we could not check" — they
// are proof that this token cannot speak for this mailbox. A fabricated token document
// lands here, which is exactly the case this whole module exists to stop.
function isDefinitiveCredentialFailure(error) {
    const message = String(error?.message || '').toLowerCase()
    const name = String(error?.name || '')
    if (name === 'GoogleAuthRevokedError') return true
    return (
        message.includes('invalid_grant') ||
        message.includes('invalid_client') ||
        message.includes('unauthorized_client') ||
        message.includes('no refresh token') ||
        message.includes('no valid credentials') ||
        message.includes('token has been expired or revoked')
    )
}

async function probeGoogleMailboxAddress(userId, reference) {
    const { getAuthorizedOAuth2Client } = require('../GoogleOAuth/googleOAuthHandler')
    const client = await getAuthorizedOAuth2Client(userId, reference, 'gmail')

    // `userinfo.email` is requested for every Google connection this app makes, but a
    // token minted before that was true — or one whose consent the user trimmed — still
    // holds a Gmail scope, and the Gmail profile names the same mailbox. Falling back
    // matters: an unanswered probe costs a legitimate connection its precedence.
    try {
        const response = await client.request({ url: GOOGLE_USERINFO_URL })
        const email = normalizeEmail(response?.data?.email)
        if (email) return email
    } catch (error) {
        if (isDefinitiveCredentialFailure(error)) throw error
    }

    const profile = await client.request({ url: GMAIL_PROFILE_URL })
    return normalizeEmail(profile?.data?.emailAddress)
}

async function probeMicrosoftMailboxAddress(userId, reference) {
    const { getAccessToken, graphRequest } = require('../MicrosoftOAuth/microsoftOAuthHandler')
    const accessToken = await getAccessToken(userId, reference, 'email')
    const userInfo = await graphRequest(accessToken, '/me?$select=id,mail,userPrincipalName')
    return normalizeEmail(userInfo?.mail || userInfo?.userPrincipalName)
}

// Asks the provider which mailbox the stored credentials actually belong to.
//
// `verified`     the provider named this exact address.
// `rejected`     the provider named a different address, or refused the credentials
//                outright. Either way this account cannot speak for this mailbox.
// `unverifiable` we could not ask (network, timeout, unexpected shape). Deliberately
//                distinct from `rejected`: an outage at Google must not silently revoke
//                every user's email routing.
async function probeMailboxOwnership({ userId, email, provider, reference } = {}) {
    const normalizedEmail = normalizeEmail(email)
    if (!userId || !normalizedEmail || !reference) return { status: PROOF_UNVERIFIABLE, observedEmail: '' }

    try {
        const observedEmail = await withTimeout(
            provider === 'microsoft'
                ? probeMicrosoftMailboxAddress(userId, reference)
                : probeGoogleMailboxAddress(userId, reference),
            OWNERSHIP_PROBE_TIMEOUT_MS,
            'Mailbox ownership probe'
        )

        if (!observedEmail) return { status: PROOF_UNVERIFIABLE, observedEmail: '' }
        if (observedEmail === normalizedEmail) return { status: PROOF_VERIFIED, observedEmail }
        return { status: PROOF_REJECTED, observedEmail }
    } catch (error) {
        if (isDefinitiveCredentialFailure(error)) {
            return { status: PROOF_REJECTED, observedEmail: '' }
        }
        return { status: PROOF_UNVERIFIABLE, observedEmail: '' }
    }
}

function negativeCacheKey(userId, email) {
    return `${userId}::${normalizeEmail(email)}`
}

function readNegativeCache(userId, email) {
    const key = negativeCacheKey(userId, email)
    const entry = negativeProbeCache.get(key)
    if (!entry) return null
    if (entry.expiresAt <= Date.now()) {
        negativeProbeCache.delete(key)
        return null
    }
    return entry.status
}

function writeNegativeCache(userId, email, status) {
    negativeProbeCache.set(negativeCacheKey(userId, email), {
        status,
        expiresAt: Date.now() + NEGATIVE_CACHE_TTL_MS,
    })
}

function clearOwnershipProbeCache() {
    negativeProbeCache.clear()
}

// Returns the proof status for one account's claim on one address, recording a new
// attestation when the provider confirms it. `attestedUserIds` is the already-loaded set
// for this address so a single inbound message pays one read no matter how many accounts
// claim the address.
async function ensureEmailIdentityAttestation({
    userId,
    email,
    provider,
    credentialDocId,
    attestedUserIds = null,
} = {}) {
    const normalizedUserId = String(userId || '').trim()
    const normalizedEmail = normalizeEmail(email)
    if (!normalizedUserId || !normalizedEmail) return PROOF_UNVERIFIABLE

    const attested = attestedUserIds || (await getAttestedUserIdsForEmail(normalizedEmail))
    if (attested.has(normalizedUserId)) return PROOF_VERIFIED

    const cached = readNegativeCache(normalizedUserId, normalizedEmail)
    if (cached) return cached

    const parsed = parseCredentialDocId(credentialDocId)
    if (!parsed) {
        writeNegativeCache(normalizedUserId, normalizedEmail, PROOF_REJECTED)
        return PROOF_REJECTED
    }

    const { status, observedEmail } = await probeMailboxOwnership({
        userId: normalizedUserId,
        email: normalizedEmail,
        provider: provider || parsed.provider,
        reference: parsed.reference,
    })

    if (status === PROOF_VERIFIED) {
        await recordEmailIdentityAttestation({
            userId: normalizedUserId,
            email: normalizedEmail,
            provider: provider || parsed.provider,
            connectionId: isConnectionId(parsed.reference) ? parsed.reference : '',
            source: 'inbound_probe',
        })
        return PROOF_VERIFIED
    }

    if (status === PROOF_REJECTED) {
        console.warn('Email Channel: Rejected an unprovable connected mailbox claim', {
            userId: normalizedUserId,
            credentialDocId: String(credentialDocId || ''),
            observedEmailDiffers: !!observedEmail,
        })
    }

    writeNegativeCache(normalizedUserId, normalizedEmail, status)
    return status
}

module.exports = {
    ATTESTATION_COLLECTION,
    PROOF_REJECTED,
    PROOF_UNVERIFIABLE,
    PROOF_VERIFIED,
    buildEmailIdentityKey,
    clearOwnershipProbeCache,
    ensureEmailIdentityAttestation,
    getAttestedUserIdsForEmail,
    isDefinitiveCredentialFailure,
    parseCredentialDocId,
    probeMailboxOwnership,
    recordEmailIdentityAttestation,
    removeEmailIdentityAttestation,
}
