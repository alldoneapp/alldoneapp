'use strict'

/**
 * Linking a Stripe subscription paid under another email address (AT-2978, security decision 6 of
 * the 2026-11 audit).
 *
 * A Stripe customer is found by its email address, so the address is the billing identity. Since the
 * audit, linkStripeAccount accepts the caller's verified login email only; anybody who paid under a
 * different address had to ask support. Now Alldone sends a six-digit code to that address, and
 * whoever enters it has shown that the mailbox is theirs.
 *
 * - The code is stored only as a hash, in `stripeLinkCodes/{uid}`, a collection no client rule
 *   reaches (default deny), so a client can neither read nor plant one.
 * - A code belongs to one user and one address, is valid for CODE_TTL_MS, and is spent after
 *   MAX_ATTEMPTS wrong entries or one right one.
 * - Requests are rate-limited per user (one per RESEND_INTERVAL_MS, MAX_CODES_PER_HOUR per hour), so
 *   the address cannot be flooded through us.
 * - The mail is only sent when Stripe actually has a customer with that address, and the answer is
 *   the same either way, so the endpoint does not tell whether somebody is a Stripe customer.
 */

const crypto = require('crypto')

const CODE_TTL_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 5
const RESEND_INTERVAL_MS = 60 * 1000
const MAX_CODES_PER_HOUR = 5
const HOUR_MS = 60 * 60 * 1000
const CODE_COLLECTION = 'stripeLinkCodes'

class StripeLinkCodeError extends Error {
    constructor(code, message, details) {
        super(message)
        this.code = code
        this.details = details
    }
}

const normalizeEmail = value => (typeof value === 'string' ? value.trim().toLowerCase() : '')
const looksLikeEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254
const normalizeCode = value =>
    typeof value === 'string' || typeof value === 'number' ? String(value).replace(/\s/g, '') : ''

function hashCode(userId, email, code) {
    return crypto.createHash('sha256').update(`${userId}\n${email}\n${code}`).digest('hex')
}

function generateCode(randomInt = crypto.randomInt) {
    return String(randomInt(0, 1000000)).padStart(6, '0')
}

const MAIL_TEXT = {
    en: {
        subject: 'Your Alldone confirmation code',
        intro: 'Use this code to link the Stripe subscription of this email address to your Alldone account:',
        expiry: 'The code is valid for 15 minutes. If you did not ask for it, you can ignore this email.',
    },
    de: {
        subject: 'Dein Alldone-Bestätigungscode',
        intro: 'Mit diesem Code verknüpfst du das Stripe-Abo dieser E-Mail-Adresse mit deinem Alldone-Konto:',
        expiry: 'Der Code ist 15 Minuten gültig. Wenn du ihn nicht angefordert hast, kannst du diese E-Mail ignorieren.',
    },
    es: {
        subject: 'Tu código de confirmación de Alldone',
        intro: 'Usa este código para vincular la suscripción de Stripe de esta dirección de correo a tu cuenta de Alldone:',
        expiry: 'El código es válido durante 15 minutos. Si no lo has solicitado, puedes ignorar este correo.',
    },
}

function resolveMailLanguage(language) {
    const value = String(language || '').toLowerCase()
    if (value.startsWith('de') || value.startsWith('german')) return 'de'
    if (value.startsWith('es') || value.startsWith('span')) return 'es'
    return 'en'
}

function buildCodeEmail(code, language) {
    const text = MAIL_TEXT[resolveMailLanguage(language)]
    // The only variable part is the six-digit code; no user-written text reaches the HTML.
    const html =
        '<div style="font-family: Arial, sans-serif; font-size: 15px; color: #04142F;">' +
        `<p>${text.intro}</p>` +
        `<p style="font-size: 28px; font-weight: bold; letter-spacing: 6px;">${code}</p>` +
        `<p>${text.expiry}</p>` +
        '</div>'
    return { subject: text.subject, html }
}

/**
 * Sends a code to `email` for `userId` when Stripe has a customer with that address.
 * Always answers `{ sent: true }` for an accepted request, whether or not a mail went out.
 */
