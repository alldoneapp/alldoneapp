'use strict'

const crypto = require('crypto')
const admin = require('firebase-admin')
const { getEnvFunctions } = require('../envFunctionsHelper')
const { getMenubarAccountSummary } = require('./menubarAccountSummary')
const { resolveMenubarRichTextLinks } = require('./menubarRichText')

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

async function resolveTokenUser(token) {
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

    return { userId: tokenData.userId, userData }
}

async function resolveTokenSession(token, includeSummary = false) {
    const tokenUser = await resolveTokenUser(token)
    if (!tokenUser) return null
    const { userId, userData } = tokenUser

    const session = {
        email: normalizeEmail(userData.email),
        name: getUserDisplayName(userData),
        gold: getUserGold(userData),
    }

    if (includeSummary) {
        try {
            session.summary = await getMenubarAccountSummary(
                admin.firestore(),
                userId,
                userData,
                Date.now(),
                getAppBaseUrl()
            )
        } catch (error) {
            // The summary is display-only. Keep session validation and gold
            // available if one of its project queries is temporarily unavailable.
            console.warn('menubarSession: account summary failed', { userId, error: error.message })
        }
    }

    return session
}

// POST /api/menubar/session  { token, includeSummary? } ->
//   200 { valid: true, email, name, gold, summary? } | 200 { valid: false }
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
        const session = await resolveTokenSession(token, req.body?.includeSummary === true)
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

// Short, non-reversible fingerprint of a secret so we can tell two secrets
// apart in logs (e.g. "is MENUBAR_APP_WEBHOOK_SECRET == EXTERNAL_TOOLS_SIGNING_SECRET?")
// without ever logging the secret itself.
function secretFingerprint(secret) {
    return crypto.createHash('sha256').update(String(secret)).digest('hex').slice(0, 8)
}

function signaturesMatch(providedHex, expectedHex) {
    try {
        const providedBuffer = Buffer.from(providedHex, 'hex')
        const expectedBuffer = Buffer.from(expectedHex, 'hex')
        return providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer)
    } catch (error) {
        return false
    }
}

// Verify against EVERY configured candidate secret (raw + trimmed, deduped).
// The alldone.team side signs with one shared secret, but on our side that
// value may have landed in either MENUBAR_APP_WEBHOOK_SECRET or
// EXTERNAL_TOOLS_SIGNING_SECRET, and a stray trailing newline from the CI
// env blob would also break a byte-exact compare — so we accept any match
// instead of guessing precedence.
function verifyWebhookSignature(req, candidateSecrets) {
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

    // Sign over the RAW request bytes — never a re-serialized req.body, whose
    // key order / whitespace would not match the sender's digest.
    const hasRawBody = !!req.rawBody
    const rawBody = hasRawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {})
    const signingInput = `${timestampHeader}.${rawBody}`

    // Build candidate list: raw + trimmed variant of each, deduped, non-empty.
    const candidates = []
    const seen = new Set()
    candidateSecrets.forEach(secret => {
        ;[secret, typeof secret === 'string' ? secret.trim() : secret].forEach(variant => {
            if (variant && !seen.has(variant)) {
                seen.add(variant)
                candidates.push(variant)
            }
        })
    })

    for (const secret of candidates) {
        const expected = crypto.createHmac('sha256', secret).update(signingInput).digest('hex')
        if (signaturesMatch(signatureHeader, expected)) {
            return { valid: true }
        }
    }

    // No candidate matched — log enough to diagnose body-vs-secret without
    // leaking the secret. The body itself is the caller's own payload.
    console.warn('menubarGoldWebhook: signature mismatch diagnostics', {
        hasRawBody,
        rawBodyLength: rawBody.length,
        rawBodyPreview: rawBody.slice(0, 120),
        providedSigPrefix: signatureHeader.slice(0, 10),
        timestampAgeSeconds: Math.round(ageSeconds),
        candidates: candidates.map(secret => ({
            fingerprint: secretFingerprint(secret),
            expectedSigPrefix: crypto.createHmac('sha256', secret).update(signingInput).digest('hex').slice(0, 10),
        })),
    })

    return { valid: false, error: 'Invalid signature' }
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

    const { MENUBAR_APP_WEBHOOK_SECRET, EXTERNAL_TOOLS_SIGNING_SECRET } = getEnvFunctions()
    // The alldone.team side signs with one shared secret; on our side that value
    // may live under either key, so verify against both candidates.
    const candidateSecrets = [MENUBAR_APP_WEBHOOK_SECRET, EXTERNAL_TOOLS_SIGNING_SECRET].filter(Boolean)
    if (candidateSecrets.length === 0) {
        console.error('menubarGoldWebhook: no webhook secret configured')
        res.status(500).json({ success: false, error: 'Webhook secret not configured' })
        return
    }

    const signatureCheck = verifyWebhookSignature(req, candidateSecrets)
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

const NOTE_PUSHES_COLLECTION = 'menubarNotePushes'
const MAX_NOTE_TITLE_LENGTH = 300
const MAX_NOTE_CONTENT_LENGTH = 300000
const MAX_NOTE_ATTACHMENT_COUNT = 12
const MAX_NOTE_ATTACHMENT_BYTES = 5000000
const MAX_NOTE_ATTACHMENTS_TOTAL_BYTES = 20000000
const ALLOWED_NOTE_ATTACHMENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const NOTE_PUSH_PENDING_TIMEOUT_MS = 2 * 60 * 1000

function decodeNoteAttachments(rawAttachments, content) {
    if (rawAttachments === undefined || rawAttachments === null) return []
    if (!Array.isArray(rawAttachments)) throw new Error('attachments must be an array')
    if (rawAttachments.length > MAX_NOTE_ATTACHMENT_COUNT) {
        throw new Error(`attachments exceeds ${MAX_NOTE_ATTACHMENT_COUNT} files`)
    }

    const referencedImages = new Set()
    const imageRegex = /!\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))\)/g
    let imageMatch
    while ((imageMatch = imageRegex.exec(content))) {
        referencedImages.add(imageMatch[1] || imageMatch[2])
    }

    const references = new Set()
    let totalBytes = 0
    return rawAttachments.map(rawAttachment => {
        const attachment = rawAttachment && typeof rawAttachment === 'object' ? rawAttachment : {}
        const reference = typeof attachment.reference === 'string' ? attachment.reference.trim() : ''
        const fileName = typeof attachment.fileName === 'string' ? attachment.fileName.trim() : ''
        const mimeType = typeof attachment.mimeType === 'string' ? attachment.mimeType.toLowerCase().trim() : ''
        const dataBase64 = typeof attachment.dataBase64 === 'string' ? attachment.dataBase64.trim() : ''

        if (!reference || reference.length > 300 || reference.includes('/') || reference.includes('\\')) {
            throw new Error('attachment reference is invalid')
        }
        if (!referencedImages.has(reference)) throw new Error(`attachment is not referenced by content: ${reference}`)
        if (references.has(reference)) throw new Error(`duplicate attachment reference: ${reference}`)
        if (!fileName || fileName.length > 200 || fileName.includes('/') || fileName.includes('\\')) {
            throw new Error('attachment fileName is invalid')
        }
        if (!ALLOWED_NOTE_ATTACHMENT_TYPES.has(mimeType)) throw new Error('attachment mimeType is not supported')
        if (!dataBase64 || dataBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(dataBase64)) {
            throw new Error('attachment dataBase64 is invalid')
        }

        const data = Buffer.from(dataBase64, 'base64')
        if (!data.length || data.length > MAX_NOTE_ATTACHMENT_BYTES) {
            throw new Error(`attachment exceeds ${MAX_NOTE_ATTACHMENT_BYTES} bytes`)
        }
        if (data.toString('base64').replace(/=+$/, '') !== dataBase64.replace(/=+$/, '')) {
            throw new Error('attachment dataBase64 is invalid')
        }
        totalBytes += data.length
        if (totalBytes > MAX_NOTE_ATTACHMENTS_TOTAL_BYTES) {
            throw new Error(`attachments exceed ${MAX_NOTE_ATTACHMENTS_TOTAL_BYTES} total bytes`)
        }

        references.add(reference)
        return { reference, fileName, mimeType, data }
    })
}

function rewriteMarkdownAttachmentUrls(content, uploadedAttachments) {
    const urlsByReference = new Map(uploadedAttachments.map(attachment => [attachment.reference, attachment.url]))
    return content.replace(/!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))\)/g, (match, alt, angleTarget, target) => {
        const url = urlsByReference.get(angleTarget || target)
        return url ? `![${alt}](<${url}>)` : match
    })
}

