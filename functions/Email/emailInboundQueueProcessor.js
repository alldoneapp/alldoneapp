'use strict'

const admin = require('firebase-admin')
const { v4: uuidv4 } = require('uuid')

const { extractTextFromWhatsAppFile } = require('../WhatsApp/whatsAppFileExtraction')
const { sendAnnaEmailReply } = require('./emailReplyService')
const { processAnnaEmailAssistantMessage } = require('./emailAssistantBridge')
const {
    getOrCreateDailyEmailTopic,
    storeEmailAssistantMessageInTopic,
    storeEmailUserMessageInTopic,
} = require('./emailDailyTopic')
const {
    DEFAULT_PUBLIC_EMAIL,
    buildEmailCommentText,
    pickActionableAttachment,
    summarizeAttachments,
} = require('./emailChannelHelpers')

const QUEUE_STATUS_PENDING = 'pending'
const QUEUE_STATUS_PROCESSING = 'processing'
const QUEUE_STATUS_FAILED = 'failed'
const LOCK_TTL_MS = 2 * 60 * 1000
const MAX_LOOP_ITERATIONS = 20

async function processAnnaEmailInboundQueueItem(event) {
    const userId = event?.params?.userId
    if (!userId) return

    const ownerId = uuidv4()
    const acquired = await tryAcquireUserQueueLock(userId, ownerId)
    if (!acquired) return

    try {
        for (let index = 0; index < MAX_LOOP_ITERATIONS; index++) {
            await refreshUserQueueLock(userId, ownerId)
            const item = await claimNextPendingEmailForUser(userId, ownerId)
            if (!item) break
            await processQueueItem(userId, item)
        }
    } finally {
        await releaseUserQueueLock(userId, ownerId)
    }
}

async function processQueueItem(userId, item) {
    const data = item.data || {}
    const projectId = data.projectId
    const assistantId = data.assistantId || null
    const messageId = data.messageId || item.id
    let chatId = null

    try {
        ;({ chatId } = await getOrCreateDailyEmailTopic(userId, projectId, assistantId))
        const hydratedAttachments = await hydrateAttachments(data.attachments)
        const messageText = buildEmailCommentText(data.subject, data.textBody, data.htmlBody)

        await storeEmailUserMessageInTopic(projectId, chatId, userId, messageText, {
            fromEmail: data.fromEmail || '',
            subject: data.subject || '',
            messageId,
            replyTo: data.threadHeaders?.replyTo || '',
            inReplyTo: data.threadHeaders?.inReplyTo || '',
            references: data.threadHeaders?.references || '',
            attachments: summarizeAttachments(hydratedAttachments),
        })

        const actionableSelection = pickActionableAttachment(hydratedAttachments)
        if (actionableSelection.status === 'multiple_supported') {
            const responseText =
                'I found more than one supported attachment in this email. Please send one invoice per email.'
            await storeEmailAssistantMessageInTopic(projectId, chatId, assistantId, responseText, userId, {
                status: 'failed_multiple_attachments',
                toEmail: data.fromEmail || '',
                subject: data.subject || '',
                messageId,
            })
            await sendReplyForQueueItem(data, responseText)
            await finalizeQueueItem(item.ref, messageId, {
                status: 'failed_multiple_attachments',
                replyStatus: 'sent',
            })
            return
        }

        const actionableAttachment = actionableSelection.attachment
        const initialPendingAttachmentPayload = actionableAttachment
            ? {
                  fileName: actionableAttachment.fileName || '',
                  fileBase64: actionableAttachment.fileBase64 || '',
                  fileMimeType: actionableAttachment.contentType || actionableAttachment.mimeType || '',
                  fileSizeBytes: Number(actionableAttachment.sizeBytes || 0) || 0,
                  source: 'email',
                  messageId,
              }
            : null

        const responseText = await processAnnaEmailAssistantMessage(
            userId,
            projectId,
            chatId,
            messageText,
            assistantId,
            {
                toEmail: data.fromEmail || '',
                subject: buildReplySubject(data.subject),
                messageId,
                initialPendingAttachmentPayload,
                skipCurrentMessageAppend: true,
            }
        )

        await sendReplyForQueueItem(data, responseText)
        await finalizeQueueItem(item.ref, messageId, {
            status: 'processed',
            replyStatus: 'sent',
            chatId,
        })
    } catch (error) {
        console.error('Email Channel: Queue item processing failed', {
            userId,
            messageId,
            error: error.message,
        })
        if (chatId) {
            try {
                await storeEmailAssistantMessageInTopic(
                    projectId,
                    chatId,
                    assistantId,
                    'I could not complete this email request right now. Please try again later.',
                    userId,
                    {
                        status: 'failed',
                        toEmail: data.fromEmail || '',
                        subject: data.subject || '',
                        messageId,
                    }
                )
            } catch (topicError) {
                console.error('Email Channel: Failed storing failure message in topic', {
                    messageId,
                    error: topicError.message,
                })
            }
        }
        await item.ref.update({
            status: QUEUE_STATUS_FAILED,
            updatedAt: Date.now(),
            error: error.message || 'Unknown processing error',
            attempts: admin.firestore.FieldValue.increment(1),
        })
        await admin
            .firestore()
            .doc(`annaEmailInboundAudit/${messageId}`)
            .set(
                {
                    status: 'failed',
                    replyStatus: 'not_sent',
                    error: error.message || 'Unknown processing error',
                    updatedAt: Date.now(),
                },
                { merge: true }
            )

        try {
            await sendReplyForQueueItem(
                data,
                'I could not complete this email request right now. Please try again later.'
            )
        } catch (_) {}
    }
}

