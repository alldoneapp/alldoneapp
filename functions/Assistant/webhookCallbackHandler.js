const admin = require('firebase-admin')
const crypto = require('crypto')

/**
 * Process incoming webhook callbacks from external services
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function processWebhookCallback(req, res) {
    console.log('🌐 WEBHOOK CALLBACK: Received webhook callback')

    try {
        // Validate request method
        if (req.method !== 'POST') {
            console.error('🌐 WEBHOOK CALLBACK: Invalid method:', req.method)
            return res.status(405).json({
                error: 'Method not allowed',
                message: 'Only POST requests are accepted',
            })
        }

        // Extract callback data
        const { correlationId, resultUrl, status, error, metadata } = req.body

        console.log('🌐 WEBHOOK CALLBACK: Callback data:', {
            correlationId,
            resultUrl: resultUrl?.substring(0, 100),
            status,
            hasError: !!error,
            hasMetadata: !!metadata,
        })

        // Validate required fields
        if (!correlationId) {
            console.error('🌐 WEBHOOK CALLBACK: Missing correlationId')
            return res.status(400).json({
                error: 'Bad request',
                message: 'correlationId is required',
            })
        }

        // Retrieve pending webhook state
        const pendingWebhookRef = admin.firestore().doc(`pendingWebhooks/${correlationId}`)
        const pendingWebhookDoc = await pendingWebhookRef.get()

        if (!pendingWebhookDoc.exists) {
            console.error('🌐 WEBHOOK CALLBACK: Pending webhook not found:', { correlationId })
            return res.status(404).json({
                error: 'Not found',
                message: `No pending webhook found for correlationId: ${correlationId}`,
            })
        }

        const pendingWebhook = pendingWebhookDoc.data()
        console.log('🌐 WEBHOOK CALLBACK: Found pending webhook:', {
            correlationId,
            status: pendingWebhook.status,
            projectId: pendingWebhook.projectId,
            objectId: pendingWebhook.objectId,
        })

        // Check if already processed
        if (pendingWebhook.status === 'completed' || pendingWebhook.status === 'failed') {
            console.warn('🌐 WEBHOOK CALLBACK: Webhook already processed:', {
                correlationId,
                currentStatus: pendingWebhook.status,
            })
            return res.status(200).json({
                success: true,
                message: 'Webhook already processed',
                status: pendingWebhook.status,
            })
        }

        // Check if expired
        if (pendingWebhook.expiresAt && Date.now() > pendingWebhook.expiresAt) {
            console.error('🌐 WEBHOOK CALLBACK: Webhook expired:', {
                correlationId,
                expiresAt: pendingWebhook.expiresAt,
                now: Date.now(),
            })
            await pendingWebhookRef.update({
                status: 'expired',
                expiredAt: admin.firestore.FieldValue.serverTimestamp(),
            })
            return res.status(410).json({
                error: 'Gone',
                message: 'Webhook request has expired',
            })
        }

        // Validate webhook signature if provided (optional for now)
        // TODO: Implement signature validation for production use
        // validateWebhookSignature(req, pendingWebhook.webhookSecret)

        const { projectId, objectId, assistantId, userIdsToNotify, isPublicFor } = pendingWebhook

        // Handle error status from external service
        if (status === 'error' || error) {
            console.error('🌐 WEBHOOK CALLBACK: External service reported error:', {
                correlationId,
                error,
                status,
            })

            // Update webhook status to failed
            await pendingWebhookRef.update({
                status: 'failed',
                error: error || 'Unknown error from external service',
                failedAt: admin.firestore.FieldValue.serverTimestamp(),
                callbackData: { status, error, metadata },
            })

            // Store error message as a comment
            const errorCommentId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 10)
            await admin
                .firestore()
                .doc(`chatComments/${projectId}/tasks/${objectId}/comments/${errorCommentId}`)
                .set({
                    creatorId: assistantId,
                    commentText: `❌ Webhook task failed: ${error || 'External service error'}`,
                    commentType: 'STAYWARD_COMMENT',
                    lastChangeDate: Date.now(),
                    created: Date.now(),
                    originalContent: `❌ Webhook task failed: ${error || 'External service error'}`,
                })

            // Update chat object with error comment
            await updateChatObjectWithComment(
                projectId,
                objectId,
                assistantId,
                `❌ Webhook task failed: ${error || 'External service error'}`,
                'STAYWARD_COMMENT'
            )

            return res.status(200).json({
                success: false,
                message: 'Webhook task failed',
                error: error || 'External service error',
            })
        }

        // Validate result URL
        if (!resultUrl) {
            console.error('🌐 WEBHOOK CALLBACK: Missing resultUrl in success callback')
            return res.status(400).json({
                error: 'Bad request',
                message: 'resultUrl is required for successful webhook callbacks',
            })
        }

        console.log('🌐 WEBHOOK CALLBACK: Processing successful webhook result:', {
            correlationId,
            resultUrl: resultUrl.substring(0, 100),
        })

        // Store result as a comment
        const commentText = formatWebhookResult(resultUrl, metadata)
        const commentId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 10)

        await admin
            .firestore()
            .doc(`chatComments/${projectId}/tasks/${objectId}/comments/${commentId}`)
            .set({
                creatorId: assistantId,
                commentText,
                commentType: 'STAYWARD_COMMENT',
                lastChangeDate: Date.now(),
                created: Date.now(),
                originalContent: commentText,
                webhookData: {
                    resultUrl,
                    correlationId,
                    metadata: metadata || {},
                },
            })

        // Update chat object with result comment
        await updateChatObjectWithComment(projectId, objectId, assistantId, commentText, 'STAYWARD_COMMENT')

        // Update webhook status to completed
        await pendingWebhookRef.update({
            status: 'completed',
            resultUrl,
            metadata: metadata || {},
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
            callbackData: { status, resultUrl, metadata },
        })

        console.log('🌐 WEBHOOK CALLBACK: Successfully processed webhook callback:', {
            correlationId,
            resultUrl: resultUrl.substring(0, 100),
        })

        // Return success response
        res.status(200).json({
            success: true,
            message: 'Webhook result processed successfully',
            correlationId,
        })
    } catch (error) {
        console.error('🌐 WEBHOOK CALLBACK: Error processing webhook callback:', {
            error: error.message,
            stack: error.stack,
        })
        res.status(500).json({
            error: 'Internal server error',
            message: error.message,
        })
    }
}

/**
 * Format the webhook result as a user-friendly comment
 * @param {string} resultUrl - URL returned by the webhook
 * @param {Object} metadata - Optional metadata from webhook
 * @returns {string} Formatted comment text
 */
