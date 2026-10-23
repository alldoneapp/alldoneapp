const admin = require('firebase-admin')
const { v4: uuidv4 } = require('uuid')

const TwilioWhatsAppService = require('../Services/TwilioWhatsAppService')
const { getOrCreateWhatsAppDailyTopic, storeUserMessageInTopic } = require('./whatsAppDailyTopic')
const { processWhatsAppAssistantMessage } = require('./whatsAppAssistantBridge')
const { FieldValue } = require('firebase-admin/firestore')
const {
    WHATSAPP_PROMPT_MAX_RUN_WALL_CLOCK_MS,
    WHATSAPP_FUNCTION_TIMEOUT_SECONDS,
} = require('../Assistant/assistantRunLimits')
const { createWhatsAppRunGuard, WHATSAPP_TIMEOUT_CODE, getWhatsAppTimeoutMessage } = require('./whatsAppRunGuard')

const QUEUE_STATUS_PENDING = 'pending'
const QUEUE_STATUS_PROCESSING = 'processing'
const QUEUE_STATUS_FAILED = 'failed'
const LOCK_TTL_MS = 2 * 60 * 1000
const LOCK_HEARTBEAT_INTERVAL_MS = 30 * 1000
const MERGE_WINDOW_MS = 3000
const MAX_MERGED_MESSAGES = 5
const MAX_LOOP_ITERATIONS = 20
const ASSISTANT_TRANSIENT_RETRY_DELAYS_MS = [1000, 5000]
// Only recover work older than the entire transport plus a grace period, under the user lock.
// Its tools may have completed before the worker died, so recovery reports failure instead of
// replaying actions whose outcome is unknown.
const STALLED_PROCESSING_TIMEOUT_MS = (WHATSAPP_FUNCTION_TIMEOUT_SECONDS + 120) * 1000

async function processWhatsAppInboundQueueItem(event, options = {}) {
    const processorStart = Date.now()
    const deadlineAt = options.deadlineAt || processorStart + WHATSAPP_PROMPT_MAX_RUN_WALL_CLOCK_MS
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
        await runWithUserQueueLockHeartbeat(userId, ownerId, markStage, () =>
            recoverStalledProcessingItems(userId, ownerId, deadlineAt)
        )
        for (let i = 0; i < MAX_LOOP_ITERATIONS; i++) {
            // Leave fresh work for its trigger or the recovery schedule when this worker's budget
            // is nearly spent. The deadline is shared by every batch and transient retry.
            if (Date.now() + 10000 >= deadlineAt) break
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
            await runWithUserQueueLockHeartbeat(userId, ownerId, markStage, () =>
                processBatchForUser(userId, batch, { deadlineAt })
            )
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

async function processBatchForUser(userId, batch, options = {}) {
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
    const runGuard = createWhatsAppRunGuard(options.deadlineAt)

    try {
        const { chatId, aiResponse } = await runGuard.run(async () => {
            const topicStart = Date.now()
            const { chatId } = await getOrCreateWhatsAppDailyTopic(userId, projectId, assistantId)
            runGuard.assertActive()
            markBatchStage('getOrCreateWhatsAppDailyTopic', topicStart, { chatId })

            const storeUserMessagesStart = Date.now()
            let triggeringMessageId = ''
            for (const item of sortedBatch) {
                runGuard.assertActive()
                const textToStore = item.isVoice ? item.messageText : item.storedMessageText || item.messageText || ''
                const processedMedia = Array.isArray(item.processedMedia) ? item.processedMedia : []
                triggeringMessageId = await storeUserMessageInTopic(
                    projectId,
                    chatId,
                    userId,
                    textToStore,
                    !!item.isVoice,
                    {
                        imageCount: Number(item.processedImageCount) || 0,
                        mediaCount: processedMedia.length,
                        mediaKinds: [...new Set(processedMedia.map(media => media.kind).filter(Boolean))],
                        fileUnderstandingSummary: buildFileUnderstandingSummary(processedMedia),
                        processedMedia,
                        replyContext: item.replyContext || null,
                    }
                )
            }
            markBatchStage('storeUserMessagesInTopic', storeUserMessagesStart, {
                triggeringMessageId: triggeringMessageId || null,
            })

            const mergedMessageText = sortedBatch
                .map(item => String(item.messageText || '').trim())
                .filter(Boolean)
                .join('\n\n')

            const aiStart = Date.now()
            const aiResponse = await processWhatsAppAssistantMessageWithRetry(
                userId,
                projectId,
                chatId,
                mergedMessageText,
                assistantId,
                triggeringMessageId,
                {
                    userId,
                    projectId,
                    assistantId,
                    chatId,
                    messageSids,
                    whatsappFromNumber: fromNumber,
                    runGuard,
                }
            )
            markBatchStage('processWhatsAppAssistantMessage', aiStart, {
                aiResponseLength: (aiResponse || '').length,
            })
            runGuard.assertActive()
            return { chatId, aiResponse }
        })

        const mediaOutcomeNotice = buildMediaOutcomeNotice(sortedBatch)
        const finalResponse = [
            aiResponse || 'Sorry, I was unable to generate a response. Please try again.',
            mediaOutcomeNotice,
        ]
            .filter(Boolean)
            .join('\n\n')

        const service = new TwilioWhatsAppService()
        const sendStart = Date.now()
        await service.sendWhatsAppMessage(fromNumber, finalResponse, {
            projectId,
            objectId: chatId,
            objectType: 'topics',
        })
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
            projectId,
            messageSids,
            toolStarted: runGuard.toolStarted,
            batchSize: sortedBatch.length,
            error: error.message,
            code: error.code || null,
        })
        await markQueueItemsFailed(sortedBatch, error)
        if (fromNumber) {
            try {
                const service = new TwilioWhatsAppService()
                await service.sendWhatsAppMessage(
                    fromNumber,
                    error.code === WHATSAPP_TIMEOUT_CODE
                        ? getWhatsAppTimeoutMessage(first.language)
                        : 'Sorry, I encountered an error. Please try again later.'
                )
            } catch (sendError) {
                console.error('WhatsApp Queue: Failed to send fallback message', {
                    userId,
                    error: sendError.message,
                })
            }
        }
    }
}

