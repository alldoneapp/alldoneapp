'use strict'

const crypto = require('crypto')
const admin = require('firebase-admin')
const { getEnvFunctions } = require('../envFunctionsHelper')

const TOKEN_PREFIX = 'adapp_'
const TOKENS_COLLECTION = 'menubarAppTokens'
const MAX_ACTIVE_TOKENS_PER_USER = 10
const LAST_USED_UPDATE_THROTTLE_MS = 5 * 60 * 1000
const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60

const GOLD_SOURCE_DEDUCT = 'menubar_app_usage'
const GOLD_SOURCE_REFUND = 'menubar_app_refund'

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex')
}

function normalizeEmail(email) {
    return String(email || '')
        .trim()
        .toLowerCase()
}

function getUserDisplayName(userData = {}) {
    return userData.displayName || userData.name || ''
}

function getUserGold(userData = {}) {
    const gold = Number(userData.gold)
    return Number.isFinite(gold) ? Math.floor(gold) : 0
}

// In-memory, per-instance rate limiting. Good enough to blunt brute force /
// abuse without adding a Firestore read+write to every session check.
const rateBuckets = new Map()

function isRateLimited(key, limit, windowMs) {
    const now = Date.now()
    const windowStart = Math.floor(now / windowMs)
    const bucketKey = `${key}:${windowStart}`

    if (rateBuckets.size > 10000) {
        for (const existingKey of rateBuckets.keys()) {
            if (!existingKey.endsWith(`:${windowStart}`)) rateBuckets.delete(existingKey)
        }
    }

    const count = (rateBuckets.get(bucketKey) || 0) + 1
    rateBuckets.set(bucketKey, count)
    return count > limit
}

function getRequestIp(req) {
    const forwarded = req.headers['x-forwarded-for']
    if (typeof forwarded === 'string' && forwarded.trim()) {
        return forwarded.split(',')[0].trim()
    }
    return req.ip || req.connection?.remoteAddress || 'unknown'
}

async function mintMenubarAppToken(userId) {
    const userRef = admin.firestore().doc(`users/${userId}`)
    const userDoc = await userRef.get()
    if (!userDoc.exists) {
        throw new Error('User not found')
    }
    const userData = userDoc.data() || {}

    const token = `${TOKEN_PREFIX}${crypto.randomBytes(32).toString('hex')}`
    const tokenHash = hashToken(token)

    await admin
        .firestore()
        .collection(TOKENS_COLLECTION)
        .doc(tokenHash)
        .set({
            userId,
            email: normalizeEmail(userData.email),
            appId: 'anna-menubar',
            tokenSuffix: token.slice(-4),
            revoked: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            lastUsedAt: null,
        })

    // Keep the number of live tokens per user bounded. Each /app-auth visit
    // mints a new token (we only store hashes, so we cannot re-show an old
    // one); old tokens stay valid until revoked so other devices keep working.
    try {
        const activeTokens = await admin
            .firestore()
            .collection(TOKENS_COLLECTION)
            .where('userId', '==', userId)
            .where('revoked', '==', false)
            .get()
        if (activeTokens.size > MAX_ACTIVE_TOKENS_PER_USER) {
            const sorted = activeTokens.docs
                .filter(doc => doc.id !== tokenHash)
                .sort((a, b) => (a.data().createdAt?.toMillis?.() || 0) - (b.data().createdAt?.toMillis?.() || 0))
            const excess = sorted.slice(0, activeTokens.size - MAX_ACTIVE_TOKENS_PER_USER)
            await Promise.all(
                excess.map(doc =>
                    doc.ref.set(
                        { revoked: true, revokedAt: admin.firestore.FieldValue.serverTimestamp() },
                        { merge: true }
                    )
                )
            )
        }
    } catch (error) {
        console.warn('mintMenubarAppToken: pruning old tokens failed', error)
    }

    return {
        token,
        email: normalizeEmail(userData.email),
        name: getUserDisplayName(userData),
        gold: getUserGold(userData),
    }
}