function formatWebhookResult(resultUrl, metadata) {
    let comment = `✅ Webhook task completed!\n\n🔗 Result: ${resultUrl}`

    if (metadata) {
        if (metadata.title) {
            comment += `\n📝 Title: ${metadata.title}`
        }
        if (metadata.description) {
            comment += `\n📄 Description: ${metadata.description}`
        }
        if (metadata.duration) {
            comment += `\n⏱️ Duration: ${metadata.duration}`
        }
        if (metadata.fileSize) {
            comment += `\n📦 Size: ${metadata.fileSize}`
        }
    }

    return comment
}

/**
 * Update the chat object with the new comment information
 * @param {string} projectId - Project ID
 * @param {string} objectId - Chat/Task object ID
 * @param {string} assistantId - Assistant ID (creator of the comment)
 * @param {string} commentText - Comment text
 * @param {string} commentType - Type of comment
 */
async function updateChatObjectWithComment(projectId, objectId, assistantId, commentText, commentType) {
    try {
        const chatRef = admin.firestore().doc(`chatObjects/${projectId}/chats/${objectId}`)
        const chatDoc = await chatRef.get()

        if (chatDoc.exists) {
            const currentCommentsData = chatDoc.data().commentsData || { amount: 0 }
            await chatRef.update({
                commentsData: {
                    lastCommentOwnerId: assistantId,
                    lastComment: commentText.substring(0, 100),
                    lastCommentType: commentType,
                    amount: (currentCommentsData.amount || 0) + 1,
                },
                lastEditionDate: Date.now(),
                lastEditorId: assistantId,
            })
            console.log('🌐 WEBHOOK CALLBACK: Updated chat object with comment')
        } else {
            console.warn('🌐 WEBHOOK CALLBACK: Chat object not found:', { projectId, objectId })
        }
    } catch (error) {
        console.error('🌐 WEBHOOK CALLBACK: Error updating chat object:', {
            error: error.message,
            projectId,
            objectId,
        })
        // Don't throw - this is not critical
    }
}

