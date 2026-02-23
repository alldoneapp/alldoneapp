const admin = require('firebase-admin')
const TwilioWhatsAppService = require('../Services/TwilioWhatsAppService')
const { transcribeWhatsAppVoiceMessage } = require('./whatsAppVoiceTranscription')
const { getEnvFunctions } = require('../envFunctionsHelper')
const { getUserData } = require('../Users/usersFirestore')
const { getDefaultAssistantData } = require('../Firestore/assistantsFirestore')
const { v4: uuidv4 } = require('uuid')

const RATE_LIMIT_MAX_MESSAGES = 30
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const MAX_WHATSAPP_IMAGES = 3
const MAX_WHATSAPP_IMAGE_BYTES = 5 * 1024 * 1024 // 5MB
const IMAGE_TRIGGER = 'O2TI5plHBf1QfdY'
const OLD_ATTACHMENT = '0'

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
        const { From: fromNumber, Body: body, NumMedia: numMediaStr, MessageSid: messageSid } = req.body
        const incomingMessageSid = messageSid || uuidv4()
        const markStage = createStageTimer('WhatsApp Incoming [TIMING]', {
            messageSid: incomingMessageSid,
        })

        const numMedia = parseInt(numMediaStr || '0', 10)
        const mediaItems = extractMediaItems(req.body, numMedia)
        const firstMedia = mediaItems[0] || null
        const audioMedia = mediaItems.find(item => item.contentType?.startsWith('audio/')) || null
        const imageMedia = mediaItems.filter(item => item.contentType?.startsWith('image/'))

        console.log('WhatsApp Incoming: Received message', {
            from: fromNumber,
            bodyLength: body?.length || 0,
            numMedia,
            firstMediaContentType: firstMedia?.contentType,
            messageSid,
        })

        // Normalize phone number (strip whatsapp: prefix)
        const cleanPhone = normalizePhoneNumber(fromNumber)

        // Look up user by phone number
        const lookupStart = Date.now()
        const userId = await findUserByPhone(cleanPhone)
        markStage('findUserByPhone', lookupStart, { cleanPhone })
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
        const rateLimitStart = Date.now()
        const rateLimited = await checkRateLimit(userId)
        markStage('checkRateLimit', rateLimitStart, { userId })
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
        let storedMessageText = ''
        let isVoice = false
        let userMessageContent = null
        let processedImageCount = 0

        if (audioMedia) {
            // Voice message - transcribe
            console.log('WhatsApp Incoming: Processing voice message', { mediaContentType0: audioMedia.contentType })
            try {
                const voiceTranscriptionStart = Date.now()
                const { text, duration } = await transcribeWhatsAppVoiceMessage(
                    audioMedia.url,
                    envFunctions.TWILIO_ACCOUNT_SID,
                    envFunctions.TWILIO_AUTH_TOKEN
                )
                markStage('transcribeWhatsAppVoiceMessage', voiceTranscriptionStart, {
                    userId,
                    durationSeconds: duration,
                    textLength: (text || '').length,
                })
                messageText = text
                isVoice = true

                // Calculate gold cost: 1 Gold per 10 seconds (min 1 Gold)
                const voiceCost = Math.max(1, Math.ceil(duration / 10))

                console.log('WhatsApp Incoming: Deducting gold for voice', { duration, cost: voiceCost })

                // Deduct gold
                const voiceGoldStart = Date.now()
                await admin
                    .firestore()
                    .doc(`users/${userId}`)
                    .update({
                        gold: admin.firestore.FieldValue.increment(-voiceCost),
                    })
                markStage('deductVoiceGold', voiceGoldStart, { userId, voiceCost })
            } catch (error) {
                console.error('WhatsApp Incoming: Voice transcription failed:', error.message)
                await service.sendWhatsAppMessage(
                    fromNumber,
                    'Sorry, I could not understand your voice message. Please try again or send a text message.'
                )
                return res.status(200).send('OK')
            }
        } else {
            messageText = body?.trim() || ''
            storedMessageText = messageText

            if (imageMedia.length > 0) {
                const imagesStart = Date.now()
                const processedImages = await processWhatsAppImages(
                    imageMedia.slice(0, MAX_WHATSAPP_IMAGES),
                    userId,
                    envFunctions.TWILIO_ACCOUNT_SID,
                    envFunctions.TWILIO_AUTH_TOKEN
                )
                markStage('processWhatsAppImages', imagesStart, {
                    userId,
                    requestedImages: imageMedia.length,
                    processedImages: processedImages.length,
                })

                if (processedImages.length > 0) {
                    processedImageCount = processedImages.length
                    const textForVision =
                        messageText || `Please analyze the attached image${processedImages.length > 1 ? 's' : ''}.`
                    userMessageContent = [
                        { type: 'text', text: textForVision },
                        ...processedImages.map(image => ({
                            type: 'image_url',
                            image_url: { url: image.imageUrl },
                        })),
                    ]
                    messageText = textForVision

                    const imageTokens = processedImages.map(image =>
                        buildImageToken(image.imageUrl, image.resizedImageUrl || image.imageUrl, image.imageText)
                    )
                    storedMessageText = [storedMessageText, ...imageTokens].filter(Boolean).join(' ')
                } else if (!messageText && !storedMessageText) {
                    await service.sendWhatsAppMessage(
                        fromNumber,
                        'Sorry, I could not read that image. Please resend it (preferably as JPG or PNG) or add text.'
                    )
                    return res.status(200).send('OK')
                }
            }
        }

        if (!messageText && !storedMessageText) {
            // No text and no audio - ignore (could be image, video, etc.)
            console.log('WhatsApp Incoming: Ignoring unsupported message')
            await service.sendWhatsAppMessage(
                fromNumber,
                'Sorry, I can only process text, voice, and image messages at the moment.'
            )
            return res.status(200).send('OK')
        }

        // Get user data for project and assistant info
        const userDataStart = Date.now()
        const user = await getUserData(userId)
        markStage('getUserData', userDataStart, { userId })
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
        const assistantStart = Date.now()
        const assistantId = await getDefaultAssistantId(user, projectId)
        markStage('getDefaultAssistantId', assistantStart, { userId, projectId })

        const queuePayload = {
            messageSid: incomingMessageSid,
            fromNumber,
            userId,
            projectId,
            assistantId: assistantId || null,
            messageText,
            storedMessageText: isVoice ? messageText : storedMessageText || messageText,
            userMessageContent: Array.isArray(userMessageContent) ? userMessageContent : null,
            isVoice: !!isVoice,
            processedImageCount,
            createdAt: Date.now(),
        }

        const enqueueStart = Date.now()
        const enqueueResult = await enqueueIncomingWhatsAppMessage(queuePayload)
        markStage('enqueueIncomingWhatsAppMessage', enqueueStart, {
            userId,
            queuePath: enqueueResult.queuePath,
            duplicate: enqueueResult.duplicate,
        })
        if (enqueueResult.duplicate) {
            console.log('WhatsApp Incoming: Duplicate MessageSid detected, skipping enqueue', {
                messageSid: queuePayload.messageSid,
                userId,
            })
            return res.status(200).send('OK')
        }

        // Update last WhatsApp message timestamp
        const updateUserStart = Date.now()
        await admin.firestore().doc(`users/${userId}`).update({
            lastWhatsAppMessageTimestamp: Date.now(),
        })
        markStage('updateUserLastWhatsAppTimestamp', updateUserStart, { userId })

        console.log('WhatsApp Incoming: Enqueued for async processing', {
            userId,
            projectId,
            assistantId: assistantId || null,
            messageSid: queuePayload.messageSid,
            queuePath: enqueueResult.queuePath,
            messageLength: messageText.length,
        })

        const duration = Date.now() - startTime
        markStage('webhookAckComplete', startTime, { userId, totalDurationMs: duration })
        console.log('WhatsApp Incoming: ACK complete', { userId, duration: `${duration}ms` })

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

