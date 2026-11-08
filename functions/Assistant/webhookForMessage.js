const admin = require('firebase-admin')
const crypto = require('crypto')
const { createInitialStatusMessage } = require('./assistantStatusHelper')
const { Timestamp } = require('firebase-admin/firestore')

const { assertPublicWebhookUrl } = require('./webhookDestination')

const WEBHOOK_TASK_KIND = 'webhook_task'

function hashCallbackSecret(secret) {
    return crypto.createHash('sha256').update(String(secret)).digest('hex')
}

/**
 * Who may see the webhook's answer: current project members the task is visible to.
 * The client proposes the list (it applies each member's notification settings); the server
 * only ever narrows it.
 */
function resolveWebhookRecipients(requested, { memberIds, isPublicFor, callerId }) {
    const members = new Set(memberIds)
    const audience = Array.isArray(isPublicFor) ? isPublicFor : []
    const visibleToAll = audience.includes(0) || audience.includes('0')
    const list = Array.isArray(requested) ? requested : []
    return [
        ...new Set(
            list.filter(
                id =>
                    typeof id === 'string' &&
                    id !== callerId &&
                    members.has(id) &&
                    (visibleToAll || audience.includes(id))
            )
        ),
    ]
}

/**
 * Execute webhook when user sends a message in a webhook task.
 *
 * Only the caller identity (from request.auth), the thread and the prompt come from the request;
 * the webhook URL, its credentials and parameters, the answering assistant and the audience are
 * read from the stored task, because a request may come from anyone with a Firebase account
 * (security audit 2026-11: this callable used to trust all of them from the request body).
 *
 * @param {Object} input - { userId (authenticated caller), projectId, objectId, prompt, userIdsToNotify }
 * @returns {Promise<Object>} Result object
 */
async function executeWebhookForUserMessage(input, deps = {}) {
    const db = deps.db || admin.firestore()
    const fetchImpl = deps.fetchImpl || fetch
    const createStatus = deps.createStatus || createInitialStatusMessage
    const { userId, projectId, objectId, prompt } = input

    const [taskDoc, projectDoc] = await Promise.all([
        db.doc(`items/${projectId}/tasks/${objectId}`).get(),
        db.doc(`projects/${projectId}`).get(),
    ])
    const task = taskDoc.exists ? taskDoc.data() || {} : null
    const taskMetadata = task?.taskMetadata || {}
    if (!task || !taskMetadata.isWebhookTask || !taskMetadata.webhookUrl) {
        throw new Error('This task is not a webhook task')
    }

    const assistantId = task.assistantId || null
    const isPublicFor = Array.isArray(task.isPublicFor) ? task.isPublicFor : []
    const memberIds = projectDoc.exists && Array.isArray(projectDoc.data()?.userIds) ? projectDoc.data().userIds : []
    const userIdsToNotify = resolveWebhookRecipients(input.userIdsToNotify, {
        memberIds,
        isPublicFor,
        callerId: userId,
    })

    console.log('🌐 WEBHOOK MESSAGE: Executing webhook for user message:', {
        userId,
        projectId,
        objectId,
        promptLength: prompt?.length,
    })

    let webhookUrl
    try {
        webhookUrl = await assertPublicWebhookUrl(taskMetadata.webhookUrl, { lookup: deps.lookup })
    } catch (error) {
        console.warn('🌐 WEBHOOK MESSAGE: Refused webhook destination:', { projectId, objectId, reason: error.message })
        throw new Error(`Webhook URL refused: ${error.message}`)
    }

    // Get follower IDs - include the user who sent the message
    const followerIds = [userId]

    // Create initial status message from the assistant ... i should see thinking
    await createStatus(
        projectId,
        'tasks',
        objectId,
        assistantId,
        'Thinking...',
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

    // The callback endpoint is public; this per-request secret is what proves a callback comes
    // from the webhook we called. It travels inside callbackUrl, so integrations that simply POST
    // to the callbackUrl they were given keep working; only its hash is stored.
    const callbackSecret = crypto.randomBytes(32).toString('hex')
    const callbackUrl = `${getCallbackUrl()}?token=${callbackSecret}`

    // Store pending webhook state in Firestore
    const pendingWebhookRef = db.doc(`pendingWebhooks/${correlationId}`)
    await pendingWebhookRef.set({
        kind: WEBHOOK_TASK_KIND,
        callbackSecretHash: hashCallbackSecret(callbackSecret),
        correlationId,
        userId,
        projectId,
        objectId,
        assistantId,
        userIdsToNotify,
        isPublicFor,
        prompt,
        webhookUrl,
        status: 'pending',
        createdAt: Date.now(),
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes timeout
    })

    console.log('🌐 WEBHOOK MESSAGE: Stored pending webhook state:', { correlationId })

    // Prepare webhook payload
    const webhookPayload = {
        correlationId,
        callbackUrl,
        callbackSecret,
        prompt: prompt || '', // User's message as the prompt
        taskId: objectId,
        userId,
        projectId,
        // Include any custom parameters from taskMetadata
        ...(taskMetadata.webhookParams || {}),
    }

    try {
        // Call the external webhook
        // callbackUrl carries the callback secret, so it is never logged.
        console.log('🌐 WEBHOOK MESSAGE: Calling external webhook:', { correlationId })

        const response = await fetchImpl(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Include authorization if provided
                ...(taskMetadata.webhookAuth
                    ? { [taskMetadata.webhookAuthHeaderName || 'Authorization']: taskMetadata.webhookAuth }
                    : {}),
            },
            body: JSON.stringify(webhookPayload),
            // Set a reasonable timeout for the initial request (not the callback)
            signal: AbortSignal.timeout(30000), // 30 seconds
            // A redirect would skip the destination check above.
            redirect: 'error',
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
            initiatedAt: Date.now(),
        })

        // Return success - the actual result will come via callback. The correlationId is not
        // returned: together with the public callback it was enough to post into the thread.
        return {
            success: true,
            status: 'webhook_initiated',
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
        })

        // Update status to 'failed'
        await pendingWebhookRef.update({
            status: 'failed',
            error: error.message,
            failedAt: Date.now(),
        })

        // Store error message as a comment
        const commentId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 10)
        await db.doc(`chatComments/${projectId}/tasks/${objectId}/comments/${commentId}`).set({
            creatorId: assistantId,
            commentText: `❌ Webhook failed: ${error.message}`,
            commentType: 'STAYWARD_COMMENT',
            lastChangeDate: Timestamp.now(),
            created: Date.now(),
            originalContent: `❌ Webhook failed: ${error.message}`,
            fromAssistant: true,
        })

        throw error
    }
}

module.exports = {
    executeWebhookForUserMessage,
    hashCallbackSecret,
    resolveWebhookRecipients,
    WEBHOOK_TASK_KIND,
}