async function requestStripeLinkCode({
    db,
    userId,
    email,
    language,
    hasStripeCustomer,
    sendEmail,
    now = Date.now(),
    randomInt,
}) {
    const normalizedEmail = normalizeEmail(email)
    if (!userId) throw new StripeLinkCodeError('unauthenticated', 'User must be authenticated')
    if (!looksLikeEmail(normalizedEmail))
        throw new StripeLinkCodeError('invalid-argument', 'Please enter a valid email address.')

    const ref = db.collection(CODE_COLLECTION).doc(userId)
    const existing = await ref.get()
    const previous = existing.exists ? existing.data() || {} : {}
    const recentRequests = (Array.isArray(previous.requestedAt) ? previous.requestedAt : []).filter(
        time => Number(time) > now - HOUR_MS
    )
    const lastRequest = recentRequests.length ? Math.max(...recentRequests) : 0
    if (lastRequest && now - lastRequest < RESEND_INTERVAL_MS) {
        throw new StripeLinkCodeError('resource-exhausted', 'Please wait a minute before asking for a new code.')
    }
    if (recentRequests.length >= MAX_CODES_PER_HOUR) {
        throw new StripeLinkCodeError('resource-exhausted', 'Too many codes requested. Please try again in an hour.')
    }

    const customerExists = await hasStripeCustomer(normalizedEmail)
    const code = generateCode(randomInt)
    await ref.set({
        email: normalizedEmail,
        codeHash: customerExists ? hashCode(userId, normalizedEmail, code) : '',
        expiresAt: now + CODE_TTL_MS,
        attempts: 0,
        requestedAt: [...recentRequests, now],
    })

    if (customerExists) {
        const { subject, html } = buildCodeEmail(code, language)
        await sendEmail({ to: normalizedEmail, subject, html })
    }

    return { sent: true, expiresAt: now + CODE_TTL_MS }
}

/**
 * Checks a code. Spends it on success, counts a wrong entry otherwise. Throws when it does not match.
 */
async function consumeStripeLinkCode({ db, userId, email, code, now = Date.now() }) {
    const normalizedEmail = normalizeEmail(email)
    const normalizedCode = normalizeCode(code)
    if (!/^\d{6}$/.test(normalizedCode))
        throw new StripeLinkCodeError('invalid-argument', 'Please enter the six-digit code.')

    const ref = db.collection(CODE_COLLECTION).doc(userId)
    let outcome = 'invalid'

    await db.runTransaction(async transaction => {
        const doc = await transaction.get(ref)
        const data = doc.exists ? doc.data() || {} : {}
        if (!data.codeHash || data.email !== normalizedEmail || !(Number(data.expiresAt) > now)) {
            outcome = 'expired'
            return
        }
        if ((Number(data.attempts) || 0) >= MAX_ATTEMPTS) {
            outcome = 'locked'
            return
        }
        const expected = Buffer.from(String(data.codeHash), 'hex')
        const actual = Buffer.from(hashCode(userId, normalizedEmail, normalizedCode), 'hex')
        if (expected.length === actual.length && crypto.timingSafeEqual(expected, actual)) {
            transaction.set(ref, { codeHash: '', attempts: 0, confirmedEmail: normalizedEmail }, { merge: true })
            outcome = 'ok'
            return
        }
        const attempts = (Number(data.attempts) || 0) + 1
        transaction.set(ref, { attempts, ...(attempts >= MAX_ATTEMPTS ? { codeHash: '' } : {}) }, { merge: true })
        outcome = attempts >= MAX_ATTEMPTS ? 'locked' : 'invalid'
    })

    if (outcome === 'ok') return { ok: true, email: normalizedEmail }
    if (outcome === 'expired') {
        throw new StripeLinkCodeError('failed-precondition', 'This code has expired. Please ask for a new one.', {
            reason: 'code_expired',
        })
    }
    if (outcome === 'locked') {
        throw new StripeLinkCodeError('failed-precondition', 'Too many wrong codes. Please ask for a new one.', {
            reason: 'code_locked',
        })
    }
    throw new StripeLinkCodeError('permission-denied', 'That code is not correct.', { reason: 'code_invalid' })
}

module.exports = {
    requestStripeLinkCode,
    consumeStripeLinkCode,
    buildCodeEmail,
    hashCode,
    generateCode,
    StripeLinkCodeError,
    CODE_TTL_MS,
    MAX_ATTEMPTS,
    RESEND_INTERVAL_MS,
    MAX_CODES_PER_HOUR,
    CODE_COLLECTION,
}
