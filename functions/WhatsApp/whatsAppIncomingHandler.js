const admin = require('firebase-admin')
const TwilioWhatsAppService = require('../Services/TwilioWhatsAppService')
const { getOrCreateWhatsAppDailyTopic, storeUserMessageInTopic } = require('./whatsAppDailyTopic')
const { processWhatsAppAssistantMessage } = require('./whatsAppAssistantBridge')
const { transcribeWhatsAppVoiceMessage } = require('./whatsAppVoiceTranscription')
const { getEnvFunctions } = require('../envFunctionsHelper')
const { getUserData } = require('../Users/usersFirestore')
const { getDefaultAssistantData } = require('../Firestore/assistantsFirestore')

const RATE_LIMIT_MAX_MESSAGES = 30
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour

/**
 * Handle incoming WhatsApp messages from Twilio webhook.
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleIncomingWhatsAppMessage(req, res) {
    const startTime = Date.now()

    // Only accept POST requests
    if (req.method !== 'POST') {
        console.warn('WhatsApp Incoming: Rejected non-POST request:', req.method)
        return res.status(405).send('Method Not Allowed')
    }

    try {
        const envFunctions = getEnvFunctions()

        // Validate Twilio signature
        const signature = req.headers['x-twilio-signature']
        if (!signature) {
            console.warn('WhatsApp Incoming: Missing X-Twilio-Signature header')
            return res.status(403).send('Forbidden')
        }

        const service = new TwilioWhatsAppService()
        const webhookUrl = getWebhookUrl()
        const isValid = service.validateWebhookSignature(signature, webhookUrl, req.body)

        if (!isValid) {
            console.warn('WhatsApp Incoming: Invalid Twilio signature')
            return res.status(403).send('Forbidden')
        }

        // Parse Twilio webhook body
        const {
            From: fromNumber,
            Body: body,
            NumMedia: numMediaStr,
            MediaUrl0: mediaUrl0,
            MediaContentType0: mediaContentType0,
            MessageSid: messageSid,
        } = req.body

        const numMedia = parseInt(numMediaStr || '0', 10)

        console.log('WhatsApp Incoming: Received message', {
            from: fromNumber,
            bodyLength: body?.length || 0,
            numMedia,
            mediaContentType0,
            messageSid,
        })

        // Normalize phone number (strip whatsapp: prefix)
        const cleanPhone = normalizePhoneNumber(fromNumber)

        // Look up user by phone number
        const userId = await findUserByPhone(cleanPhone)
        if (!userId) {
            console.warn('WhatsApp Incoming: No user found for phone:', cleanPhone)
            // Send a friendly error message back
            await service.sendWhatsAppMessage(
                fromNumber,
                'Sorry, I could not find an Alldone account linked to this number. ' +
                    'Please add your WhatsApp number in the Alldone app settings.'
            )
            return res.status(200).send('OK')
        }

        // Check rate limit
        const rateLimited = await checkRateLimit(userId)
        if (rateLimited) {
            console.warn('WhatsApp Incoming: Rate limited user:', userId)
            await service.sendWhatsAppMessage(
                fromNumber,
                'You have sent too many messages. Please try again in a while.'
            )
            return res.status(200).send('OK')
        }

        // Determine message text
        let messageText = ''
        let isVoice = false

        if (numMedia > 0 && mediaContentType0 && mediaContentType0.startsWith('audio/')) {
            // Voice message - transcribe
            console.log('WhatsApp Incoming: Processing voice message', { mediaContentType0 })
            try {
                const { text, duration } = await transcribeWhatsAppVoiceMessage(
                    mediaUrl0,
                    envFunctions.TWILIO_ACCOUNT_SID,
                    envFunctions.TWILIO_AUTH_TOKEN
                )
                messageText = text
                isVoice = true

                // Calculate gold cost: 1 Gold per 10 seconds (min 1 Gold)
                const voiceCost = Math.max(1, Math.ceil(duration / 10))

                console.log('WhatsApp Incoming: Deducting gold for voice', { duration, cost: voiceCost })

                // Deduct gold
                await admin
                    .firestore()
                    .doc(`users/${userId}`)
                    .update({
                        gold: admin.firestore.FieldValue.increment(-voiceCost),
                    })
            } catch (error) {
                console.error('WhatsApp Incoming: Voice transcription failed:', error.message)
                await service.sendWhatsAppMessage(
                    fromNumber,
                    'Sorry, I could not understand your voice message. Please try again or send a text message.'
                )
                return res.status(200).send('OK')
            }
        } else if (body && body.trim()) {
            messageText = body.trim()
        } else {
            // No text and no audio - ignore (could be image, video, etc.)
            console.log('WhatsApp Incoming: Ignoring non-text/non-audio message')
            await service.sendWhatsAppMessage(
                fromNumber,
                'Sorry, I can only process text and voice messages at the moment.'
            )
            return res.status(200).send('OK')
        }

        // Get user data for project and assistant info
        const user = await getUserData(userId)
        const projectId = user?.defaultProjectId

        if (!projectId) {
            console.error('WhatsApp Incoming: User has no default project:', userId)
            await service.sendWhatsAppMessage(
                fromNumber,
                'Sorry, there was a configuration issue. Please set a default project in the Alldone app.'
            )
            return res.status(200).send('OK')
        }

        // Get the user's default assistant
        const assistantId = await getDefaultAssistantId(user, projectId)

        // Get or create today's daily topic
        const { chatId } = await getOrCreateWhatsAppDailyTopic(userId, projectId, assistantId)

        // Store user message in topic
        await storeUserMessageInTopic(projectId, chatId, userId, messageText, isVoice)

        // Update last WhatsApp message timestamp
        await admin.firestore().doc(`users/${userId}`).update({
            lastWhatsAppMessageTimestamp: Date.now(),
        })

        // Process through AI assistant
        console.log('WhatsApp Incoming: Processing through assistant', {
            userId,
            projectId,
            chatId,
            assistantId,
            messageLength: messageText.length,
        })

        const aiResponse = await processWhatsAppAssistantMessage(userId, projectId, chatId, messageText, assistantId)

        // Send response back via WhatsApp
        if (aiResponse) {
            await service.sendWhatsAppMessage(fromNumber, aiResponse)
        } else {
            await service.sendWhatsAppMessage(
                fromNumber,
                'Sorry, I was unable to generate a response. Please try again.'
            )
        }

        const duration = Date.now() - startTime
        console.log('WhatsApp Incoming: Complete', { userId, duration: `${duration}ms` })

        return res.status(200).send('OK')
    } catch (error) {
        console.error('WhatsApp Incoming: Unhandled error', {
            error: error.message,
            stack: error.stack,
            duration: `${Date.now() - startTime}ms`,
        })

        // Try to send an error message back
        try {
            const fromNumber = req.body?.From
            if (fromNumber) {
                const service = new TwilioWhatsAppService()
                await service.sendWhatsAppMessage(fromNumber, 'Sorry, I encountered an error. Please try again later.')
            }
        } catch (sendError) {
            console.error('WhatsApp Incoming: Failed to send error message:', sendError.message)
        }

        return res.status(200).send('OK') // Always return 200 to Twilio to avoid retries
    }
}

/**
 * Normalize a phone number by stripping the whatsapp: prefix and non-digit characters.
 */
