'use strict'

const admin = require('firebase-admin')
const crypto = require('crypto')
const { v4: uuidv4 } = require('uuid')

const { getEnvFunctions } = require('../envFunctionsHelper')
const { sendAnnaEmailReply } = require('./emailReplyService')
const { DEFAULT_PUBLIC_EMAIL, normalizeEmailAddress } = require('./emailChannelHelpers')
const { findVerifiedUserByPrimaryEmail, getDefaultAssistantIdForUser } = require('./emailUserRouting')

async function handleIncomingAnnaEmail(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed')
    }

    try {
        const payload = normalizeInboundEmailPayload(req.body || {}, req.headers || {})
        if (!payload.messageId || !payload.fromEmail) {
            return res.status(400).json({ error: 'messageId and fromEmail are required' })
        }

        const env = getEnvFunctions()
        const verification = verifyIncomingRequestAuth(req, payload, env)
        if (!verification.valid) {
            console.warn('Email Channel: Invalid inbound auth', {
                messageId: payload.messageId,
                reason: verification.reason,
            })
            return res.status(403).send('Forbidden')
        }

        const user = await findVerifiedUserByPrimaryEmail(payload.fromEmail)
        if (!user) {
            await replySafely(payload, `I couldn't match this sender to a verified Alldone account email.`)
            return res.status(200).json({ ok: true, status: 'unknown_sender' })
        }

        if (user.assistantEmailEnabled !== true) {
            await replySafely(
                payload,
                `Anna email is not enabled for this account yet. Enable it in Alldone settings and try again.`
            )
            return res.status(200).json({ ok: true, status: 'email_disabled', userId: user.uid })
        }

        const projectId = String(user.defaultProjectId || '').trim()
        if (!projectId) {
            await replySafely(payload, `I couldn't find a default project for this account.`)
            return res.status(200).json({ ok: true, status: 'missing_default_project', userId: user.uid })
        }

        const assistantId = await getDefaultAssistantIdForUser(user, projectId)
        const attachments = await uploadInboundAttachments(payload.messageId, payload.attachments)
        const enqueueResult = await enqueueIncomingEmailMessage({
            userId: user.uid,
            projectId,
            assistantId: assistantId || null,
            messageId: payload.messageId,
            fromEmail: payload.fromEmail,
            subject: payload.subject,
            textBody: payload.textBody,
            htmlBody: payload.htmlBody,
            receivedAt: payload.receivedAt,
            threadHeaders: payload.threadHeaders,
            headers: payload.headers,
            attachments,
        })

        await upsertAuditRecord(payload.messageId, {
            status: enqueueResult.duplicate ? 'duplicate' : 'queued',
            userId: user.uid,
            projectId,
            assistantId: assistantId || null,
            fromEmail: payload.fromEmail,
            subject: payload.subject,
            attachmentCount: attachments.length,
            updatedAt: Date.now(),
        })

        return res.status(200).json({
            ok: true,
            duplicate: enqueueResult.duplicate,
            userId: user.uid,
            projectId,
            queuePath: enqueueResult.queuePath,
        })
    } catch (error) {
        console.error('Email Channel: Unhandled incoming email error', error)
        return res.status(500).json({ error: error.message || 'Internal Server Error' })
    }
}

function normalizeInboundEmailPayload(body = {}, headers = {}) {
    const normalizedHeaders = isObject(body.headers) ? body.headers : {}
    const threadHeaders = isObject(body.threadHeaders) ? body.threadHeaders : {}

    return {
        messageId: String(body.messageId || body.providerMessageId || body.id || uuidv4()).trim(),
        fromEmail: normalizeEmailAddress(body.fromEmail || body.senderEmail || body.from || ''),
        subject: String(body.subject || '').trim(),
        textBody: String(body.textBody || body.text || '').trim(),
        htmlBody: String(body.htmlBody || body.html || '').trim(),
        receivedAt: Number(body.receivedAt || Date.now()) || Date.now(),
        headers: normalizedHeaders,
        threadHeaders: {
            replyTo: String(
                threadHeaders.replyTo || normalizedHeaders['Reply-To'] || normalizedHeaders['reply-to'] || ''
            )
                .trim()
                .toLowerCase(),
            inReplyTo: String(
                threadHeaders.inReplyTo || normalizedHeaders['In-Reply-To'] || normalizedHeaders['in-reply-to'] || ''
            ).trim(),
            references: String(
                threadHeaders.references || normalizedHeaders['References'] || normalizedHeaders.references || ''
            ).trim(),
        },
        attachments: normalizeInboundAttachments(body.attachments),
        rawForSignature: body,
    }
}
function normalizeInboundAttachments(rawAttachments = []) {
    if (!Array.isArray(rawAttachments)) return []

    return rawAttachments
        .map(attachment => ({
            fileName: String(attachment?.fileName || attachment?.filename || '').trim(),
            contentType: String(attachment?.contentType || attachment?.mimeType || '').trim(),
            contentBase64: String(
                attachment?.contentBase64 || attachment?.base64 || attachment?.content || attachment?.data || ''
            ).trim(),
            sizeBytes: Number(attachment?.sizeBytes || attachment?.size || 0) || 0,
        }))
        .filter(attachment => attachment.fileName || attachment.contentBase64)
}