async function enqueueIncomingWhatsAppMessage(payload) {
    const db = admin.firestore()
    const normalizedMessageSid = String(payload.messageSid || uuidv4()).trim()
    const userId = String(payload.userId || '').trim()
    if (!normalizedMessageSid || !userId) {
        throw new Error('Cannot enqueue WhatsApp message without MessageSid and userId')
    }

    const dedupRef = db.doc(`whatsAppInboundDedup/${normalizedMessageSid}`)
    const queueRef = db.doc(`whatsAppInboundQueue/${userId}/items/${normalizedMessageSid}`)
    const now = Date.now()
    let duplicate = false

    await db.runTransaction(async transaction => {
        const dedupDoc = await transaction.get(dedupRef)
        if (dedupDoc.exists) {
            duplicate = true
            return
        }

        transaction.set(dedupRef, {
            messageSid: normalizedMessageSid,
            userId,
            fromNumber: payload.fromNumber || '',
            createdAt: now,
        })

        transaction.set(queueRef, {
            ...payload,
            messageSid: normalizedMessageSid,
            userId,
            status: 'pending',
            attempts: 0,
            receivedAt: now,
            updatedAt: now,
        })
    })

    return {
        duplicate,
        queuePath: queueRef.path,
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
    const db = admin.firestore()
    const normalizedProjectId = String(projectId || '').trim()
    const userDefaultAssistantId = typeof user?.defaultAssistantId === 'string' ? user.defaultAssistantId.trim() : ''

    if (!normalizedProjectId) return null

    const assistantExistsInProjectOrGlobal = async assistantId => {
        if (!assistantId) return false
        const [projectAssistantDoc, globalAssistantDoc] = await db.getAll(
            db.doc(`assistants/${normalizedProjectId}/items/${assistantId}`),
            db.doc(`assistants/globalProject/items/${assistantId}`)
        )
        return projectAssistantDoc.exists || globalAssistantDoc.exists
    }

    // 1) Prefer project's configured assistant to align with app project context.
    try {
        const projectDoc = await db.doc(`projects/${normalizedProjectId}`).get()
        const projectAssistantId = projectDoc.exists ? String(projectDoc.data()?.assistantId || '').trim() : ''
        if (projectAssistantId && (await assistantExistsInProjectOrGlobal(projectAssistantId))) {
            console.log('WhatsApp: Selected assistant from project.assistantId', {
                projectId: normalizedProjectId,
                assistantId: projectAssistantId,
            })
            return projectAssistantId
        }
    } catch (error) {
        console.warn('WhatsApp: Could not resolve project assistant:', error.message)
    }

    // 2) Fallback to user's preferred assistant.
    if (userDefaultAssistantId) {
        try {
            if (await assistantExistsInProjectOrGlobal(userDefaultAssistantId)) {
                console.log('WhatsApp: Selected assistant from user.defaultAssistantId fallback', {
                    projectId: normalizedProjectId,
                    assistantId: userDefaultAssistantId,
                })
                return userDefaultAssistantId
            }
        } catch (error) {
            console.warn('WhatsApp: Could not validate user.defaultAssistantId:', error.message)
        }
    }

    // 3) Fallback to first assistant in the project.
    try {
        const snapshot = await db.collection(`assistants/${normalizedProjectId}/items`).limit(1).get()
        if (!snapshot.empty) {
            console.log('WhatsApp: Selected first assistant in project fallback', {
                projectId: normalizedProjectId,
                assistantId: snapshot.docs[0].id,
            })
            return snapshot.docs[0].id
        }
    } catch (error) {
        console.warn('WhatsApp: Could not find assistant in project:', error.message)
    }

    // 4) Last fallback: global default assistant.
    try {
        const defaultAssistant = await getDefaultAssistantData(admin)
        if (defaultAssistant?.uid) {
            console.log('WhatsApp: Selected global default assistant fallback', {
                projectId: normalizedProjectId,
                assistantId: defaultAssistant.uid,
            })
            return defaultAssistant.uid
        }
    } catch (error) {
        console.warn('WhatsApp: Could not fetch global default assistant:', error.message)
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

function extractMediaItems(body, numMedia) {
    const items = []
    for (let index = 0; index < numMedia; index++) {
        const url = body[`MediaUrl${index}`]
        const contentType = body[`MediaContentType${index}`]
        if (url && contentType) {
            items.push({ url, contentType, index })
        }
    }
    return items
}

async function processWhatsAppImages(imageMedia, userId, twilioAccountSid, twilioAuthToken) {
    const images = await Promise.all(
        imageMedia.map(async media => {
            try {
                return await downloadAndStoreTwilioImage(
                    media.url,
                    media.contentType,
                    userId,
                    twilioAccountSid,
                    twilioAuthToken,
                    media.index
                )
            } catch (error) {
                console.warn('WhatsApp Incoming: Failed to process image media', {
                    mediaIndex: media.index,
                    contentType: media.contentType,
                    error: error.message,
                })
                return null
            }
        })
    )
    return images.filter(Boolean)
}

async function downloadAndStoreTwilioImage(mediaUrl, contentType, userId, accountSid, authToken, mediaIndex) {
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64')
    const response = await fetch(mediaUrl, {
        headers: {
            Authorization: `Basic ${credentials}`,
        },
        redirect: 'follow',
    })

    if (!response.ok) {
        throw new Error(`Failed to download image media: ${response.status} ${response.statusText}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    const imageBuffer = Buffer.from(arrayBuffer)
    if (imageBuffer.length > MAX_WHATSAPP_IMAGE_BYTES) {
        throw new Error(`Image too large (${imageBuffer.length} bytes)`)
    }

    const extension = getFileExtensionForContentType(contentType)
    const fileName = `${Date.now()}_${mediaIndex}_${uuidv4()}.${extension}`
    const filePath = `whatsapp-images/${userId}/${fileName}`
    const bucket = admin.storage().bucket()
    const file = bucket.file(filePath)

    await file.save(imageBuffer, {
        metadata: {
            contentType,
            cacheControl: 'public,max-age=31536000',
        },
    })

    const [imageUrl] = await file.getSignedUrl({
        action: 'read',
        expires: '03-01-2491',
    })

    return {
        imageUrl,
        resizedImageUrl: imageUrl,
        imageText: `whatsapp_image_${mediaIndex + 1}.${extension}`,
    }
}

function getFileExtensionForContentType(contentType) {
    if (!contentType || typeof contentType !== 'string') return 'jpg'
    if (contentType.includes('png')) return 'png'
    if (contentType.includes('webp')) return 'webp'
    if (contentType.includes('gif')) return 'gif'
    return 'jpg'
}

function buildImageToken(uri, resizedUri, imageText) {
    return `${IMAGE_TRIGGER}${uri}${IMAGE_TRIGGER}${resizedUri}${IMAGE_TRIGGER}${imageText}${IMAGE_TRIGGER}${OLD_ATTACHMENT}`
}

module.exports = { handleIncomingWhatsAppMessage }