function normalizePhoneNumber(phoneNumber) {
    if (!phoneNumber) return ''
    let clean = phoneNumber.replace(/^whatsapp:/, '')
    clean = clean.replace(/[^\d+]/g, '')
    if (!clean.startsWith('+')) {
        clean = '+' + clean
    }
    return clean
}

/**
 * Find a user ID by phone number.
 */
async function findUserByPhone(phone) {
    if (!phone) return null

    // Try exact match first
    const snapshot = await admin.firestore().collection('users').where('phone', '==', phone).limit(1).get()

    if (!snapshot.empty) {
        return snapshot.docs[0].id
    }

    // Try without + prefix
    const phoneWithoutPlus = phone.replace(/^\+/, '')
    const snapshot2 = await admin.firestore().collection('users').where('phone', '==', phoneWithoutPlus).limit(1).get()

    if (!snapshot2.empty) {
        return snapshot2.docs[0].id
    }

    return null
}

/**
 * Check rate limit for a user. Returns true if rate limited.
 */
async function checkRateLimit(userId) {
    const ref = admin.firestore().doc(`whatsAppRateLimits/${userId}`)
    const doc = await ref.get()
    const now = Date.now()

    if (!doc.exists) {
        await ref.set({ messageCount: 1, windowStart: now })
        return false
    }

    const data = doc.data()
    const elapsed = now - (data.windowStart || 0)

    if (elapsed > RATE_LIMIT_WINDOW_MS) {
        // Window expired, reset
        await ref.set({ messageCount: 1, windowStart: now })
        return false
    }

    if ((data.messageCount || 0) >= RATE_LIMIT_MAX_MESSAGES) {
        return true
    }

    // Increment counter
    await ref.update({ messageCount: admin.firestore.FieldValue.increment(1) })
    return false
}

/**
 * Get the default assistant ID for a user.
 */
async function getDefaultAssistantId(user, projectId) {
    // Check if user has a preferred assistant
    if (user?.defaultAssistantId) {
        return user.defaultAssistantId
    }

    // Try to get the global default assistant
    try {
        const defaultAssistant = await getDefaultAssistantData(admin)
        if (defaultAssistant?.uid) {
            return defaultAssistant.uid
        }
    } catch (error) {
        console.warn('WhatsApp: Could not fetch default assistant:', error.message)
    }

    // Fallback: query the first assistant in the project
    try {
        const snapshot = await admin.firestore().collection(`assistants/${projectId}/items`).limit(1).get()

        if (!snapshot.empty) {
            return snapshot.docs[0].id
        }
    } catch (error) {
        console.warn('WhatsApp: Could not find project assistant:', error.message)
    }

    return null
}

/**
 * Get the webhook URL for Twilio signature validation.
 */
function getWebhookUrl() {
    if (process.env.FUNCTIONS_EMULATOR) {
        return 'http://localhost:5001/alldonealeph/europe-west1/whatsAppIncomingMessage'
    }

    let projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT
    if (!projectId) {
        try {
            const cfg = process.env.FIREBASE_CONFIG ? JSON.parse(process.env.FIREBASE_CONFIG) : null
            if (cfg && cfg.projectId) projectId = cfg.projectId
        } catch (_) {}
    }

    if (projectId === 'alldonestaging') {
        return 'https://europe-west1-alldonestaging.cloudfunctions.net/whatsAppIncomingMessage'
    }

    return 'https://europe-west1-alldonealeph.cloudfunctions.net/whatsAppIncomingMessage'
}

module.exports = { handleIncomingWhatsAppMessage }
