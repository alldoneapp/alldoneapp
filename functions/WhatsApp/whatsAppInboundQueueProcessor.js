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
    const processorStart = Date.now()
    const userId = event?.params?.userId
    if (!userId) {
        console.warn('WhatsApp Queue: Missing userId in trigger params')
        return
    }

    const ownerId = uuidv4()
    const markStage = createStageTimer('WhatsApp Queue [TIMING]', { userId, ownerId })
    const lockAcquireStart = Date.now()
    const acquired = await tryAcquireUserQueueLock(userId, ownerId)
    markStage('tryAcquireUserQueueLock', lockAcquireStart, { acquired })
    if (!acquired) {
        console.log('WhatsApp Queue: Lock already held, skipping duplicate trigger', { userId })
        return
    }

    try {
        for (let i = 0; i < MAX_LOOP_ITERATIONS; i++) {
            const refreshStart = Date.now()
            await refreshUserQueueLock(userId, ownerId)
            markStage('refreshUserQueueLock', refreshStart, { iteration: i + 1 })

            const claimStart = Date.now()
            const batch = await claimNextBatchForUser(userId, ownerId)
            markStage('claimNextBatchForUser', claimStart, {
                iteration: i + 1,
                batchSize: batch.length,
            })
            if (batch.length === 0) break

            const processBatchStart = Date.now()
            await processBatchForUser(userId, batch)
            markStage('processBatchForUser', processBatchStart, {
                iteration: i + 1,
                batchSize: batch.length,
            })
        }
    } finally {
        const releaseStart = Date.now()
        await releaseUserQueueLock(userId, ownerId)
        markStage('releaseUserQueueLock', releaseStart)
        markStage('processorComplete', processorStart, { totalDurationMs: Date.now() - processorStart })
    }
}

async function processBatchForUser(userId, batch) {
    const batchStart = Date.now()
    const sortedBatch = [...batch].sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0))
    const first = sortedBatch[0]
    const fromNumber = first.fromNumber || ''
    const projectId = first.projectId
    const assistantId = first.assistantId
    const messageSids = sortedBatch.map(item => item.messageSid || item.id).filter(Boolean)
    const markBatchStage = createStageTimer('WhatsApp Queue Batch [TIMING]', {
        userId,
        projectId,
        assistantId,
        batchSize: sortedBatch.length,
        messageSids,
    })

    try {
        const topicStart = Date.now()
        const { chatId } = await getOrCreateWhatsAppDailyTopic(userId, projectId, assistantId)
        markBatchStage('getOrCreateWhatsAppDailyTopic', topicStart, { chatId })

        const storeUserMessagesStart = Date.now()
        for (const item of sortedBatch) {
            const textToStore = item.isVoice ? item.messageText : item.storedMessageText || item.messageText || ''
            await storeUserMessageInTopic(projectId, chatId, userId, textToStore, !!item.isVoice, {
                imageCount: Number(item.processedImageCount) || 0,
            })
        }
        markBatchStage('storeUserMessagesInTopic', storeUserMessagesStart)

        const mergedMessageText = sortedBatch
            .map(item => String(item.messageText || '').trim())
            .filter(Boolean)
            .join('\n\n')

        const aiStart = Date.now()
        const aiResponse = await processWhatsAppAssistantMessage(
            userId,
            projectId,
            chatId,
            mergedMessageText,
            assistantId,
            null,
            { skipCurrentMessageAppend: true }
        )
        markBatchStage('processWhatsAppAssistantMessage', aiStart, {
            aiResponseLength: (aiResponse || '').length,
        })

        const service = new TwilioWhatsAppService()
        const sendStart = Date.now()
        await service.sendWhatsAppMessage(
            fromNumber,
            aiResponse || 'Sorry, I was unable to generate a response. Please try again.'
        )
        markBatchStage('sendWhatsAppMessage', sendStart, { hasFromNumber: !!fromNumber })

        const deleteStart = Date.now()
        await deleteQueueItems(sortedBatch)
        markBatchStage('deleteQueueItems', deleteStart)
        markBatchStage('batchComplete', batchStart, { totalDurationMs: Date.now() - batchStart })
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
        const candidateRefs = candidates.map(candidate => candidate.ref)
        const freshDocs = candidateRefs.length > 0 ? await transaction.getAll(...candidateRefs) : []

        for (const freshDoc of freshDocs) {
            if (!freshDoc.exists) continue
            const freshData = freshDoc.data() || {}
            if (freshData.status !== QUEUE_STATUS_PENDING) continue

            transaction.update(freshDoc.ref, {
                status: QUEUE_STATUS_PROCESSING,
                processorId: ownerId,
                processingStartedAt: now,
                updatedAt: now,
                attempts: admin.firestore.FieldValue.increment(1),
            })

            claimed.push({
                id: freshDoc.id,
                ref: freshDoc.ref,
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

function createStageTimer(prefix, baseMeta = {}) {
    return (stage, stageStartMs, meta = {}) => {
        const durationMs = Date.now() - stageStartMs
        console.log(`${prefix}: ${stage}`, {
            ...baseMeta,
            ...meta,
            durationMs,
        })
    }
}

module.exports = {
    processWhatsAppInboundQueueItem,
}