async function uploadInboundAttachments(messageId, attachments = []) {
    if (!Array.isArray(attachments) || attachments.length === 0) return []

    const bucket = admin.storage().bucket()
    const results = []

    for (let index = 0; index < attachments.length; index++) {
        const attachment = attachments[index]
        const base64 = String(attachment.contentBase64 || '').trim()
        if (!base64) {
            results.push({
                fileName: attachment.fileName || `attachment-${index + 1}`,
                contentType: attachment.contentType || 'application/octet-stream',
                sizeBytes: Number(attachment.sizeBytes || 0) || 0,
                storagePath: '',
            })
            continue
        }

        const buffer = Buffer.from(base64, 'base64')
        const safeFileName = sanitizeFileName(attachment.fileName || `attachment-${index + 1}`)
        const storagePath = `anna-email-inbound/${messageId}/${index + 1}-${safeFileName}`
        await bucket.file(storagePath).save(buffer, {
            resumable: false,
            contentType: attachment.contentType || 'application/octet-stream',
            metadata: {
                metadata: {
                    originalFileName: attachment.fileName || safeFileName,
                },
            },
        })

        results.push({
            fileName: attachment.fileName || safeFileName,
            contentType: attachment.contentType || 'application/octet-stream',
            sizeBytes: buffer.length,
            storagePath,
        })
    }

    return results
}

function sanitizeFileName(fileName = '') {
    return String(fileName || 'attachment')
        .replace(/[^\w.\-]+/g, '_')
        .replace(/_+/g, '_')
        .substring(0, 120)
}

async function enqueueIncomingEmailMessage(payload) {
    const db = admin.firestore()
    const normalizedMessageId = String(payload.messageId || uuidv4()).trim()
    const userId = String(payload.userId || '').trim()
    if (!normalizedMessageId || !userId) {
        throw new Error('Cannot enqueue email without messageId and userId')
    }

    const dedupRef = db.doc(`annaEmailInboundDedup/${normalizedMessageId}`)
    const queueRef = db.doc(`annaEmailInboundQueue/${userId}/items/${normalizedMessageId}`)
    const now = Date.now()
    let duplicate = false

    await db.runTransaction(async transaction => {
        const dedupDoc = await transaction.get(dedupRef)
        if (dedupDoc.exists) {
            duplicate = true
            return
        }

        transaction.set(dedupRef, {
            messageId: normalizedMessageId,
            userId,
            fromEmail: payload.fromEmail || '',
            createdAt: now,
        })

        transaction.set(queueRef, {
            ...payload,
            messageId: normalizedMessageId,
            status: 'pending',
            attempts: 0,
            createdAt: now,
            updatedAt: now,
        })
    })

    return {
        duplicate,
        queuePath: queueRef.path,
    }
}

async function upsertAuditRecord(messageId, patch = {}) {
    if (!messageId) return

    await admin
        .firestore()
        .doc(`annaEmailInboundAudit/${messageId}`)
        .set(
            {
                messageId,
                ...patch,
            },
            { merge: true }
        )
}

async function replySafely(payload, replyText) {
    try {
        await sendAnnaEmailReply({
            toEmail: payload.fromEmail,
            subject: buildReplySubject(payload.subject),
            replyText,
            inReplyTo: payload.threadHeaders?.inReplyTo || '',
            references: payload.threadHeaders?.references || '',
            fromEmail: getEnvFunctions().ANNA_EMAIL_PUBLIC_ADDRESS || DEFAULT_PUBLIC_EMAIL,
        })
    } catch (error) {
        console.error('Email Channel: Failed sending immediate reply', {
            messageId: payload.messageId,
            error: error.message,
        })
    }
}

function buildReplySubject(subject = '') {
    const normalized = String(subject || '').trim()
    if (!normalized) return 'Re: Anna at Alldone'
    return /^re:/i.test(normalized) ? normalized : `Re: ${normalized}`
}

function verifyIncomingRequestAuth(req, payload, env) {
    const emulator = !!process.env.FUNCTIONS_EMULATOR
    if (emulator) return { valid: true, reason: 'emulator' }

    const authHeader = String(req.headers?.authorization || '').trim()
    const bearerToken = String(env.ANNA_EMAIL_WEBHOOK_BEARER_TOKEN || '').trim()
    if (bearerToken) {
        const expected = `Bearer ${bearerToken}`
        if (!safeCompare(authHeader, expected)) {
            return { valid: false, reason: 'bearer_mismatch' }
        }
        return { valid: true, reason: 'bearer' }
    }

    const basicUser = String(env.ANNA_EMAIL_WEBHOOK_BASIC_USER || '').trim()
    const basicPassword = String(env.ANNA_EMAIL_WEBHOOK_BASIC_PASSWORD || '').trim()
    if (basicUser || basicPassword) {
        const expectedRaw = `${basicUser}:${basicPassword}`
        const expected = `Basic ${Buffer.from(expectedRaw).toString('base64')}`
        if (!safeCompare(authHeader, expected)) {
            return { valid: false, reason: 'basic_mismatch' }
        }
        return { valid: true, reason: 'basic' }
    }

    return { valid: false, reason: 'no_auth_configured' }
}

function safeCompare(actual = '', expected = '') {
    const actualBuffer = Buffer.from(String(actual || ''))
    const expectedBuffer = Buffer.from(String(expected || ''))
    if (actualBuffer.length !== expectedBuffer.length) return false
    return crypto.timingSafeEqual(actualBuffer, expectedBuffer)
}

function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value)
}

module.exports = {
    handleIncomingAnnaEmail,
    normalizeInboundEmailPayload,
    normalizeInboundAttachments,
    enqueueIncomingEmailMessage,
}
