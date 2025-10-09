const admin = require('firebase-admin')
const crypto = require('crypto')
const { createInitialStatusMessage } = require('./assistantStatusHelper')

/**
 * Execute webhook when user sends a message in a webhook task
 * @param {Object} data - Request data containing userId, projectId, objectId, prompt, taskMetadata, etc.
 * @returns {Promise<Object>} Result object
 */
async function executeWebhookForUserMessage(data) {
    const { userId, projectId, objectId, prompt, taskMetadata, userIdsToNotify, isPublicFor, assistantId } = data

    console.log('🌐 WEBHOOK MESSAGE: Executing webhook for user message:', {
        userId,
        projectId,
        objectId,
        webhookUrl: taskMetadata.webhookUrl,
        promptLength: prompt?.length,
    })

    // Get follower IDs - include the user who sent the message
    const followerIds = [userId]

    // Create initial status message from the assistant
    await createInitialStatusMessage(
        projectId,
        'tasks',
        objectId,
        assistantId,
        'Processing your request...',
        userIdsToNotify,
        isPublicFor,
        followerIds
    )

    // Generate a unique correlation ID for tracking this webhook request
    const correlationId = crypto.randomUUID()

    // Determine the callback URL based on environment
    const getCallbackUrl = () => {
        if (process.env.FUNCTIONS_EMULATOR) {
            // Local emulator - use localhost
            return 'http://localhost:5001/alldonealeph/europe-west1/webhookCallbackForAssistantTasks'
        }
        const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT
        const region = 'europe-west1' // Match the region in index.js

        if (projectId === 'alldonealeph') {
            return `https://${region}-alldonealeph.cloudfunctions.net/webhookCallbackForAssistantTasks`
        }
        if (projectId === 'alldonestaging') {
            return `https://${region}-alldonestaging.cloudfunctions.net/webhookCallbackForAssistantTasks`
        }
        return `https://${region}-alldonealeph.cloudfunctions.net/webhookCallbackForAssistantTasks`
    }

    const callbackUrl = getCallbackUrl()

    // Store pending webhook state in Firestore
    const pendingWebhookRef = admin.firestore().doc(`pendingWebhooks/${correlationId}`)
    await pendingWebhookRef.set({
        correlationId,
        userId,
        projectId,
        objectId,
        assistantId,
        userIdsToNotify,
        isPublicFor,
        prompt,
        webhookUrl: taskMetadata.webhookUrl,
        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes timeout
    })

    console.log('🌐 WEBHOOK MESSAGE: Stored pending webhook state:', { correlationId })

    // Prepare webhook payload
    const webhookPayload = {
        correlationId,
        callbackUrl,
        prompt: prompt || '', // User's message as the prompt
        taskId: objectId,
        userId,
        projectId,
        // Include any custom parameters from taskMetadata
        ...(taskMetadata.webhookParams || {}),
    }

    try {
        // Call the external webhook
        console.log('🌐 WEBHOOK MESSAGE: Calling external webhook:', {
            url: taskMetadata.webhookUrl,
            correlationId,
            callbackUrl,
        })

        const response = await fetch(taskMetadata.webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Include authorization if provided
                ...(taskMetadata.webhookAuth ? { Authorization: taskMetadata.webhookAuth } : {}),
            },
            body: JSON.stringify(webhookPayload),
            // Set a reasonable timeout for the initial request (not the callback)
            signal: AbortSignal.timeout(30000), // 30 seconds
        })

        if (!response.ok) {
            throw new Error(`Webhook request failed: ${response.status} ${response.statusText}`)
        }

        const responseData = await response.json()
        console.log('🌐 WEBHOOK MESSAGE: Webhook accepted:', {
            correlationId,
            status: response.status,
            responseData,
        })

        // Update status to 'initiated'
        await pendingWebhookRef.update({
            status: 'initiated',
            webhookResponse: responseData,
            initiatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        // Return success - the actual result will come via callback
        return {
            success: true,
            status: 'webhook_initiated',
            correlationId,
            projectId,
            objectType: 'tasks',
            objectId,
            isPublicFor,
            assistantId,
            message: 'Webhook processing. Waiting for callback with result.',
        }
    } catch (error) {
        console.error('🌐 WEBHOOK MESSAGE: Error calling webhook:', {
            error: error.message,
            correlationId,
            webhookUrl: taskMetadata.webhookUrl,
        })

        // Update status to 'failed'
        await pendingWebhookRef.update({
            status: 'failed',
            error: error.message,
            failedAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        // Store error message as a comment
        const commentId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 10)
        await admin
            .firestore()
            .doc(`chatComments/${projectId}/tasks/${objectId}/comments/${commentId}`)
            .set({
                creatorId: assistantId,
                commentText: `❌ Webhook failed: ${error.message}`,
                commentType: 'STAYWARD_COMMENT',
                lastChangeDate: Date.now(),
                created: Date.now(),
                originalContent: `❌ Webhook failed: ${error.message}`,
            })

        throw error
    }
}

module.exports = {
    executeWebhookForUserMessage,
}