async function runWithUserQueueLockHeartbeat(userId, ownerId, markStage, operation) {
    let stopped = false
    let refreshInFlight = false
    let lastHeartbeatError = null

    const heartbeat = async () => {
        if (stopped || refreshInFlight) return
        refreshInFlight = true
        const refreshStart = Date.now()
        try {
            await refreshUserQueueLock(userId, ownerId)
            markStage('refreshUserQueueLockHeartbeat', refreshStart)
        } catch (error) {
            lastHeartbeatError = error
            console.error('WhatsApp Queue: Failed to refresh queue lock heartbeat', {
                userId,
                ownerId,
                error: error.message,
            })
        } finally {
            refreshInFlight = false
        }
    }

    const interval = setInterval(heartbeat, LOCK_HEARTBEAT_INTERVAL_MS)
    if (typeof interval.unref === 'function') interval.unref()

    try {
        const result = await operation()
        if (lastHeartbeatError) {
            console.warn('WhatsApp Queue: Batch completed after queue lock heartbeat error', {
                userId,
                ownerId,
                error: lastHeartbeatError.message,
            })
        }
        return result
    } finally {
        stopped = true
        clearInterval(interval)
    }
}

async function processWhatsAppAssistantMessageWithRetry(
    userId,
    projectId,
    chatId,
    mergedMessageText,
    assistantId,
    triggeringMessageId,
    logContext = {}
) {
    let attempt = 0

    while (true) {
        try {
            logContext.runGuard?.assertActive()
            return await processWhatsAppAssistantMessage(
                userId,
                projectId,
                chatId,
                mergedMessageText,
                assistantId,
                null,
                {
                    skipCurrentMessageAppend: true,
                    messageId: triggeringMessageId,
                    whatsappFromNumber: logContext.whatsappFromNumber || logContext.fromNumber || '',
                    ...(logContext.runGuard ? { runGuard: logContext.runGuard } : {}),
                }
            )
        } catch (error) {
            logContext.runGuard?.assertActive()
            const retryDelayMs = ASSISTANT_TRANSIENT_RETRY_DELAYS_MS[attempt]
            if (logContext.runGuard?.toolStarted || !isTransientAssistantError(error) || retryDelayMs === undefined) {
                throw error
            }

            attempt += 1
            console.warn('WhatsApp Queue: Retrying transient assistant error', {
                ...logContext,
                attempt,
                nextAttempt: attempt + 1,
                retryDelayMs,
                error: error.message,
            })
            await delay(retryDelayMs)
        }
    }
}