async function uploadNoteAttachments(attachments) {
    if (!attachments.length) return []

    const moment = require('moment')
    const bucket = admin.storage().bucket()
    const uploaded = []
    try {
        for (const attachment of attachments) {
            const randomHash = crypto.randomUUID().replace(/-/g, '')
            const filePath = `notesAttachments/${moment().format('DDMMYYYY')}/${randomHash}/${attachment.fileName}`
            const downloadToken = crypto.randomUUID()
            const file = bucket.file(filePath)
            await file.save(attachment.data, {
                metadata: {
                    contentType: attachment.mimeType,
                    cacheControl: 'public,max-age=31536000',
                    metadata: { firebaseStorageDownloadTokens: downloadToken },
                },
            })
            uploaded.push({
                reference: attachment.reference,
                file,
                url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
                    filePath
                )}?alt=media&token=${downloadToken}`,
            })
        }
        return uploaded
    } catch (error) {
        await cleanupUploadedNoteAttachments(uploaded)
        throw error
    }
}

async function cleanupUploadedNoteAttachments(uploadedAttachments) {
    await Promise.all(
        uploadedAttachments.map(attachment =>
            attachment.file.delete().catch(error =>
                console.warn('menubarPushNote: attachment cleanup failed', {
                    reference: attachment.reference,
                    error: error.message,
                })
            )
        )
    )
}

function getAppBaseUrl() {
    try {
        const { defineString } = require('firebase-functions/params')
        const hostingUrl = defineString('HOSTING_URL').value()
        if (hostingUrl) return hostingUrl.replace(/\/+$/, '')
    } catch (error) {
        console.warn('menubarApp: HOSTING_URL not available, using production fallback', error.message)
    }
    return 'https://my.alldone.app'
}

let cachedNoteService = null
async function getNoteService() {
    if (!cachedNoteService) {
        const moment = require('moment')
        const { NoteService } = require('../shared/NoteService')
        const db = admin.firestore()
        let projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT
        if (!projectId) {
            try {
                projectId = JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId
            } catch (_) {}
        }
        const storageBucket =
            projectId === 'alldonealeph'
                ? 'notescontentprod'
                : projectId === 'alldonestaging'
                ? 'notescontentstaging'
                : null
        cachedNoteService = new NoteService({
            database: db,
            moment,
            idGenerator: () => db.collection('_').doc().id,
            enableFeeds: true,
            enableValidation: true,
            isCloudFunction: true,
            storageBucket,
            authoritativeStorageBucket: !!storageBucket,
        })
        await cachedNoteService.initialize()
    }
    return cachedNoteService
}

// POST /api/menubar/projects  { token } ->
//   200 { success: true, defaultProjectId, projects: [{ id, name, description, isDefault }] }
async function handleMenubarProjects(req, res) {
    res.set('Cache-Control', 'no-store')

    if (req.method !== 'POST') {
        res.status(405).json({ success: false, error: 'Method not allowed' })
        return
    }

    const token = req.body?.token
    const ip = getRequestIp(req)
    const tokenKey = typeof token === 'string' ? hashToken(token).slice(0, 16) : 'invalid'
    if (isRateLimited(`mbp:ip:${ip}`, 120, 60 * 1000) || isRateLimited(`mbp:token:${tokenKey}`, 60, 60 * 1000)) {
        res.status(429).json({ success: false, error: 'Rate limit exceeded' })
        return
    }

    try {
        const tokenUser = await resolveTokenUser(token)
        if (!tokenUser) {
            res.status(401).json({ success: false, error: 'Invalid token' })
            return
        }

        const { ProjectService } = require('../shared/ProjectService')
        const projectService = new ProjectService({ database: admin.firestore() })
        await projectService.initialize()
        const projects = await projectService.getUserProjects(tokenUser.userId, {
            includeArchived: false,
            includeCommunity: false,
        })

        const defaultProjectId =
            typeof tokenUser.userData.defaultProjectId === 'string' ? tokenUser.userData.defaultProjectId : ''

        res.status(200).json({
            success: true,
            defaultProjectId: defaultProjectId || null,
            projects: projects.map(project => ({
                id: project.id,
                name: project.name || '',
                description: project.description || '',
                isDefault: project.id === defaultProjectId,
            })),
        })
    } catch (error) {
        console.error('menubarProjects: error', error)
        res.status(500).json({ success: false, error: 'Internal error' })
    }
}

function buildNotePushDocId(userId, externalId, projectId) {
    return hashToken(`${userId}__${externalId}__${projectId}`)
}

function buildLegacyNotePushDocId(userId, externalId) {
    return hashToken(`${userId}__${externalId}`)
}

function completedPushResponse(pushData) {
    return {
        success: true,
        deduplicated: true,
        noteId: pushData.noteId,
        projectId: pushData.projectId || null,
        projectName: pushData.projectName || null,
        url: pushData.projectId
            ? `${getAppBaseUrl()}/projects/${pushData.projectId}/notes/${pushData.noteId}/editor`
            : null,
        resolution: pushData.resolution || null,
    }
}

function isActivePush(pushData) {
    const pendingAge = Date.now() - (pushData.createdAt || 0)
    return pushData.status === 'pending' && pendingAge < NOTE_PUSH_PENDING_TIMEOUT_MS
}

async function getMenubarAssistantActor(db, userData) {
    // Always act as (and assign) the default assistant from the user's default project — matching
    // the in-app default — instead of the assistant configured on the project the note lands in.
    const defaultProjectId = typeof userData?.defaultProjectId === 'string' ? userData.defaultProjectId.trim() : ''
    const userDefaultAssistantId =
        typeof userData?.defaultAssistantId === 'string' ? userData.defaultAssistantId.trim() : ''

    const fetchAssistant = async candidateId => {
        if (!candidateId) return null
        const refs = []
        if (defaultProjectId) refs.push(db.doc(`assistants/${defaultProjectId}/items/${candidateId}`))
        refs.push(db.doc(`assistants/globalProject/items/${candidateId}`))
        const docs = await db.getAll(...refs)
        const found = docs.find(doc => doc && doc.exists)
        return found ? { assistantId: found.id || candidateId, assistant: found.data() || {} } : null
    }

    let resolved = null

    // 1) The default project's configured assistant.
    if (defaultProjectId) {
        const defaultProjectDoc = await db.doc(`projects/${defaultProjectId}`).get()
        const defaultProject = defaultProjectDoc.exists ? defaultProjectDoc.data() || {} : {}
        const projectAssistantId =
            typeof defaultProject.assistantId === 'string' ? defaultProject.assistantId.trim() : ''
        resolved = await fetchAssistant(projectAssistantId)
    }

    // 2) The user's stored default assistant.
    if (!resolved) {
        resolved = await fetchAssistant(userDefaultAssistantId)
    }

    // 3) The global default assistant.
    if (!resolved) {
        const defaultAssistantSnapshot = await db
            .collection('assistants/globalProject/items')
            .where('isDefault', '==', true)
            .limit(1)
            .get()
        const defaultAssistantDoc = defaultAssistantSnapshot.docs[0]
        if (defaultAssistantDoc) {
            resolved = { assistantId: defaultAssistantDoc.id, assistant: defaultAssistantDoc.data() || {} }
        }
    }

    if (!resolved || !resolved.assistantId) {
        return {
            assistantId: null,
            assistantData: null,
            feedUser: {
                uid: 'anna-menubar',
                id: 'anna-menubar',
                creatorId: 'anna-menubar',
                name: 'Anna Alldone',
                displayName: 'Anna Alldone',
                photoURL: '',
                noteCreatedEntryText: 'has created the note',
            },
        }
    }

    const { assistantId, assistant } = resolved
    const displayName = assistant.displayName || assistant.name || 'Anna Alldone'
    return {
        assistantId,
        assistantData: assistant,
        feedUser: {
            uid: assistantId,
            id: assistantId,
            creatorId: assistantId,
            name: displayName,
            displayName,
            email: assistant.email || '',
            photoURL: assistant.photoURL50 || assistant.photoURL300 || assistant.photoURL || '',
            noteCreatedEntryText: 'has created the note',
        },
    }
}

function normalizeNoteMove(rawMove) {
    if (rawMove === undefined || rawMove === null) return null
    if (!rawMove || typeof rawMove !== 'object') throw new Error('move must be an object')

    const noteId = typeof rawMove.noteId === 'string' ? rawMove.noteId.trim() : ''
    const sourceProjectId = typeof rawMove.sourceProjectId === 'string' ? rawMove.sourceProjectId.trim() : ''
    if (!noteId || noteId.length > 200) throw new Error('move noteId is invalid')
    if (!sourceProjectId || sourceProjectId.length > 200) throw new Error('move sourceProjectId is invalid')
    return { noteId, sourceProjectId }
}

function resolveMenubarNotePrivacy(userId, rawIsPrivate) {
    const isPrivate = rawIsPrivate === true
    return {
        isPrivate,
        // Match alldone.app's native note privacy model: private notes are
        // visible only to their owner; project-wide notes carry the public
        // marker while retaining the owner in their access list.
        isPublicFor: isPrivate ? [userId] : [0, userId],
    }
}

// POST /api/menubar/notes  ->
//   { token, title, content, attachments?, projectId?, projectName?, move?, isPrivate?,
//     meeting?: { externalId?, recurringKey?, title?, attendeeEmails? } }
//   200 { success: true, noteId, projectId, projectName, url, resolution, deduplicated }
async function handleMenubarPushNote(req, res) {
    res.set('Cache-Control', 'no-store')

    if (req.method !== 'POST') {
        res.status(405).json({ success: false, error: 'Method not allowed' })
        return
    }

    const token = req.body?.token
    const ip = getRequestIp(req)
    const tokenKey = typeof token === 'string' ? hashToken(token).slice(0, 16) : 'invalid'
    if (isRateLimited(`mbn:ip:${ip}`, 120, 60 * 1000) || isRateLimited(`mbn:token:${tokenKey}`, 30, 60 * 1000)) {
        res.status(429).json({ success: false, error: 'Rate limit exceeded' })
        return
    }

    try {
        const tokenUser = await resolveTokenUser(token)
        if (!tokenUser) {
            res.status(401).json({ success: false, error: 'Invalid token' })
            return
        }
        const { userId, userData } = tokenUser

        const title = typeof req.body?.title === 'string' ? req.body.title.trim() : ''
        const content = typeof req.body?.content === 'string' ? req.body.content : ''
        if (!title) {
            res.status(400).json({ success: false, error: 'title is required' })
            return
        }
        if (title.length > MAX_NOTE_TITLE_LENGTH) {
            res.status(400).json({ success: false, error: `title exceeds ${MAX_NOTE_TITLE_LENGTH} characters` })
            return
        }
        if (!content.trim()) {
            res.status(400).json({ success: false, error: 'content is required' })
            return
        }
        if (content.length > MAX_NOTE_CONTENT_LENGTH) {
            res.status(400).json({ success: false, error: `content exceeds ${MAX_NOTE_CONTENT_LENGTH} characters` })
            return
        }
        let attachments
        try {
            attachments = decodeNoteAttachments(req.body?.attachments, content)
        } catch (attachmentError) {
            res.status(400).json({ success: false, error: attachmentError.message })
            return
        }
        let noteMove
        try {
            noteMove = normalizeNoteMove(req.body?.move)
        } catch (moveError) {
            res.status(400).json({ success: false, error: moveError.message })
            return
        }

        const meeting = req.body?.meeting && typeof req.body.meeting === 'object' ? req.body.meeting : {}
        const externalId = typeof meeting.externalId === 'string' ? meeting.externalId.trim() : ''

        const db = admin.firestore()

        // Resolve the target project
        const { resolveMenubarNoteProject, saveMeetingMapping } = require('./menubarNoteProjectResolver')
        let resolution
        try {
            resolution = await resolveMenubarNoteProject(db, {
                userId,
                userData,
                requestedProjectId: req.body?.projectId,
                requestedProjectName: req.body?.projectName,
                meetingTitle: typeof meeting.title === 'string' ? meeting.title : title,
                meetingRecurringKey: meeting.recurringKey,
                attendeeEmails: meeting.attendeeEmails,
            })
        } catch (resolveError) {
            const statusCode = resolveError.code === 'PROJECT_NOT_ACCESSIBLE' ? 403 : 400
            res.status(statusCode).json({ success: false, error: resolveError.message })
            return
        }

        if (noteMove) {
            if (noteMove.sourceProjectId === resolution.projectId) {
                res.status(400).json({ success: false, error: 'Note is already in the selected project' })
                return
            }

            let sourceResolution
            try {
                sourceResolution = await resolveMenubarNoteProject(db, {
                    userId,
                    userData,
                    requestedProjectId: noteMove.sourceProjectId,
                    meetingTitle: typeof meeting.title === 'string' ? meeting.title : title,
                })
            } catch (sourceAccessError) {
                const statusCode = sourceAccessError.code === 'PROJECT_NOT_ACCESSIBLE' ? 403 : 400
                res.status(statusCode).json({ success: false, error: sourceAccessError.message })
                return
            }

            const targetPushRef = externalId
                ? db
                      .collection(NOTE_PUSHES_COLLECTION)
                      .doc(buildNotePushDocId(userId, externalId, resolution.projectId))
                : null
            if (targetPushRef) {
                const targetPush = await targetPushRef.get()
                if (targetPush.exists) {
                    const pushData = targetPush.data() || {}
                    if (pushData.status === 'completed' && pushData.noteId) {
                        if (pushData.noteId === noteMove.noteId) {
                            res.status(200).json(completedPushResponse(pushData))
                            return
                        }
                        res.status(409).json({
                            success: false,
                            error: 'This meeting already has a note in the selected project',
                        })
                        return
                    }
                    if (isActivePush(pushData)) {
                        res.status(409).json({
                            success: false,
                            error: 'A move for this meeting is already in progress',
                        })
                        return
                    }
                }
                await targetPushRef.set({
                    userId,
                    externalId,
                    projectId: resolution.projectId,
                    noteId: noteMove.noteId,
                    status: 'pending',
                    createdAt: Date.now(),
                })
            }

            try {
                const noteService = await getNoteService()
                const notesBucketName = await noteService.getBucketName()
                const assistantActor = await getMenubarAssistantActor(db, userData)
                const sourceProjectDoc = await db.doc(`projects/${noteMove.sourceProjectId}`).get()
                const sourceProject = sourceProjectDoc.exists ? sourceProjectDoc.data() || {} : {}
                const { moveNoteToDifferentProject } = require('../shared/moveNoteToDifferentProject')
                await moveNoteToDifferentProject({
                    database: db,
                    sourceProjectId: noteMove.sourceProjectId,
                    targetProjectId: resolution.projectId,
                    noteId: noteMove.noteId,
                    editorId: assistantActor.feedUser.uid,
                    editorName: assistantActor.feedUser.displayName,
                    notesBucketName,
                    feedUser: assistantActor.feedUser,
                    sourceProjectName: sourceResolution.projectName || '',
                    sourceProjectColor: sourceProject.color || '',
                })
            } catch (moveError) {
                console.error('menubarPushNote: note move failed', moveError)
                if (targetPushRef) {
                    await targetPushRef.set({ status: 'failed', updatedAt: Date.now() }, { merge: true })
                }
                res.status(500).json({ success: false, error: 'Failed to move note' })
                return
            }

            const responseResolution = { source: resolution.source, reasoning: resolution.reasoning }
            if (targetPushRef) {
                const batch = db.batch()
                batch.set(
                    targetPushRef,
                    {
                        status: 'completed',
                        noteId: noteMove.noteId,
                        projectId: resolution.projectId,
                        projectName: resolution.projectName || null,
                        resolution: responseResolution,
                        updatedAt: Date.now(),
                    },
                    { merge: true }
                )
                batch.delete(
                    db
                        .collection(NOTE_PUSHES_COLLECTION)
                        .doc(buildNotePushDocId(userId, externalId, noteMove.sourceProjectId))
                )
                batch.set(
                    db.collection(NOTE_PUSHES_COLLECTION).doc(buildLegacyNotePushDocId(userId, externalId)),
                    {
                        userId,
                        externalId,
                        status: 'completed',
                        noteId: noteMove.noteId,
                        projectId: resolution.projectId,
                        projectName: resolution.projectName || null,
                        resolution: responseResolution,
                        updatedAt: Date.now(),
                    },
                    { merge: true }
                )
                await batch.commit()
            }

            try {
                await saveMeetingMapping(db, {
                    userId,
                    meetingKey: resolution.meetingKey,
                    projectId: resolution.projectId,
                    meetingTitle: typeof meeting.title === 'string' ? meeting.title : title,
                    source: resolution.source,
                })
            } catch (mappingError) {
                console.warn('menubarPushNote: saving moved meeting mapping failed', mappingError)
            }

            res.status(200).json({
                success: true,
                deduplicated: false,
                moved: true,
                noteId: noteMove.noteId,
                projectId: resolution.projectId,
                projectName: resolution.projectName || null,
                url: `${getAppBaseUrl()}/projects/${resolution.projectId}/notes/${noteMove.noteId}/editor`,
                resolution: responseResolution,
            })
            return
        }

        // Repeated saves return the single existing note. Project changes use
        // the explicit move path above and keep that note's identity.
        let pushRef = null
        if (externalId) {
            pushRef = db
                .collection(NOTE_PUSHES_COLLECTION)
                .doc(buildNotePushDocId(userId, externalId, resolution.projectId))
            const existingPush = await pushRef.get()
            if (existingPush.exists) {
                const pushData = existingPush.data() || {}
                if (pushData.status === 'completed' && pushData.noteId) {
                    res.status(200).json(completedPushResponse(pushData))
                    return
                }
                if (isActivePush(pushData)) {
                    res.status(409).json({ success: false, error: 'A push for this meeting is already in progress' })
                    return
                }
            } else {
                // Before project-scoped idempotency, records were keyed only by
                // meeting. Honor them only when they point at this destination.
                const legacyRef = db
                    .collection(NOTE_PUSHES_COLLECTION)
                    .doc(buildLegacyNotePushDocId(userId, externalId))
                const legacyPush = await legacyRef.get()
                if (legacyPush.exists) {
                    const pushData = legacyPush.data() || {}
                    if (pushData.status === 'completed' && pushData.noteId) {
                        res.status(200).json(completedPushResponse(pushData))
                        return
                    }
                    const sameProject = !pushData.projectId || pushData.projectId === resolution.projectId
                    if (sameProject && isActivePush(pushData)) {
                        res.status(409).json({
                            success: false,
                            error: 'A push for this meeting is already in progress',
                        })
                        return
                    }
                }
            }
            await pushRef.set({
                userId,
                externalId,
                projectId: resolution.projectId,
                status: 'pending',
                createdAt: Date.now(),
            })
        }

        const failPush = () => {
            if (pushRef) {
                pushRef
                    .set({ status: 'failed', updatedAt: Date.now() }, { merge: true })
                    .catch(error => console.warn('menubarPushNote: marking push failed errored', error))
            }
        }

        // Set by the Mac app when its "follow-up prompt after sync" option is on:
        // the note needs an assistant-enabled chat to receive that prompt.
        const enableAssistantChat = req.body?.enableAssistantChat === true
        const privacy = resolveMenubarNotePrivacy(userId, req.body?.isPrivate)

        const assistantActor = await getMenubarAssistantActor(db, userData)
        const feedUser = assistantActor.feedUser

        let noteResult
        let uploadedAttachments = []
        try {
            const noteService = await getNoteService()
            const noteId = db.collection('_').doc().id
            uploadedAttachments = await uploadNoteAttachments(attachments)
            const noteContent = rewriteMarkdownAttachmentUrls(content, uploadedAttachments)
            noteResult = await noteService.createAndPersistNote(
                {
                    noteId,
                    title,
                    content: noteContent,
                    userId,
                    projectId: resolution.projectId,
                    assistantId: assistantActor.assistantId,
                    isPrivate: privacy.isPrivate,
                    isPublicFor: privacy.isPublicFor,
                    feedUser,
                },
                { userId, projectId: resolution.projectId }
            )
        } catch (noteError) {
            console.error('menubarPushNote: note creation failed', noteError)
            await cleanupUploadedNoteAttachments(uploadedAttachments)
            failPush()
            res.status(500).json({ success: false, error: 'Failed to create note' })
            return
        }

        if (enableAssistantChat) {
            // Best-effort: a missing chat only costs the follow-up prompt, and
            // the note itself is already safely persisted.
            try {
                await enableNoteAssistantChat(db, {
                    projectId: resolution.projectId,
                    noteId: noteResult.noteId,
                    title,
                    userId,
                    assistantId: assistantActor.assistantId,
                    isPublicFor: privacy.isPublicFor,
                })
            } catch (chatError) {
                console.warn('menubarPushNote: enabling the note assistant chat failed', chatError)
            }
        }

        const responseResolution = { source: resolution.source, reasoning: resolution.reasoning }

        // Finalize idempotency before non-critical preference learning. If the
        // response is lost after this point, retrying returns this exact note.
        if (pushRef) {
            const completedPush = {
                userId,
                externalId,
                status: 'completed',
                noteId: noteResult.noteId,
                projectId: resolution.projectId,
                projectName: resolution.projectName || null,
                resolution: responseResolution,
                updatedAt: Date.now(),
            }
            const batch = db.batch()
            batch.set(pushRef, completedPush, { merge: true })
            batch.set(
                db.collection(NOTE_PUSHES_COLLECTION).doc(buildLegacyNotePushDocId(userId, externalId)),
                completedPush,
                { merge: true }
            )
            await batch.commit()
        }

        // Remember the meeting → project choice so future instances land in
        // the selected project. The note is already safely persisted, so a
        // mapping failure must not turn a successful save into a retry.
        try {
            await saveMeetingMapping(db, {
                userId,
                meetingKey: resolution.meetingKey,
                projectId: resolution.projectId,
                meetingTitle: typeof meeting.title === 'string' ? meeting.title : title,
                source: resolution.source,
            })
        } catch (mappingError) {
            console.warn('menubarPushNote: saving meeting mapping failed', mappingError)
        }

        res.status(200).json({
            success: true,
            deduplicated: false,
            noteId: noteResult.noteId,
            projectId: resolution.projectId,
            projectName: resolution.projectName || null,
            url: `${getAppBaseUrl()}/projects/${resolution.projectId}/notes/${noteResult.noteId}/editor`,
            resolution: responseResolution,
        })
    } catch (error) {
        console.error('menubarPushNote: error', error)
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: 'Internal error' })
        }
    }
}

// ASSISTANT MESSAGES (Capture & Ask / Ask Anna from the menubar app)

const ASSISTANT_MESSAGES_COLLECTION = 'menubarAssistantMessages'
const ASSISTANT_RUNS_COLLECTION = 'menubarAssistantRuns'
const MAX_ASSISTANT_COMMENT_LENGTH = 4000
const MAX_ASSISTANT_IMAGE_BYTES = 5000000
const MAX_ASSISTANT_ATTACHMENT_BYTES = 10000000
const ALLOWED_ASSISTANT_IMAGE_TYPES = new Set(['image/jpeg', 'image/png'])
const ASSISTANT_MESSAGE_PENDING_TIMEOUT_MS = 2 * 60 * 1000
const DEFAULT_ASSISTANT_THREAD_PAGE_SIZE = 30
const MAX_ASSISTANT_THREAD_PAGE_SIZE = 50
const MENUBAR_CONVERSATION_OBJECT_TYPES = new Set([
    'topics',
    'tasks',
    'notes',
    'goals',
    'skills',
    'users',
    'contacts',
    'assistants',
])

function buildAssistantMessageDocId(userId, requestId) {
    return hashToken(`${userId}__${requestId}`)
}

// Validates the optional screenshot payload. Returns null when absent.
// Throws with `code: 'IMAGE_TOO_LARGE'` when over the byte cap (→ 413).
function decodeAssistantMessageImage(rawImage) {
    if (rawImage === undefined || rawImage === null) return null
    if (!rawImage || typeof rawImage !== 'object') throw new Error('image must be an object')

    const mimeType = typeof rawImage.mimeType === 'string' ? rawImage.mimeType.toLowerCase().trim() : ''
    const dataBase64 = typeof rawImage.dataBase64 === 'string' ? rawImage.dataBase64.trim() : ''

    if (!ALLOWED_ASSISTANT_IMAGE_TYPES.has(mimeType)) throw new Error('image mimeType is not supported')
    if (!dataBase64 || dataBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(dataBase64)) {
        throw new Error('image dataBase64 is invalid')
    }

    const data = Buffer.from(dataBase64, 'base64')
    if (!data.length) throw new Error('image dataBase64 is invalid')
    if (data.length > MAX_ASSISTANT_IMAGE_BYTES) {
        const error = new Error(`image exceeds ${MAX_ASSISTANT_IMAGE_BYTES} bytes`)
        error.code = 'IMAGE_TOO_LARGE'
        throw error
    }
    if (data.toString('base64').replace(/=+$/, '') !== dataBase64.replace(/=+$/, '')) {
        throw new Error('image dataBase64 is invalid')
    }

    const extension = mimeType === 'image/png' ? 'png' : 'jpg'
    return { mimeType, data, fileName: `screenshot-${Date.now()}.${extension}` }
}

// Validates a file/image selected in the native conversation panel. The JSON
// endpoint has a lower cap than the web app's direct-to-Storage upload because
// base64 expands the request body by roughly one third.
function decodeAssistantMessageAttachment(rawAttachment) {
    if (rawAttachment === undefined || rawAttachment === null) return null
    if (!rawAttachment || typeof rawAttachment !== 'object') throw new Error('attachment must be an object')

    const rawFileName = typeof rawAttachment.fileName === 'string' ? rawAttachment.fileName.trim() : ''
    const fileName = rawFileName.replace(/[\\/\u0000-\u001f\u007f]/g, '_').slice(0, 180)
    const mimeType = typeof rawAttachment.mimeType === 'string' ? rawAttachment.mimeType.toLowerCase().trim() : ''
    const dataBase64 = typeof rawAttachment.dataBase64 === 'string' ? rawAttachment.dataBase64.trim() : ''

    if (!fileName) throw new Error('attachment fileName is required')
    if (
        !mimeType ||
        mimeType.length > 150 ||
        !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(mimeType)
    ) {
        throw new Error('attachment mimeType is invalid')
    }
    if (!dataBase64 || dataBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(dataBase64)) {
        throw new Error('attachment dataBase64 is invalid')
    }

    const data = Buffer.from(dataBase64, 'base64')
    if (!data.length) throw new Error('attachment dataBase64 is invalid')
    if (data.length > MAX_ASSISTANT_ATTACHMENT_BYTES) {
        const error = new Error(`attachment exceeds ${MAX_ASSISTANT_ATTACHMENT_BYTES} bytes`)
        error.code = 'ATTACHMENT_TOO_LARGE'
        throw error
    }
    if (data.toString('base64').replace(/=+$/, '') !== dataBase64.replace(/=+$/, '')) {
        throw new Error('attachment dataBase64 is invalid')
    }

    return { mimeType, data, fileName }
}

// Uploads chat media to the same Storage path the web app's chat input uses.
async function uploadAssistantChatAttachment(attachment) {
    const moment = require('moment')
    const bucket = admin.storage().bucket()
    const randomHash = crypto.randomUUID().replace(/-/g, '')
    const filePath = `feedAttachments/${moment().format('DDMMYYYY')}/${randomHash}/${attachment.fileName}`
    const downloadToken = crypto.randomUUID()
    const file = bucket.file(filePath)
    await file.save(attachment.data, {
        metadata: {
            contentType: attachment.mimeType,
            cacheControl: 'public,max-age=31536000',
            metadata: { firebaseStorageDownloadTokens: downloadToken },
        },
    })
    return {
        file,
        url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
            filePath
        )}?alt=media&token=${downloadToken}`,
    }
}

// Get or create the daily "Mac App" topic for a user — the same daily-topic
// model as the WhatsApp daily chat (`BotChat…`, see whatsAppDailyTopic.js), so
// menubar asks collect in one dated thread per local day instead of one
// endless assistant DM.
async function getOrCreateMacAppDailyTopic(db, userId, projectId, assistantId, userData) {
    const { FEED_PUBLIC_FOR_ALL, getFirstName } = require('../Utils/HelperFunctionsCloud')
    const { getUserLocalDateContext } = require('../Assistant/contextTimestampHelper')
    const { dateKey, dateLabel } = getUserLocalDateContext(userData)
    const chatId = `MacApp${dateKey}${userId}`
    const chatRef = db.doc(`chatObjects/${projectId}/chats/${chatId}`)

    const chatDoc = await chatRef.get()
    if (chatDoc.exists) {
        // Ensure existing topics have the fields the app's queries rely on.
        const data = chatDoc.data() || {}
        const patchData = {}
        if (!data.stickyData || data.stickyData.days === undefined) {
            patchData.stickyData = { days: 0, stickyEndDate: 0 }
            patchData.hasStar = data.hasStar || '#ffffff'
        }
        if (data.isAssistantEnabled !== true) {
            patchData.isAssistantEnabled = true
        }
        if (Object.keys(patchData).length > 0) {
            await chatRef.update(patchData)
        }
        return { chatId, isNew: false }
    }

    const firstName = getFirstName(userData?.displayName || 'User')
    const now = Date.now()
    await chatRef.set({
        id: chatId,
        title: `Mac App <> ${firstName} ${dateLabel}`,
        type: 'topics',
        isPublicFor: [FEED_PUBLIC_FOR_ALL],
        assistantId: assistantId || null,
        creatorId: userId,
        created: now,
        lastEditionDate: now,
        lastEditorId: userId,
        usersFollowing: [userId],
        members: [userId],
        hasStar: '#ffffff',
        stickyData: { days: 0, stickyEndDate: 0 },
        commentsData: {
            amount: 0,
            lastComment: '',
            lastCommentOwnerId: '',
            lastCommentType: '',
        },
        isAssistantEnabled: true,
    })

    // Follower documents so the topic is navigable in the UI (mirrors the
    // heartbeat topic creation).
    await Promise.all([
        db.doc(`usersFollowing/${projectId}/entries/${userId}`).set({ topics: { [chatId]: true } }, { merge: true }),
        db
            .doc(`followers/${projectId}/topics/${chatId}`)
            .set({ usersFollowing: admin.firestore.FieldValue.arrayUnion(userId) }, { merge: true }),
    ])

    return { chatId, isNew: true }
}

// A note has no chat object of its own — note chat state normally lives on the
// note document, and chatObjects entries are only written once something
// comments (see TaskCommentService for the task equivalent). The Mac app's
// follow-up prompt needs a real chat to post into, because
// resolveMenubarConversationTarget refuses a target whose chat is missing, and
// the assistant only answers when isAssistantEnabled is set. Create both here,
// mirroring the shape TaskCommentService writes for tasks.
async function enableNoteAssistantChat(db, { projectId, noteId, title, userId, assistantId, isPublicFor }) {
    // Declared locally rather than pulled from HelperFunctionsCloud, the same way
    // menubarAccountSummary and menubarLastComment do — this path needs one
    // constant, not that module's Cloud Functions dependencies.
    const FEED_PUBLIC_FOR_ALL = 0
    const now = Date.now()
    const chatVisibility = Array.isArray(isPublicFor) && isPublicFor.length ? isPublicFor : [FEED_PUBLIC_FOR_ALL]

    await db.doc(`chatObjects/${projectId}/chats/${noteId}`).set(
        {
            id: noteId,
            projectId,
            title: title || 'Note',
            type: 'notes',
            creatorId: userId,
            created: now,
            lastEditionDate: now,
            lastEditorId: userId,
            isPublicFor: chatVisibility,
            hasStar: '#ffffff',
            stickyData: { days: 0, stickyEndDate: 0 },
            usersFollowing: [userId],
            followerIds: [userId],
            members: [userId],
            assistantId: assistantId || null,
            isAssistantEnabled: true,
            commentsData: { amount: 0, lastComment: '', lastCommentOwnerId: '', lastCommentType: '' },
        },
        { merge: true }
    )

    await Promise.all([
        // The note document is what the web UI reads for its assistant toggle.
        db.doc(`noteItems/${projectId}/notes/${noteId}`).set({ isAssistantEnabled: true }, { merge: true }),
        db.doc(`usersFollowing/${projectId}/entries/${userId}`).set({ notes: { [noteId]: true } }, { merge: true }),
        db
            .doc(`followers/${projectId}/notes/${noteId}`)
            .set({ usersFollowing: admin.firestore.FieldValue.arrayUnion(userId) }, { merge: true }),
    ])
}

function toMillis(value) {
    if (value === null || value === undefined) return 0
    if (typeof value?.toMillis === 'function') return value.toMillis()
    if (value instanceof Date) return value.getTime()
    if (Number.isFinite(value?.seconds)) {
        return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1000000)
    }
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
}