/**
 * Validate webhook signature (placeholder for future implementation)
 * @param {Object} req - Express request object
 * @param {string} webhookSecret - Secret key for validating webhook
 */
function validateWebhookSignature(req, webhookSecret) {
    // TODO: Implement signature validation
    // Example: HMAC SHA256 signature validation
    // const signature = req.headers['x-webhook-signature']
    // const body = JSON.stringify(req.body)
    // const expectedSignature = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex')
    // if (signature !== expectedSignature) {
    //     throw new Error('Invalid webhook signature')
    // }
    console.log('🌐 WEBHOOK CALLBACK: Signature validation not yet implemented')
}

/**
 * Clean up expired webhook tasks
 * This function runs periodically to find and mark expired webhooks as failed
 */
async function cleanupExpiredWebhooks() {
    console.log('🧹 WEBHOOK CLEANUP: Starting cleanup of expired webhooks')

    try {
        const now = Date.now()

        // Query for pending or initiated webhooks that have expired
        const expiredWebhooksSnapshot = await admin
            .firestore()
            .collection('pendingWebhooks')
            .where('status', 'in', ['pending', 'initiated'])
            .where('expiresAt', '<=', now)
            .get()

        console.log('🧹 WEBHOOK CLEANUP: Found expired webhooks:', {
            count: expiredWebhooksSnapshot.size,
        })

        if (expiredWebhooksSnapshot.empty) {
            console.log('🧹 WEBHOOK CLEANUP: No expired webhooks found')
            return
        }

        // Process each expired webhook
        const batch = admin.firestore().batch()
        let processedCount = 0

        for (const doc of expiredWebhooksSnapshot.docs) {
            const webhook = doc.data()
            const { correlationId, projectId, objectId, assistantId } = webhook

            console.log('🧹 WEBHOOK CLEANUP: Processing expired webhook:', {
                correlationId,
                expiresAt: webhook.expiresAt,
                now,
            })

            // Update webhook status to expired
            batch.update(doc.ref, {
                status: 'expired',
                expiredAt: admin.firestore.FieldValue.serverTimestamp(),
                cleanedUpAt: admin.firestore.FieldValue.serverTimestamp(),
            })

            // Create error comment for the task
            const errorCommentId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 10)
            const commentRef = admin
                .firestore()
                .doc(`chatComments/${projectId}/tasks/${objectId}/comments/${errorCommentId}`)

            batch.set(commentRef, {
                creatorId: assistantId,
                commentText: '⏱️ Webhook task timed out: No response received within the expected timeframe',
                commentType: 'STAYWARD_COMMENT',
                lastChangeDate: Date.now(),
                created: Date.now(),
                originalContent: '⏱️ Webhook task timed out: No response received within the expected timeframe',
            })

            processedCount++
        }

        // Commit all updates
        await batch.commit()

        console.log('🧹 WEBHOOK CLEANUP: Cleanup completed:', {
            processedCount,
            totalFound: expiredWebhooksSnapshot.size,
        })
    } catch (error) {
        console.error('🧹 WEBHOOK CLEANUP: Error during cleanup:', {
            error: error.message,
            stack: error.stack,
        })
    }
}

module.exports = {
    processWebhookCallback,
    formatWebhookResult,
    validateWebhookSignature,
    cleanupExpiredWebhooks,
}
