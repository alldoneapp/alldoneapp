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

async function resolveTokenSession(token) {
    const tokenUser = await resolveTokenUser(token)
    if (!tokenUser) return null
    const { userData } = tokenUser

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

async function getMenubarAssistantActor(db, projectId) {
    const projectDoc = await db.doc(`projects/${projectId}`).get()
    const project = projectDoc.exists ? projectDoc.data() || {} : {}
    let assistantId = typeof project.assistantId === 'string' ? project.assistantId.trim() : ''
    let assistant = null

    if (assistantId) {
        const [projectAssistantDoc, globalAssistantDoc] = await db.getAll(
            db.doc(`assistants/${projectId}/items/${assistantId}`),
            db.doc(`assistants/globalProject/items/${assistantId}`)
        )
        const assistantDoc = projectAssistantDoc.exists ? projectAssistantDoc : globalAssistantDoc
        assistant = assistantDoc.exists ? assistantDoc.data() || {} : null
    } else {
        const defaultAssistantSnapshot = await db
            .collection('assistants/globalProject/items')
            .where('isDefault', '==', true)
            .limit(1)
            .get()
        const defaultAssistantDoc = defaultAssistantSnapshot.docs[0]
        if (defaultAssistantDoc) {
            assistantId = defaultAssistantDoc.id
            assistant = defaultAssistantDoc.data() || {}
        }
    }

    if (!assistantId) {
        return {
            assistantId: null,
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

    assistant = assistant || {}
    const displayName = assistant.displayName || assistant.name || 'Anna Alldone'
    return {
        assistantId,
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

// POST /api/menubar/notes  ->
//   { token, title, content, attachments?, projectId?, projectName?, move?,
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
                const assistantActor = await getMenubarAssistantActor(db, resolution.projectId)
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

        const assistantActor = await getMenubarAssistantActor(db, resolution.projectId)
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
                    isPrivate: false,
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

module.exports = {
    mintMenubarAppToken,
    listMenubarAppTokens,
    revokeMenubarAppToken,
    handleMenubarSession,
    handleMenubarGoldWebhook,
    handleMenubarProjects,
    handleMenubarPushNote,
    __private__: {
        buildNotePushDocId,
        buildLegacyNotePushDocId,
        normalizeNoteMove,
        getMenubarAssistantActor,
        decodeNoteAttachments,
        rewriteMarkdownAttachmentUrls,
    },
}