function sanitizeAssistantMediaUrl(value) {
    if (typeof value !== 'string' || !value) return ''
    try {
        const url = new URL(value)
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : ''
    } catch (error) {
        return ''
    }
}

function normalizeAssistantThreadMessage(
    id,
    data = {},
    assistantId,
    assistantName,
    userId,
    userName,
    resolvedAuthorName = ''
) {
    const {
        cleanTextMetaData,
        extractMediaContextFromText,
        removeFormatTagsFromText,
    } = require('../Utils/parseTextUtils')
    const rawText = typeof data.commentText === 'string' ? data.commentText : ''
    const text = cleanTextMetaData(removeFormatTagsFromText(rawText), false).trim()
    const attachments = Array.isArray(data.mediaContext) ? data.mediaContext : extractMediaContextFromText(rawText)
    const assistantRunStatus = typeof data.assistantRun?.status === 'string' ? data.assistantRun.status : ''
    const pending =
        data.isLoading === true ||
        data.isThinking === true ||
        data.isPartial === true ||
        assistantRunStatus === 'running' ||
        assistantRunStatus === 'cancel_requested'
    const fromAssistant = data.fromAssistant === true || data.creatorId === assistantId

    return {
        id,
        role: fromAssistant ? 'assistant' : 'user',
        authorName: resolvedAuthorName || (fromAssistant ? assistantName || 'Anna' : userName || 'You'),
        text,
        richText: rawText,
        createdAt: toMillis(data.created || data.lastChangeDate),
        updatedAt: toMillis(data.lastChangeDate || data.created),
        pending,
        attachments: attachments
            .filter(item => item && typeof item === 'object')
            .map(item => {
                const url = sanitizeAssistantMediaUrl(item.storageUrl) || sanitizeAssistantMediaUrl(item.previewUrl)
                return {
                    kind: typeof item.kind === 'string' ? item.kind : 'file',
                    fileName: typeof item.fileName === 'string' ? item.fileName : 'Attachment',
                    mimeType: typeof item.mimeType === 'string' ? item.mimeType : 'application/octet-stream',
                    url,
                    previewUrl: sanitizeAssistantMediaUrl(item.previewUrl) || null,
                }
            })
            .filter(item => item.url),
    }
}

