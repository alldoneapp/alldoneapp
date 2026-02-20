const admin = require('firebase-admin')
const { v4: uuidv4 } = require('uuid')

const TwilioWhatsAppService = require('../Services/TwilioWhatsAppService')
const { getOrCreateWhatsAppDailyTopic, storeUserMessageInTopic } = require('./whatsAppDailyTopic')
const { processWhatsAppAssistantMessage } = require('./whatsAppAssistantBridge')

const QUEUE_STATUS_PENDING = 'pending'
const QUEUE_STATUS_PROCESSING = 'processing'
const QUEUE_STATUS_FAILED = 'failed'
const LOCK_TTL_MS = 2 * 60 * 1000
const MERGE_WINDOW_MS = 3000
const MAX_MERGED_MESSAGES = 5
const MAX_LOOP_ITERATIONS = 20

async function processWhatsAppInboundQueueItem(event) {
    const userId = event?.params?.userId
    if (!userId) {
        console.warn('WhatsApp Queue: Missing userId in trigger params')
        return
    }

    const ownerId = uuidv4()
    const acquired = await tryAcquireUserQueueLock(userId, ownerId)
    if (!acquired) {
        console.log('WhatsApp Queue: Lock already held, skipping duplicate trigger', { userId })
        return
    }

    try {
        for (let i = 0; i < MAX_LOOP_ITERATIONS; i++) {
            await refreshUserQueueLock(userId, ownerId)
            const batch = await claimNextBatchForUser(userId, ownerId)
            if (batch.length === 0) break
            await processBatchForUser(userId, batch)
        }
    } finally {
        await releaseUserQueueLock(userId, ownerId)
    }
}

async function processBatchForUser(userId, batch) {
    const sortedBatch = [...batch].sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0))
    const first = sortedBatch[0]
    const fromNumber = first.fromNumber || ''
    const projectId = first.projectId
    const assistantId = first.assistantId

    try {
        const { chatId } = await getOrCreateWhatsAppDailyTopic(userId, projectId, assistantId)

        for (const item of sortedBatch) {
            const textToStore = item.isVoice ? item.messageText : item.storedMessageText || item.messageText || ''
            await storeUserMessageInTopic(projectId, chatId, userId, textToStore, !!item.isVoice, {
                imageCount: Number(item.processedImageCount) || 0,
            })
        }

        const mergedMessageText = sortedBatch
            .map(item => String(item.messageText || '').trim())
            .filter(Boolean)
            .join('\n\n')

        const aiResponse = await processWhatsAppAssistantMessage(
            userId,
            projectId,
            chatId,
            mergedMessageText,
            assistantId,
            null,
            { skipCurrentMessageAppend: true }
        )

        const service = new TwilioWhatsAppService()
        await service.sendWhatsAppMessage(
            fromNumber,
            aiResponse || 'Sorry, I was unable to generate a response. Please try again.'
        )

        await deleteQueueItems(sortedBatch)
        console.log('WhatsApp Queue: Batch processed successfully', {
            userId,
            batchSize: sortedBatch.length,
            projectId,
            assistantId,
        })
    } catch (error) {
        console.error('WhatsApp Queue: Batch processing failed', {
            userId,
            batchSize: sortedBatch.length,
            error: error.message,
        })
        await markQueueItemsFailed(sortedBatch, error)
        if (fromNumber) {
            try {
                const service = new TwilioWhatsAppService()
                await service.sendWhatsAppMessage(fromNumber, 'Sorry, I encountered an error. Please try again later.')
            } catch (sendError) {
                console.error('WhatsApp Queue: Failed to send fallback message', {
                    userId,
                    error: sendError.message,
                })
            }
        }
    }
}

async function claimNextBatchForUser(userId, ownerId) {
    const db = admin.firestore()
    const collectionRef = db.collection(`whatsAppInboundQueue/${userId}/items`)

    const initialPendingDocs = await fetchOldestPendingDocs(collectionRef, 50)
    if (initialPendingDocs.length === 0) return []

    const firstPendingCreatedAt = Number(initialPendingDocs[0].data()?.createdAt) || Date.now()
    const waitMs = Math.max(0, Math.min(MERGE_WINDOW_MS, firstPendingCreatedAt + MERGE_WINDOW_MS - Date.now()))
    if (waitMs > 0) {
        await delay(waitMs)
    }

    const mergePendingDocs = await fetchOldestPendingDocs(collectionRef, 50)
    if (mergePendingDocs.length === 0) return []

    const firstPending = mergePendingDocs[0]
    const firstData = firstPending.data() || {}
    const mergeStartCreatedAt = Number(firstData.createdAt) || Date.now()
    const mergeUntil = mergeStartCreatedAt + MERGE_WINDOW_MS
    const candidates = mergePendingDocs
        .filter(doc => {
            const data = doc.data() || {}
            const createdAt = Number(data.createdAt) || 0
            if (createdAt > mergeUntil) return false
            return data.projectId === firstData.projectId && data.assistantId === firstData.assistantId
        })
        .slice(0, MAX_MERGED_MESSAGES)

    if (candidates.length === 0) return []

    const now = Date.now()
    return await db.runTransaction(async transaction => {
        const claimed = []

        for (const candidate of candidates) {
            const freshDoc = await transaction.get(candidate.ref)
            if (!freshDoc.exists) continue
            const freshData = freshDoc.data() || {}
            if (freshData.status !== QUEUE_STATUS_PENDING) continue

            transaction.update(candidate.ref, {
                status: QUEUE_STATUS_PROCESSING,
                processorId: ownerId,
                processingStartedAt: now,
                updatedAt: now,
                attempts: admin.firestore.FieldValue.increment(1),
            })

            claimed.push({
                id: freshDoc.id,
                ref: candidate.ref,
                ...freshData,
            })
        }

        return claimed
    })
}