async function listMenubarAppTokens(userId) {
    const snapshot = await admin
        .firestore()
        .collection(TOKENS_COLLECTION)
        .where('userId', '==', userId)
        .where('revoked', '==', false)
        .get()

    return snapshot.docs
        .map(doc => {
            const data = doc.data() || {}
            return {
                id: doc.id,
                appId: data.appId || 'anna-menubar',
                tokenSuffix: data.tokenSuffix || '',
                createdAt: data.createdAt?.toMillis?.() || null,
                lastUsedAt: data.lastUsedAt?.toMillis?.() || null,
            }
        })
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

async function revokeMenubarAppToken(userId, tokenId) {
    if (typeof tokenId !== 'string' || !tokenId.trim()) {
        return { success: false, error: 'Invalid token id' }
    }
    const tokenRef = admin.firestore().collection(TOKENS_COLLECTION).doc(tokenId.trim())
    const tokenDoc = await tokenRef.get()
    if (!tokenDoc.exists || tokenDoc.data()?.userId !== userId) {
        return { success: false, error: 'Token not found' }
    }
    await tokenRef.set({ revoked: true, revokedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
    return { success: true }
}

async function resolveTokenSession(token) {
    if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX) || token.length < 32 || token.length > 200) {
        return null
    }

    const tokenHash = hashToken(token)
    const tokenRef = admin.firestore().collection(TOKENS_COLLECTION).doc(tokenHash)
    const tokenDoc = await tokenRef.get()
    if (!tokenDoc.exists) return null

    const tokenData = tokenDoc.data() || {}
    if (tokenData.revoked) return null

    const userDoc = await admin.firestore().doc(`users/${tokenData.userId}`).get()
    if (!userDoc.exists) return null
    const userData = userDoc.data() || {}

    const lastUsedMs = tokenData.lastUsedAt?.toMillis?.() || 0
    if (Date.now() - lastUsedMs > LAST_USED_UPDATE_THROTTLE_MS) {
        tokenRef
            .set({ lastUsedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
            .catch(error => console.warn('menubarSession: lastUsedAt update failed', error))
    }

    return {
        email: normalizeEmail(userData.email),
        name: getUserDisplayName(userData),
        gold: getUserGold(userData),
    }
}

// POST /api/menubar/session  { token } ->
//   200 { valid: true, email, name, gold } | 200 { valid: false }
async function handleMenubarSession(req, res) {
    res.set('Cache-Control', 'no-store')

    if (req.method !== 'POST') {
        res.status(405).json({ valid: false, error: 'Method not allowed' })
        return
    }

    const token = req.body?.token
    const ip = getRequestIp(req)
    const tokenKey = typeof token === 'string' ? hashToken(token).slice(0, 16) : 'invalid'
    if (isRateLimited(`mbs:ip:${ip}`, 240, 60 * 1000) || isRateLimited(`mbs:token:${tokenKey}`, 120, 60 * 1000)) {
        res.status(429).json({ valid: false, error: 'Rate limit exceeded' })
        return
    }

    try {
        const session = await resolveTokenSession(token)
        if (!session) {
            res.status(200).json({ valid: false })
            return
        }
        res.status(200).json({ valid: true, ...session })
    } catch (error) {
        console.error('menubarSession: error', error)
        res.status(500).json({ valid: false, error: 'Internal error' })
    }
}

function verifyWebhookSignature(req, secret) {
    const timestampHeader = String(req.headers['x-alldone-timestamp'] || '').trim()
    const signatureHeader = String(req.headers['x-alldone-signature'] || '').trim()
    if (!timestampHeader || !signatureHeader) {
        return { valid: false, error: 'Missing signature headers' }
    }

    const timestampValue = Number(timestampHeader)
    if (!Number.isFinite(timestampValue)) {
        return { valid: false, error: 'Invalid timestamp' }
    }
    // Timestamps are unix seconds per the contract; tolerate milliseconds too.
    const timestampSeconds = timestampValue > 1e12 ? timestampValue / 1000 : timestampValue
    const ageSeconds = Math.abs(Date.now() / 1000 - timestampSeconds)
    if (ageSeconds > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) {
        return { valid: false, error: 'Timestamp outside tolerance' }
    }

    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {})
    const expected = crypto.createHmac('sha256', secret).update(`${timestampHeader}.${rawBody}`).digest('hex')

    try {
        const providedBuffer = Buffer.from(signatureHeader, 'hex')
        const expectedBuffer = Buffer.from(expected, 'hex')
        if (
            providedBuffer.length !== expectedBuffer.length ||
            !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
        ) {
            return { valid: false, error: 'Invalid signature' }
        }
    } catch (error) {
        return { valid: false, error: 'Invalid signature' }
    }

    return { valid: true }
}

async function findUserByEmail(email) {
    const normalizedEmail = normalizeEmail(email)
    if (!normalizedEmail) return null

    const snapshot = await admin.firestore().collection('users').where('email', '==', normalizedEmail).limit(2).get()

    if (snapshot.empty) return null
    if (snapshot.size > 1) {
        console.warn('menubarGoldWebhook: multiple users share email, using first match', { email: normalizedEmail })
    }
    return snapshot.docs[0]
}

// POST /api/menubar/gold  HMAC-signed (x-alldone-timestamp / x-alldone-signature)
//   { type: 'DEDUCT_GOLD' | 'REFUND_GOLD', userEmail, amount } ->
//   200 { success: true, newBalance } | { success: false, error }
async function handleMenubarGoldWebhook(req, res) {
    res.set('Cache-Control', 'no-store')

    if (req.method !== 'POST') {
        res.status(405).json({ success: false, error: 'Method not allowed' })
        return
    }

    if (isRateLimited(`mbg:ip:${getRequestIp(req)}`, 300, 60 * 1000)) {
        res.status(429).json({ success: false, error: 'Rate limit exceeded' })
        return
    }

    const { MENUBAR_APP_WEBHOOK_SECRET } = getEnvFunctions()
    if (!MENUBAR_APP_WEBHOOK_SECRET) {
        console.error('menubarGoldWebhook: MENUBAR_APP_WEBHOOK_SECRET is not configured')
        res.status(500).json({ success: false, error: 'Webhook secret not configured' })
        return
    }

    const signatureCheck = verifyWebhookSignature(req, MENUBAR_APP_WEBHOOK_SECRET)
    if (!signatureCheck.valid) {
        console.warn('menubarGoldWebhook: signature rejected', { reason: signatureCheck.error })
        res.status(401).json({ success: false, error: signatureCheck.error })
        return
    }

    const { type, userEmail } = req.body || {}
    const amount = Number(req.body?.amount)

    if (type !== 'DEDUCT_GOLD' && type !== 'REFUND_GOLD') {
        res.status(400).json({ success: false, error: 'Unknown type' })
        return
    }
    if (!Number.isInteger(amount) || amount <= 0) {
        res.status(400).json({ success: false, error: 'Invalid amount' })
        return
    }

    try {
        const userDoc = await findUserByEmail(userEmail)
        if (!userDoc) {
            res.status(200).json({ success: false, error: 'User not found' })
            return
        }

        const { deductGold, refundGold } = require('../Gold/goldHelper')
        const context = { channel: 'menubar_app' }
        const result =
            type === 'DEDUCT_GOLD'
                ? await deductGold(userDoc.id, amount, { ...context, source: GOLD_SOURCE_DEDUCT })
                : await refundGold(userDoc.id, amount, { ...context, source: GOLD_SOURCE_REFUND })

        if (result?.success) {
            res.status(200).json({ success: true, newBalance: result.newBalance })
        } else {
            res.status(200).json({
                success: false,
                error: result?.message || 'Gold update failed',
            })
        }
    } catch (error) {
        console.error('menubarGoldWebhook: error', error)
        res.status(500).json({ success: false, error: 'Internal error' })
    }
}

module.exports = {
    mintMenubarAppToken,
    listMenubarAppTokens,
    revokeMenubarAppToken,
    handleMenubarSession,
    handleMenubarGoldWebhook,
}