function isOwnedMacAppTopic(chatId, chat = {}, userId) {
    return (
        typeof chatId === 'string' && chatId.startsWith('MacApp') && chat.type === 'topics' && chat.creatorId === userId
    )
}

function normalizeMenubarConversationTarget(rawTarget) {
    if (rawTarget === undefined || rawTarget === null) return null
    if (!rawTarget || typeof rawTarget !== 'object' || Array.isArray(rawTarget)) {
        throw new Error('target is invalid')
    }
    const projectId = typeof rawTarget.projectId === 'string' ? rawTarget.projectId.trim() : ''
    const objectId = typeof rawTarget.objectId === 'string' ? rawTarget.objectId.trim() : ''
    const objectType = typeof rawTarget.objectType === 'string' ? rawTarget.objectType.trim() : ''
    if (
        !projectId ||
        projectId.length > 160 ||
        !objectId ||
        objectId.length > 200 ||
        !MENUBAR_CONVERSATION_OBJECT_TYPES.has(objectType)
    ) {
        throw new Error('target is invalid')
    }
    return { projectId, objectId, objectType }
}

async function resolveMenubarConversationTarget(db, userId, target) {
    if (!target) return null
    const [projectDoc, chatDoc] = await Promise.all([
        db.doc(`projects/${target.projectId}`).get(),
        db.doc(`chatObjects/${target.projectId}/chats/${target.objectId}`).get(),
    ])
    if (!projectDoc.exists || !chatDoc.exists) return null

    const project = projectDoc.data() || {}
    if (!Array.isArray(project.userIds) || !project.userIds.includes(userId)) return null

    const chat = chatDoc.data() || {}
    const { isChatVisibleToUser } = require('./menubarLastComment').__private__
    if (!isChatVisibleToUser(chat, userId)) return null
    const typeMatches =
        !chat.type ||
        chat.type === target.objectType ||
        (chat.type === 'users' && target.objectType === 'contacts') ||
        (chat.type === 'contacts' && target.objectType === 'users')
    if (!typeMatches) return null

    const { getObjectDocPath } = require('../shared/privacyAccess')
    const objectPath = getObjectDocPath(target.projectId, target.objectType, target.objectId)
    let parentObject = chat
    if (objectPath && objectPath !== `chatObjects/${target.projectId}/chats/${target.objectId}`) {
        const objectDoc = await db.doc(objectPath).get()
        parentObject = objectDoc.exists ? objectDoc.data() || {} : null
    }
    const assistantStateSource = typeof chat.isAssistantEnabled === 'boolean' ? chat : parentObject
    const isWebhookTask = target.objectType === 'tasks' && parentObject?.taskMetadata?.isWebhookTask === true
    const assistantReplyEnabled = assistantStateSource?.isAssistantEnabled === true && !isWebhookTask

    return {
        projectId: target.projectId,
        project,
        chatId: target.objectId,
        objectType: target.objectType,
        chat,
        parentObject,
        assistantId:
            (typeof parentObject?.assistantId === 'string' && parentObject.assistantId.trim()) ||
            (typeof chat.assistantId === 'string' && chat.assistantId.trim()) ||
            '',
        assistantReplyEnabled,
        isAssistantThread: isOwnedMacAppTopic(target.objectId, chat, userId),
    }
}

