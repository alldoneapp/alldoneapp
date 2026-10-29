'use strict'

const admin = require('firebase-admin')

// The one email address another system may be told belongs to an Alldone account: the
// Firebase Auth login email, and only once the identity provider verified it.
//
// users/{uid}.email is a copy the client writes, and the users update rule used to let the
// owner overwrite it freely (it only protects membership fields). alldone.team trusts the
// address it receives from us: embedded tools key their data on it (`app:<email>`) and
// charge Gold back to whoever owns it. Sending the document field therefore let one account
// present somebody else's address. Read the address from Auth; never from users/{uid}.

const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_CACHE_ENTRIES = 1000

const emailByUserId = new Map()

function normalizeEmail(email) {
    return typeof email === 'string' ? email.trim().toLowerCase() : ''
}

function readVerifiedEmail(userRecord) {
    if (!userRecord || userRecord.disabled || userRecord.emailVerified !== true) return ''
    return normalizeEmail(userRecord.email)
}

function remember(userId, email, now) {
    emailByUserId.set(userId, { email, expiresAt: now + CACHE_TTL_MS })
    if (emailByUserId.size > MAX_CACHE_ENTRIES) {
        emailByUserId.delete(emailByUserId.keys().next().value)
    }
}

// '' when the account has no verified login email (anonymous, unverified, disabled, gone)
// or when Auth could not be asked. A failed lookup is not cached, so the next call retries.
async function getVerifiedAccountEmail(userId, { auth = admin.auth(), now = Date.now() } = {}) {
    const normalizedUserId = typeof userId === 'string' ? userId.trim() : ''
    if (!normalizedUserId) return ''

    const cached = emailByUserId.get(normalizedUserId)
    if (cached && cached.expiresAt > now) return cached.email

    try {
        const email = readVerifiedEmail(await auth.getUser(normalizedUserId))
        remember(normalizedUserId, email, now)
        return email
    } catch (error) {
        if (error?.code === 'auth/user-not-found') {
            remember(normalizedUserId, '', now)
            return ''
        }
        console.warn('verifiedAccountEmail: Auth lookup failed', { userId: normalizedUserId, error: error.message })
        return ''
    }
}

// The account whose verified login email is this address, or null. Firebase Auth keeps one
// account per email, so unlike a users query on the email field there is no ambiguity and
// no document field anybody could have set. Errors other than "no such user" propagate,
// so a caller can tell an outage from an unknown address.
async function findUserIdByVerifiedEmail(email, { auth = admin.auth() } = {}) {
    const normalizedEmail = normalizeEmail(email)
    if (!normalizedEmail) return null

    try {
        const userRecord = await auth.getUserByEmail(normalizedEmail)
        return readVerifiedEmail(userRecord) === normalizedEmail ? userRecord.uid : null
    } catch (error) {
        if (error?.code === 'auth/user-not-found') return null
        throw error
    }
}

module.exports = {
    getVerifiedAccountEmail,
    findUserIdByVerifiedEmail,
    __private__: {
        clearCache: () => emailByUserId.clear(),
    },
}