function isTransientAssistantError(error) {
    if (error?.code === WHATSAPP_TIMEOUT_CODE) return false
    const message = String(error?.message || '')
    const code = String(error?.code || error?.errno || '').toLowerCase()
    const status = Number(error?.status || error?.statusCode || error?.response?.status || 0)

    if (status >= 500 && status < 600) return true
    if (['econnreset', 'etimedout', 'enotfound', 'eai_again', 'econnrefused'].includes(code)) return true

    return /(?:^|\s)(?:502|503|504)(?:\s|$)|upstream connect error|disconnect\/reset|connection termination|socket hang up|network timeout|fetch failed/i.test(
        message
    )
}

async function recoverStalledProcessingItems(userId, ownerId, deadlineAt = Infinity) {
    const db = admin.firestore()
    const cutoff = Date.now() - STALLED_PROCESSING_TIMEOUT_MS
    const snapshot = await db
        .collection(`whatsAppInboundQueue/${userId}/items`)
        .where('status', '==', QUEUE_STATUS_PROCESSING)
        .limit(50)
        .get()
    for (const doc of snapshot.docs) {
        if (Date.now() + 10000 >= deadlineAt) break
        const observed = doc.data() || {}
        if (Number(observed.processingStartedAt || observed.updatedAt) > cutoff) continue
        const recovered = await db.runTransaction(async transaction => {
            const [lock, fresh] = await transaction.getAll(db.doc(`whatsAppInboundLocks/${userId}`), doc.ref)
            const data = fresh.exists ? fresh.data() || {} : {}
            if (
                lock.data()?.ownerId !== ownerId ||
                data.status !== QUEUE_STATUS_PROCESSING ||
                Number(data.processingStartedAt || data.updatedAt) > cutoff
            )
                return null
            transaction.update(doc.ref, {
                status: QUEUE_STATUS_FAILED,
                lastError: 'WhatsApp worker stopped before completing the request',
                lastErrorCode: WHATSAPP_TIMEOUT_CODE,
                recoveredAt: Date.now(),
                updatedAt: Date.now(),
            })
            return data
        })
        if (!recovered) continue
        console.warn('WhatsApp Queue: Recovered interrupted request without replaying tools', {
            userId,
            messageSid: doc.id,
        })
        if (recovered.fromNumber) {
            try {
                await new TwilioWhatsAppService().sendWhatsAppMessage(
                    recovered.fromNumber,
                    getWhatsAppTimeoutMessage(recovered.language, true)
                )
            } catch (error) {
                console.error('WhatsApp Queue: Failed to notify interrupted request', { userId, error: error.message })
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
                attempts: FieldValue.increment(1),
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
            lastErrorCode: error?.code || null,
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

function buildFileUnderstandingSummary(processedMedia) {
    if (!Array.isArray(processedMedia) || processedMedia.length === 0) return ''

    const total = processedMedia.length
    const extracted = processedMedia.filter(media => !!media.extractedText).length
    const unsupported = processedMedia.filter(media => media.extractionStatus === 'unsupported').length
    const failed = processedMedia.filter(
        media =>
            media.extractionStatus === 'error' ||
            media.extractionStatus === 'timeout' ||
            media.extractionStatus === 'parser_unavailable'
    ).length

    return `stored=${total}, extracted=${extracted}, unsupported=${unsupported}, failed=${failed}`
}

function buildMediaOutcomeNotice(sortedBatch) {
    if (!Array.isArray(sortedBatch) || sortedBatch.length === 0) return ''

    const mediaItems = sortedBatch.flatMap(item => (Array.isArray(item.processedMedia) ? item.processedMedia : []))
    if (mediaItems.length === 0) return ''

    const total = mediaItems.length
    const extracted = mediaItems.filter(media => !!media.extractedText).length
    const unsupported = mediaItems.filter(media => media.extractionStatus === 'unsupported').length
    const failed = mediaItems.filter(
        media =>
            media.extractionStatus === 'error' ||
            media.extractionStatus === 'timeout' ||
            media.extractionStatus === 'parser_unavailable'
    ).length

    const parts = [`I stored ${total} attached file${total === 1 ? '' : 's'} in the daily WhatsApp topic.`]
    if (unsupported > 0 || failed > 0) {
        parts.push(
            `I could only partially read them (${extracted} parsed, ${unsupported} unsupported, ${failed} failed).`
        )
    } else if (extracted > 0) {
        parts.push(`I read ${extracted} file${extracted === 1 ? '' : 's'} for context.`)
    }
    return parts.join(' ')
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
    processBatchForUser,
    isTransientAssistantError,
    processWhatsAppAssistantMessageWithRetry,
    buildFileUnderstandingSummary,
    buildMediaOutcomeNotice,
    recoverStalledProcessingItems,
    STALLED_PROCESSING_TIMEOUT_MS,
}