async function deleteMenubarThreadNotifications(db, projectId, chatId, userId, notificationDocs) {
    for (let index = 0; index < notificationDocs.length; index += 400) {
        const batch = db.batch()
        notificationDocs.slice(index, index + 400).forEach(doc => batch.delete(doc.ref))
        await batch.commit()
    }

    const [emailDoc, pushSnapshot] = await Promise.all([
        db.doc(`emailNotifications/${chatId}`).get(),
        db
            .collection('pushNotifications')
            .where('chatId', '==', chatId)
            .where('userIds', 'array-contains', userId)
            .get(),
    ])

    const batch = db.batch()
    if (emailDoc.exists) {
        const userIds = Array.isArray(emailDoc.data()?.userIds) ? emailDoc.data().userIds : []
        if (userIds.includes(userId)) {
            if (userIds.length > 1) {
                batch.set(emailDoc.ref, { userIds: admin.firestore.FieldValue.arrayRemove(userId) }, { merge: true })
            } else {
                batch.delete(emailDoc.ref)
            }
        }
    }
    pushSnapshot.docs.forEach(doc => {
        const userIds = Array.isArray(doc.data()?.userIds) ? doc.data().userIds : []
        if (userIds.length > 1) {
            batch.set(doc.ref, { userIds: admin.firestore.FieldValue.arrayRemove(userId) }, { merge: true })
        } else {
            batch.delete(doc.ref)
        }
    })
    await batch.commit()
}