async function hydrateAttachments(attachments = []) {
    if (!Array.isArray(attachments) || attachments.length === 0) return []

    const bucket = admin.storage().bucket()
    const hydrated = []

    for (const attachment of attachments) {
        const storagePath = String(attachment.storagePath || '').trim()
        let buffer = null
        if (storagePath) {
            const [downloaded] = await bucket.file(storagePath).download()
            buffer = downloaded
        }

        const extraction = buffer
            ? await extractTextFromWhatsAppFile({
                  buffer,
                  contentType: attachment.contentType || attachment.mimeType || '',
                  fileName: attachment.fileName || '',
              })
            : { extractedText: '', status: 'missing_file' }

        hydrated.push({
            fileName: attachment.fileName || '',
            contentType: attachment.contentType || attachment.mimeType || '',
            sizeBytes: Number(attachment.sizeBytes || buffer?.length || 0) || 0,
            storagePath,
            extractionStatus: extraction.status || '',
            extractedText: extraction.extractedText || '',
            fileBase64: buffer ? buffer.toString('base64') : '',
        })
    }

    return hydrated
}

async function sendReplyForQueueItem(data, replyText) {
    return sendAnnaEmailReply({
        toEmail: data.fromEmail || '',
        subject: buildReplySubject(data.subject),
        replyText,
        inReplyTo: data.threadHeaders?.inReplyTo || '',
        references: data.threadHeaders?.references || '',
        fromEmail: require('../envFunctionsHelper').getEnvFunctions().ANNA_EMAIL_PUBLIC_ADDRESS || DEFAULT_PUBLIC_EMAIL,
    })
}

function buildReplySubject(subject = '') {
    const normalized = String(subject || '').trim()
    if (!normalized) return 'Re: Anna at Alldone'
    return /^re:/i.test(normalized) ? normalized : `Re: ${normalized}`
}

async function finalizeQueueItem(queueRef, messageId, auditPatch = {}) {
    await Promise.all([
        queueRef.delete(),
        admin
            .firestore()
            .doc(`annaEmailInboundAudit/${messageId}`)
            .set(
                {
                    ...auditPatch,
                    updatedAt: Date.now(),
                },
                { merge: true }
            ),
    ])
}

async function claimNextPendingEmailForUser(userId, ownerId) {
    const collectionRef = admin.firestore().collection(`annaEmailInboundQueue/${userId}/items`)
    const snapshot = await collectionRef
        .where('status', '==', QUEUE_STATUS_PENDING)
        .orderBy('createdAt', 'asc')
        .limit(1)
        .get()

    if (snapshot.empty) return null

    const doc = snapshot.docs[0]
    await doc.ref.update({
        status: QUEUE_STATUS_PROCESSING,
        lockOwnerId: ownerId,
        updatedAt: Date.now(),
        attempts: admin.firestore.FieldValue.increment(1),
    })

    return {
        id: doc.id,
        ref: doc.ref,
        data: { ...doc.data(), messageId: doc.id },
    }
}

async function tryAcquireUserQueueLock(userId, ownerId) {
    const lockRef = admin.firestore().doc(`annaEmailQueueLocks/${userId}`)
    const now = Date.now()
    let acquired = false

    await admin.firestore().runTransaction(async transaction => {
        const doc = await transaction.get(lockRef)
        const data = doc.exists ? doc.data() || {} : {}
        const isLocked = data.ownerId && now - Number(data.updatedAt || 0) < LOCK_TTL_MS
        if (isLocked) return

        transaction.set(lockRef, {
            ownerId,
            updatedAt: now,
        })
        acquired = true
    })

    return acquired
}

async function refreshUserQueueLock(userId, ownerId) {
    await admin.firestore().doc(`annaEmailQueueLocks/${userId}`).set(
        {
            ownerId,
            updatedAt: Date.now(),
        },
        { merge: true }
    )
}

async function releaseUserQueueLock(userId, ownerId) {
    const ref = admin.firestore().doc(`annaEmailQueueLocks/${userId}`)
    const doc = await ref.get()
    if (!doc.exists) return
    if ((doc.data() || {}).ownerId !== ownerId) return
    await ref.delete()
}

module.exports = {
    processAnnaEmailInboundQueueItem,
    hydrateAttachments,
}