async function tryAcquireUserQueueLock(userId, ownerId) {
    const db = admin.firestore()
    const lockRef = db.doc(`whatsAppInboundLocks/${userId}`)
    const now = Date.now()

    return await db.runTransaction(async transaction => {
        const doc = await transaction.get(lockRef)
        const data = doc.exists ? doc.data() || {} : {}
        const expiresAt = Number(data.expiresAt) || 0
        const lockedBy = data.ownerId || null
        const lockExpired = expiresAt <= now
        const canAcquire = !doc.exists || lockExpired || lockedBy === ownerId

        if (!canAcquire) {
            return false
        }

        transaction.set(lockRef, {
            ownerId,
            acquiredAt: data.acquiredAt || now,
            updatedAt: now,
            expiresAt: now + LOCK_TTL_MS,
        })
        return true
    })
}

async function refreshUserQueueLock(userId, ownerId) {
    const db = admin.firestore()
    const lockRef = db.doc(`whatsAppInboundLocks/${userId}`)
    const now = Date.now()

    await db.runTransaction(async transaction => {
        const doc = await transaction.get(lockRef)
        if (!doc.exists) throw new Error(`Queue lock missing for user ${userId}`)
        const data = doc.data() || {}
        if (data.ownerId !== ownerId) {
            throw new Error(`Queue lock ownership changed for user ${userId}`)
        }
        transaction.update(lockRef, {
            updatedAt: now,
            expiresAt: now + LOCK_TTL_MS,
        })
    })
}

async function releaseUserQueueLock(userId, ownerId) {
    const db = admin.firestore()
    const lockRef = db.doc(`whatsAppInboundLocks/${userId}`)
    await db.runTransaction(async transaction => {
        const doc = await transaction.get(lockRef)
        if (!doc.exists) return
        const data = doc.data() || {}
        if (data.ownerId === ownerId) {
            transaction.delete(lockRef)
        }
    })
}

async function deleteQueueItems(items) {
    if (!Array.isArray(items) || items.length === 0) return
    const db = admin.firestore()
    const batch = db.batch()
    items.forEach(item => batch.delete(item.ref))
    await batch.commit()
}

async function markQueueItemsFailed(items, error) {
    if (!Array.isArray(items) || items.length === 0) return
    const db = admin.firestore()
    const batch = db.batch()
    const now = Date.now()
    const errorMessage = error?.message || 'Unknown WhatsApp queue processing error'
    items.forEach(item => {
        batch.update(item.ref, {
            status: QUEUE_STATUS_FAILED,
            lastError: errorMessage,
            updatedAt: now,
        })
    })
    await batch.commit()
}

async function fetchOldestPendingDocs(collectionRef, limit) {
    try {
        const snapshot = await collectionRef
            .where('status', '==', QUEUE_STATUS_PENDING)
            .orderBy('createdAt', 'asc')
            .limit(limit)
            .get()
        return snapshot.docs
    } catch (error) {
        const errorCode = String(error?.code || '')
        const errorMessage = String(error?.message || '')
        const missingCompositeIndex =
            errorCode === 'failed-precondition' || errorCode === '9' || /requires an index/i.test(errorMessage)
        if (!missingCompositeIndex) {
            throw error
        }

        console.warn('WhatsApp Queue: Missing index for pending query, using fallback scan', {
            errorCode,
            errorMessage,
        })

        const fallbackSnapshot = await collectionRef
            .orderBy('createdAt', 'asc')
            .limit(limit * 4)
            .get()
        return fallbackSnapshot.docs.filter(doc => (doc.data() || {}).status === QUEUE_STATUS_PENDING).slice(0, limit)
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = {
    processWhatsAppInboundQueueItem,
}