async function resolveMenubarAssistantThread(db, userId, userData, requestedChatId) {
    const defaultProjectId = typeof userData.defaultProjectId === 'string' ? userData.defaultProjectId.trim() : ''
    if (!defaultProjectId) return null

    const projectDoc = await db.doc(`projects/${defaultProjectId}`).get()
    const project = projectDoc.exists ? projectDoc.data() || {} : null
    if (!project || !Array.isArray(project.userIds) || !project.userIds.includes(userId)) return null

    const { getUserLocalDateContext } = require('../Assistant/contextTimestampHelper')
    const todayChatId = `MacApp${getUserLocalDateContext(userData).dateKey}${userId}`
    const pointer = userData.menubarAssistantThread
    const assistantLinePointer = userData.lastAssistantCommentData?.[defaultProjectId]
    const candidateIds = [
        requestedChatId,
        todayChatId,
        pointer?.projectId === defaultProjectId ? pointer.chatId : null,
        assistantLinePointer?.objectType === 'topics' ? assistantLinePointer.objectId : null,
    ].filter((value, index, values) => typeof value === 'string' && value && values.indexOf(value) === index)

    for (const chatId of candidateIds) {
        const chatDoc = await db.doc(`chatObjects/${defaultProjectId}/chats/${chatId}`).get()
        if (!chatDoc.exists) continue
        const chat = chatDoc.data() || {}
        if (!isOwnedMacAppTopic(chatId, chat, userId)) continue
        return {
            projectId: defaultProjectId,
            project,
            chatId,
            objectType: 'topics',
            chat,
            isAssistantThread: true,
        }
    }
    return null
}

// POST /api/menubar/assistant-thread
//   { token, chatId?, target?: { projectId, objectId, objectType }, before?, limit?, markRead? }
// Returns a safe, paginated view of the requested visible object thread, or
// the user's current/recent Mac App topic when no explicit target is supplied.
// Merely fetching the compact preview never clears unread markers; the macOS
// conversation panel opts into `markRead` while it is visible, matching the
// web RichCommentModal behavior.
async function handleMenubarAssistantThread(req, res) {
    res.set('Cache-Control', 'no-store')

    if (req.method !== 'POST') {
        res.status(405).json({ success: false, error: 'Method not allowed' })
        return
    }

    const token = req.body?.token
    const ip = getRequestIp(req)
    const tokenKey = typeof token === 'string' ? hashToken(token).slice(0, 16) : 'invalid'
    if (isRateLimited(`mbt:ip:${ip}`, 240, 60 * 1000) || isRateLimited(`mbt:token:${tokenKey}`, 120, 60 * 1000)) {
        res.status(429).json({ success: false, error: 'Rate limit exceeded' })
        return
    }

    try {
        const tokenUser = await resolveTokenUser(token)
        if (!tokenUser) {
            res.status(401).json({ success: false, error: 'Invalid token' })
            return
        }
        const { userId, userData } = tokenUser
        let target
        try {
            target = normalizeMenubarConversationTarget(req.body?.target)
        } catch (targetError) {
            res.status(400).json({ success: false, error: targetError.message })
            return
        }
        const requestedChatId = typeof req.body?.chatId === 'string' ? req.body.chatId.trim() : ''
        if (!target && requestedChatId && (!requestedChatId.startsWith('MacApp') || requestedChatId.length > 160)) {
            res.status(400).json({ success: false, error: 'chatId is invalid' })
            return
        }

        const db = admin.firestore()
        const resolved = target
            ? await resolveMenubarConversationTarget(db, userId, target)
            : await resolveMenubarAssistantThread(db, userId, userData, requestedChatId)
        if (!resolved) {
            res.status(200).json({ success: true, thread: null, messages: [], unreadCount: 0, hasMore: false })
            return
        }

        const { projectId, project, chatId, objectType, chat, isAssistantThread, assistantReplyEnabled } = resolved
        const actor = await getMenubarAssistantActor(db, userData)
        const assistantId = resolved.assistantId || chat.assistantId || actor.assistantId || ''
        const assistantName = isAssistantThread
            ? actor.assistantId === assistantId
                ? actor.feedUser.displayName || 'Anna'
                : 'Anna'
            : assistantReplyEnabled
            ? actor.assistantId === assistantId
                ? actor.feedUser.displayName || 'Assistant'
                : 'Assistant'
            : 'Comments'
        const requestedLimit = Number(req.body?.limit)
        const limit = Number.isFinite(requestedLimit)
            ? Math.max(1, Math.min(Math.floor(requestedLimit), MAX_ASSISTANT_THREAD_PAGE_SIZE))
            : DEFAULT_ASSISTANT_THREAD_PAGE_SIZE
        const before = Number(req.body?.before)

        let commentsQuery = db
            .collection(`chatComments/${projectId}/${objectType}/${chatId}/comments`)
            .orderBy('created', 'desc')
        if (Number.isFinite(before) && before > 0) commentsQuery = commentsQuery.where('created', '<', before)
        const [commentsSnapshot, notificationsSnapshot] = await Promise.all([
            commentsQuery.limit(limit + 1).get(),
            db.collection(`chatNotifications/${projectId}/${userId}`).where('chatId', '==', chatId).get(),
        ])

        const hasMore = commentsSnapshot.size > limit
        const docs = commentsSnapshot.docs.slice(0, limit)
        const messages = (
            await Promise.all(
                docs.map(async doc => {
                    const data = doc.data() || {}
                    const fromAssistant = data.fromAssistant === true || data.creatorId === assistantId
                    const { resolveAuthorName } = require('./menubarLastComment').__private__
                    const authorName = await resolveAuthorName(
                        db,
                        projectId,
                        data.creatorId || '',
                        fromAssistant ? 'assistant' : 'user',
                        userId,
                        userData
                    )
                    const message = normalizeAssistantThreadMessage(
                        doc.id,
                        data,
                        assistantId,
                        assistantName,
                        userId,
                        getUserDisplayName(userData),
                        authorName
                    )
                    return {
                        ...message,
                        links: await resolveMenubarRichTextLinks(db, message.richText, userId, getAppBaseUrl()),
                    }
                })
            )
        ).reverse()
        const markRead = req.body?.markRead === true
        if (markRead && !notificationsSnapshot.empty) {
            await deleteMenubarThreadNotifications(db, projectId, chatId, userId, notificationsSnapshot.docs)
        }

        res.status(200).json({
            success: true,
            thread: {
                projectId,
                projectName: project.name || '',
                assistantId,
                assistantName,
                chatId,
                objectType,
                isAssistantThread,
                assistantReplyEnabled: isAssistantThread ? true : assistantReplyEnabled === true,
                title: chat.title || 'Mac App',
                url: require('./menubarLastComment').__private__.buildLastCommentUrl(
                    getAppBaseUrl(),
                    projectId,
                    objectType,
                    chatId
                ),
            },
            messages,
            unreadCount: markRead ? 0 : notificationsSnapshot.size,
            clearedUnreadCount: markRead ? notificationsSnapshot.size : 0,
            hasMore,
            nextBefore: hasMore && docs.length ? toMillis(docs[docs.length - 1].data().created) : null,
        })
    } catch (error) {
        console.error('menubarAssistantThread: error', error)
        if (!res.headersSent) res.status(500).json({ success: false, error: 'Internal error' })
    }
}

// POST /api/menubar/assistant-message  ->
//   { token, requestId, comment,
//     image?: { mimeType, dataBase64, width?, height? },
//     attachment?: { fileName, mimeType, dataBase64 },
//     target?: { projectId, objectId, objectType }, client? }
//   200 { success: true, deduplicated, projectId, projectName, assistantId,
//         assistantName, chatId, commentId, url }
//
// With an explicit target, appends a regular comment to that visible object.
// Otherwise appends to the user's daily "Mac App" topic with the default assistant
// (same daily-topic model as the WhatsApp chat), then queues the assistant
// reply via ASSISTANT_RUNS_COLLECTION — the reply is generated by the
// processMenubarAssistantRun Firestore trigger, never inside this request
// (gen2 CPU throttling after res.send would starve it).
async function handleMenubarAssistantMessage(req, res) {
    res.set('Cache-Control', 'no-store')

    if (req.method !== 'POST') {
        res.status(405).json({ success: false, error: 'Method not allowed' })
        return
    }

    const token = req.body?.token
    const ip = getRequestIp(req)
    const tokenKey = typeof token === 'string' ? hashToken(token).slice(0, 16) : 'invalid'
    if (isRateLimited(`mba:ip:${ip}`, 120, 60 * 1000) || isRateLimited(`mba:token:${tokenKey}`, 30, 60 * 1000)) {
        res.status(429).json({ success: false, error: 'Rate limit exceeded' })
        return
    }

    try {
        const tokenUser = await resolveTokenUser(token)
        if (!tokenUser) {
            res.status(401).json({ success: false, error: 'Invalid token' })
            return
        }
        const { userId, userData } = tokenUser

        const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : ''
        if (!comment) {
            res.status(400).json({ success: false, error: 'comment is required' })
            return
        }
        if (comment.length > MAX_ASSISTANT_COMMENT_LENGTH) {
            res.status(400).json({
                success: false,
                error: `comment exceeds ${MAX_ASSISTANT_COMMENT_LENGTH} characters`,
            })
            return
        }

        const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : ''
        if (!requestId || requestId.length < 8 || requestId.length > 100 || !/^[A-Za-z0-9_-]+$/.test(requestId)) {
            res.status(400).json({ success: false, error: 'requestId is invalid' })
            return
        }

        let image
        let attachment
        try {
            image = decodeAssistantMessageImage(req.body?.image)
            attachment = decodeAssistantMessageAttachment(req.body?.attachment)
            if (image && attachment) throw new Error('Only one attachment can be sent at a time')
        } catch (attachmentError) {
            const status = ['IMAGE_TOO_LARGE', 'ATTACHMENT_TOO_LARGE'].includes(attachmentError.code) ? 413 : 400
            res.status(status).json({ success: false, error: attachmentError.message })
            return
        }

        const rawLanguage = req.body?.client?.language
        const language =
            typeof rawLanguage === 'string' && /^[A-Za-z-]{2,10}$/.test(rawLanguage.trim()) ? rawLanguage.trim() : 'en'

        const db = admin.firestore()

        let target
        try {
            target = normalizeMenubarConversationTarget(req.body?.target)
        } catch (targetError) {
            res.status(400).json({ success: false, error: targetError.message })
            return
        }
        const resolvedTarget = target ? await resolveMenubarConversationTarget(db, userId, target) : null
        if (target && !resolvedTarget) {
            res.status(404).json({ success: false, error: 'Conversation not found or not accessible' })
            return
        }

        // Default Ask Anna sends still resolve the user's configured project
        // and assistant. Explicit object comments use the selected project.
        const defaultProjectId = typeof userData.defaultProjectId === 'string' ? userData.defaultProjectId.trim() : ''
        let project = resolvedTarget?.project || null
        let actor = null
        let assistantId = ''
        if (!resolvedTarget) {
            const projectDoc = defaultProjectId ? await db.doc(`projects/${defaultProjectId}`).get() : null
            project = projectDoc && projectDoc.exists ? projectDoc.data() || {} : null
            if (!project || !Array.isArray(project.userIds) || !project.userIds.includes(userId)) {
                res.status(404).json({ success: false, error: 'No default project or assistant configured' })
                return
            }

            actor = await getMenubarAssistantActor(db, userData)
            if (!actor.assistantId) {
                res.status(404).json({ success: false, error: 'No default project or assistant configured' })
                return
            }
            assistantId = actor.assistantId
        } else if (resolvedTarget.assistantReplyEnabled) {
            actor = await getMenubarAssistantActor(db, userData)
            assistantId = resolvedTarget.assistantId || actor.assistantId || ''
        }

        // Idempotency: repeats of the same requestId return the original result.
        const messageRef = db
            .collection(ASSISTANT_MESSAGES_COLLECTION)
            .doc(buildAssistantMessageDocId(userId, requestId))
        const existingMessage = await messageRef.get()
        if (existingMessage.exists) {
            const messageData = existingMessage.data() || {}
            if (messageData.status === 'completed' && messageData.response) {
                res.status(200).json({ ...messageData.response, deduplicated: true })
                return
            }
            if (
                messageData.status === 'pending' &&
                Date.now() - (messageData.createdAt || 0) < ASSISTANT_MESSAGE_PENDING_TIMEOUT_MS
            ) {
                res.status(409).json({ success: false, error: 'This message is already being processed' })
                return
            }
        }
        await messageRef.set({ userId, requestId, status: 'pending', createdAt: Date.now() })

        const failMessage = () => {
            messageRef
                .set({ status: 'failed', updatedAt: Date.now() }, { merge: true })
                .catch(error => console.warn('menubarAssistantMessage: marking failed errored', error))
        }

        // Upload the screenshot/file and embed it via the app's native media
        // tokens (the same formats the web chat input writes).
        let uploaded = null
        let commentText = comment
        try {
            const media = attachment || image
            if (media) {
                uploaded = await uploadAssistantChatAttachment(media)
                const {
                    buildAttachmentToken,
                    buildImageToken,
                    buildVideoToken,
                } = require('../WhatsApp/whatsAppMediaTokens')
                const token = media.mimeType.startsWith('image/')
                    ? buildImageToken(uploaded.url, uploaded.url, media.fileName)
                    : media.mimeType.startsWith('video/')
                    ? buildVideoToken(uploaded.url, media.fileName)
                    : buildAttachmentToken(uploaded.url, media.fileName)
                commentText = `${comment}\n\n${token}`
            }
        } catch (uploadError) {
            console.error('menubarAssistantMessage: attachment upload failed', uploadError)
            failMessage()
            res.status(500).json({ success: false, error: 'Failed to upload attachment' })
            return
        }

        try {
            const { extractMediaContextFromText } = require('../Utils/parseTextUtils')
            const { FEED_PUBLIC_FOR_ALL, STAYWARD_COMMENT } = require('../Utils/HelperFunctionsCloud')
            const mediaContext = extractMediaContextFromText(commentText)

            const now = Date.now()
            const preview = comment.substring(0, 200)

            if (resolvedTarget) {
                const { projectId, chatId, objectType, chat } = resolvedTarget
                const commentId = db.collection('_').doc().id
                const isPublicFor = Array.isArray(chat.isPublicFor) ? chat.isPublicFor : [FEED_PUBLIC_FOR_ALL]
                const visibleUserIds = Array.isArray(project.userIds)
                    ? project.userIds.filter(
                          candidateId =>
                              candidateId !== userId &&
                              (isPublicFor.includes(FEED_PUBLIC_FOR_ALL) || isPublicFor.includes(candidateId))
                      )
                    : []
                const followerIds = Array.from(
                    new Set([userId, ...(Array.isArray(chat.usersFollowing) ? chat.usersFollowing : [])])
                ).filter(candidateId => project.userIds.includes(candidateId))
                const followers = new Set(followerIds)
                const pointer = {
                    objectType,
                    objectId: chatId,
                    creatorId: userId,
                    creatorType: 'user',
                    date: now,
                }

                const batch = db.batch()
                batch.set(db.doc(`chatComments/${projectId}/${objectType}/${chatId}/comments/${commentId}`), {
                    commentText,
                    mediaContext,
                    lastChangeDate: admin.firestore.Timestamp.now(),
                    created: now,
                    creatorId: userId,
                    fromAssistant: false,
                    source: 'menubar',
                    ...(objectType === 'tasks' ? { commentType: STAYWARD_COMMENT } : {}),
                })
                batch.update(db.doc(`chatObjects/${projectId}/chats/${chatId}`), {
                    members: admin.firestore.FieldValue.arrayUnion(userId),
                    usersFollowing: admin.firestore.FieldValue.arrayUnion(userId),
                    lastEditionDate: now,
                    lastEditorId: userId,
                    'commentsData.lastComment': preview || 'Comment',
                    'commentsData.lastCommentOwnerId': userId,
                    'commentsData.lastCommentType': STAYWARD_COMMENT,
                    'commentsData.amount': admin.firestore.FieldValue.increment(1),
                })
                visibleUserIds.forEach(candidateId => {
                    batch.set(db.doc(`chatNotifications/${projectId}/${candidateId}/${commentId}`), {
                        chatId,
                        chatType: objectType,
                        followed: followers.has(candidateId),
                        date: now,
                        creatorId: userId,
                        creatorType: 'user',
                    })
                })
                followerIds.forEach(candidateId => {
                    batch.update(db.doc(`users/${candidateId}`), {
                        [`lastAssistantCommentData.${projectId}`]: pointer,
                        'lastAssistantCommentData.allProjects': { ...pointer, projectId },
                    })
                })
                await batch.commit()

                const targetAssistantId = assistantId || resolvedTarget.assistantId || ''
                const expectsAssistantReply = resolvedTarget.assistantReplyEnabled === true && !!targetAssistantId
                if (expectsAssistantReply) {
                    await db.collection(ASSISTANT_RUNS_COLLECTION).add({
                        userId,
                        projectId,
                        objectType,
                        objectId: chatId,
                        assistantId: targetAssistantId,
                        messageId: commentId,
                        userIdsToNotify: Array.from(new Set([...visibleUserIds, userId])),
                        isPublicFor,
                        followerIds,
                        language,
                        requestId,
                        status: 'pending',
                        createdAt: now,
                    })
                }

                const response = {
                    success: true,
                    deduplicated: false,
                    projectId,
                    projectName: project.name || '',
                    assistantId: targetAssistantId,
                    assistantName:
                        expectsAssistantReply && actor?.assistantId === targetAssistantId
                            ? actor.feedUser.displayName || 'Assistant'
                            : '',
                    chatId,
                    commentId,
                    expectsAssistantReply,
                    url: require('./menubarLastComment').__private__.buildLastCommentUrl(
                        getAppBaseUrl(),
                        projectId,
                        objectType,
                        chatId
                    ),
                }

                await messageRef.set(
                    { status: 'completed', response, commentId, chatId, updatedAt: Date.now() },
                    { merge: true }
                )
                res.status(200).json(response)
                return
            }

            const assistantName = actor.feedUser.displayName || 'Assistant'

            // Messages collect in a daily "Mac App" topic — the same model as
            // the WhatsApp daily chat.
            const { chatId } = await getOrCreateMacAppDailyTopic(db, userId, defaultProjectId, assistantId, userData)
            const chatRef = db.doc(`chatObjects/${defaultProjectId}/chats/${chatId}`)

            await db.doc(`users/${userId}`).set(
                {
                    menubarAssistantThread: {
                        projectId: defaultProjectId,
                        chatId,
                        assistantId,
                        updatedAt: now,
                    },
                },
                { merge: true }
            )

            const commentId = db.collection('_').doc().id
            await db.doc(`chatComments/${defaultProjectId}/topics/${chatId}/comments/${commentId}`).set({
                commentText,
                mediaContext,
                lastChangeDate: admin.firestore.Timestamp.now(),
                created: now,
                creatorId: userId,
                fromAssistant: false,
                source: 'menubar',
            })

            await chatRef
                .update({
                    members: admin.firestore.FieldValue.arrayUnion(userId),
                    lastEditionDate: now,
                    lastEditorId: userId,
                    'commentsData.lastComment': preview,
                    'commentsData.lastCommentOwnerId': userId,
                    'commentsData.lastCommentType': STAYWARD_COMMENT,
                    'commentsData.amount': admin.firestore.FieldValue.increment(1),
                })
                .catch(error => console.warn('menubarAssistantMessage: chat metadata update failed', error))

            // Queue the assistant reply for the Firestore-triggered processor.
            await db.collection(ASSISTANT_RUNS_COLLECTION).add({
                userId,
                projectId: defaultProjectId,
                objectType: 'topics',
                objectId: chatId,
                assistantId,
                messageId: commentId,
                userIdsToNotify: [userId],
                isPublicFor: [FEED_PUBLIC_FOR_ALL],
                followerIds: [userId],
                language,
                requestId,
                status: 'pending',
                createdAt: now,
            })

            const response = {
                success: true,
                deduplicated: false,
                projectId: defaultProjectId,
                projectName: project.name || '',
                assistantId,
                assistantName,
                chatId,
                commentId,
                expectsAssistantReply: true,
                url: `${getAppBaseUrl()}/projects/${defaultProjectId}/chats/${chatId}/chat`,
            }

            await messageRef.set(
                { status: 'completed', response, commentId, chatId, updatedAt: Date.now() },
                { merge: true }
            )

            res.status(200).json(response)
        } catch (writeError) {
            console.error('menubarAssistantMessage: message creation failed', writeError)
            if (uploaded) {
                await uploaded.file
                    .delete()
                    .catch(error =>
                        console.warn('menubarAssistantMessage: attachment cleanup failed', { error: error.message })
                    )
            }
            failMessage()
            res.status(500).json({ success: false, error: 'Failed to send message' })
        }
    } catch (error) {
        console.error('menubarAssistantMessage: error', error)
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: 'Internal error' })
        }
    }
}

// Firestore trigger body for ASSISTANT_RUNS_COLLECTION documents: generates
// the assistant's reply to a queued menubar message. Duplicate triggers and
// retries are deduped by the shared assistant run lock.
async function processMenubarAssistantRun(event) {
    const snapshot = event.data
    if (!snapshot) return
    const runRef = snapshot.ref
    const run = snapshot.data() || {}

    if (run.status && run.status !== 'pending') return

    const { userId, projectId, objectId, assistantId, messageId } = run
    // Daily Mac App topics use 'topics'; runs queued before the daily-topic
    // switch carry 'assistants'.
    const objectType = typeof run.objectType === 'string' && run.objectType ? run.objectType : 'topics'
    if (!userId || !projectId || !objectId || !assistantId || !messageId) {
        console.warn('menubarAssistantRun: invalid run payload', { runId: snapshot.id })
        await runRef.set({ status: 'invalid', updatedAt: Date.now() }, { merge: true })
        return
    }

    const { FEED_PUBLIC_FOR_ALL } = require('../Utils/HelperFunctionsCloud')
    const {
        acquireAssistantRunLock,
        cancelAssistantRunLock,
        completeAssistantRunLock,
        failAssistantRunLock,
        isAssistantRunCancelledError,
    } = require('../Assistant/assistantRunIdempotency')

    const lock = await acquireAssistantRunLock(admin.firestore(), {
        userId,
        messageId,
        projectId,
        objectType,
        objectId,
        assistantId,
    })
    if (!lock.acquired) {
        console.log('menubarAssistantRun: duplicate run skipped', { runId: snapshot.id, reason: lock.reason })
        await runRef.set({ status: 'duplicate', updatedAt: Date.now() }, { merge: true })
        return
    }

    await runRef.set({ status: 'processing', updatedAt: Date.now() }, { merge: true })

    const { askToOpenAIBot } = require('../Assistant/assistantNormalTalk_optimized')
    try {
        await askToOpenAIBot(
            userId,
            messageId,
            projectId,
            objectType,
            objectId,
            Array.isArray(run.userIdsToNotify) && run.userIdsToNotify.length ? run.userIdsToNotify : [userId],
            Array.isArray(run.isPublicFor) && run.isPublicFor.length ? run.isPublicFor : [FEED_PUBLIC_FOR_ALL],
            typeof run.language === 'string' && run.language ? run.language : 'en',
            assistantId,
            Array.isArray(run.followerIds) && run.followerIds.length ? run.followerIds : [userId],
            Date.now(),
            lock.lockId
        )
        await completeAssistantRunLock(lock.lockRef)
        await runRef.set({ status: 'completed', updatedAt: Date.now() }, { merge: true })
    } catch (error) {
        if (isAssistantRunCancelledError(error)) {
            await cancelAssistantRunLock(lock.lockRef)
            await runRef.set({ status: 'cancelled', updatedAt: Date.now() }, { merge: true })
            return
        }
        console.error('menubarAssistantRun: assistant reply failed', {
            runId: snapshot.id,
            projectId,
            assistantId,
            error: error.message,
        })
        await failAssistantRunLock(lock.lockRef, error)
        await runRef.set(
            { status: 'failed', error: String(error.message || error).slice(0, 500), updatedAt: Date.now() },
            { merge: true }
        )
    }
}

module.exports = {
    mintMenubarAppToken,
    listMenubarAppTokens,
    revokeMenubarAppToken,
    handleMenubarSession,
    handleMenubarGoldWebhook,
    handleMenubarProjects,
    handleMenubarPushNote,
    handleMenubarAssistantMessage,
    handleMenubarAssistantThread,
    processMenubarAssistantRun,
    __private__: {
        buildNotePushDocId,
        buildLegacyNotePushDocId,
        normalizeNoteMove,
        resolveMenubarNotePrivacy,
        getMenubarAssistantActor,
        decodeNoteAttachments,
        rewriteMarkdownAttachmentUrls,
        buildAssistantMessageDocId,
        decodeAssistantMessageAttachment,
        decodeAssistantMessageImage,
        isOwnedMacAppTopic,
        normalizeMenubarConversationTarget,
        normalizeAssistantThreadMessage,
        resolveMenubarConversationTarget,
        enableNoteAssistantChat,
        resolveMenubarAssistantThread,
        toMillis,
    },
}
