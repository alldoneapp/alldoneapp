const admin = require('firebase-admin')
const moment = require('moment')
const TwilioWhatsAppService = require('../Services/TwilioWhatsAppService')
const { transcribeWhatsAppVoiceMessage } = require('./whatsAppVoiceTranscription')
const { getEnvFunctions } = require('../envFunctionsHelper')
const { deductGold } = require('../Gold/goldHelper')
const { getUserData } = require('../Users/usersFirestore')
const { getDefaultAssistantData } = require('../Firestore/assistantsFirestore')
const { extractTextFromWhatsAppFile } = require('./whatsAppFileExtraction')
const { buildAttachmentToken, buildImageToken, buildVideoToken, sanitizeTokenText } = require('./whatsAppMediaTokens')
const { v4: uuidv4 } = require('uuid')

const RATE_LIMIT_MAX_MESSAGES = 30
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const MAX_WHATSAPP_MEDIA_ITEMS = 5
const MAX_WHATSAPP_IMAGE_BYTES = 5 * 1024 * 1024 // 5MB
const MAX_WHATSAPP_DOCUMENT_BYTES = 20 * 1024 * 1024 // 20MB
const MAX_WHATSAPP_AUDIO_BYTES = 15 * 1024 * 1024 // 15MB
const MAX_WHATSAPP_VIDEO_BYTES = 25 * 1024 * 1024 // 25MB
const MAX_MEDIA_EXTRACTION_TOTAL_CHARS = 24000
const MEDIA_EXTRACTION_TIMEOUT_MS = 25000
const VOICE_MIME_HINTS = ['audio/ogg', 'audio/opus', 'audio/amr']

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
        const fileIngestionEnabled = getBooleanFlag(envFunctions.WHATSAPP_FILE_INGESTION_ENABLED, true)
        const fileExtractionEnabled = getBooleanFlag(envFunctions.WHATSAPP_FILE_EXTRACTION_ENABLED, true)

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
        const mediaItems = extractMediaItems(req.body, numMedia).slice(0, MAX_WHATSAPP_MEDIA_ITEMS)
        const firstMedia = mediaItems[0] || null
        const trimmedBody = (body || '').trim()
        const voiceMedia = getVoiceMediaCandidate(mediaItems)
        const canTreatAsVoiceMessage = !!voiceMedia && mediaItems.length === 1 && !trimmedBody

        console.log('WhatsApp Incoming: Received message', {
            from: fromNumber,
            bodyLength: body?.length || 0,
            numMedia,
            acceptedMediaItems: mediaItems.length,
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
        let processedMedia = []
        let processedFileCount = 0
        let extractedTextCount = 0
        let mediaProcessingSummary = null

        if (canTreatAsVoiceMessage) {
            // Voice message - transcribe
            console.log('WhatsApp Incoming: Processing voice message', { mediaContentType0: voiceMedia.contentType })
            try {
                const voiceTranscriptionStart = Date.now()
                const { text, duration } = await transcribeWhatsAppVoiceMessage(
                    voiceMedia.url,
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

                const voiceGoldStart = Date.now()
                const goldResult = await deductGold(userId, voiceCost, {
                    source: 'whatsapp_voice',
                    channel: 'whatsapp',
                })

                if (!goldResult?.success) {
                    await service.sendWhatsAppMessage(
                        fromNumber,
                        'You do not have enough gold to process voice messages right now. Please send a text message.'
                    )
                    return res.status(200).send('OK')
                }

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
            messageText = trimmedBody
            storedMessageText = messageText

            if (mediaItems.length > 0) {
                if (!fileIngestionEnabled) {
                    console.log('WhatsApp Incoming: File ingestion disabled by feature flag')
                    await service.sendWhatsAppMessage(
                        fromNumber,
                        'I received media but file ingestion is currently disabled. Please send text for now.'
                    )
                    return res.status(200).send('OK')
                }

                const mediaStart = Date.now()
                const mediaResult = await processWhatsAppMediaItems(
                    mediaItems,
                    userId,
                    envFunctions.TWILIO_ACCOUNT_SID,
                    envFunctions.TWILIO_AUTH_TOKEN,
                    fileExtractionEnabled
                )

                processedMedia = mediaResult.processedMedia
                processedImageCount = mediaResult.processedImageCount
                processedFileCount = processedMedia.length
                extractedTextCount = mediaResult.extractedTextCount
                mediaProcessingSummary = {
                    totalIncomingMedia: numMedia,
                    acceptedMedia: mediaItems.length,
                    storedMedia: processedMedia.length,
                    unsupportedCount: mediaResult.unsupportedCount,
                    extractionFailureCount: mediaResult.extractionFailureCount,
                    extractionDisabled: !fileExtractionEnabled,
                }

                markStage('processWhatsAppMediaItems', mediaStart, {
                    userId,
                    requestedMedia: numMedia,
                    acceptedMedia: mediaItems.length,
                    processedMedia: processedMedia.length,
                    extractedTextCount,
                })

                const mediaTokens = processedMedia.map(media => media.tokenText).filter(Boolean)
                if (mediaTokens.length > 0) {
                    storedMessageText = [storedMessageText, ...mediaTokens].filter(Boolean).join(' ')
                }

                const processedImages = processedMedia.filter(media => media.kind === 'image' && media.storageUrl)
                if (processedImages.length > 0) {
                    const textForVision =
                        messageText ||
                        `Please analyze the attached image${processedImages.length > 1 ? 's' : ''} and files.`
                    userMessageContent = [
                        { type: 'text', text: textForVision },
                        ...processedImages.map(image => ({
                            type: 'image_url',
                            image_url: { url: image.storageUrl },
                        })),
                    ]
                    messageText = textForVision
                } else if (!messageText && processedMedia.length > 0) {
                    messageText = `Please review the ${processedMedia.length > 1 ? 'attached files' : 'attached file'}.`
                }

                if (processedMedia.length === 0 && !messageText && !storedMessageText) {
                    await service.sendWhatsAppMessage(
                        fromNumber,
                        'Sorry, I could not process those files. Please resend in a supported format or add text.'
                    )
                    return res.status(200).send('OK')
                }
            }
        }

        if (!messageText && !storedMessageText) {
            // No text and no supported media
            console.log('WhatsApp Incoming: Ignoring unsupported message')
            await service.sendWhatsAppMessage(
                fromNumber,
                'Sorry, I can only process text, voice, image, and supported file messages at the moment.'
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
            processedMedia,
            processedFileCount,
            extractedTextCount,
            mediaProcessingSummary,
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
            processedFileCount,
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
        const fileName = body[`MediaFileName${index}`] || body[`MediaFilename${index}`] || ''
        if (url && contentType) {
            items.push({ url, contentType, index, fileName })
        }
    }
    return items
}

function getVoiceMediaCandidate(mediaItems) {
    return mediaItems.find(item => {
        const contentType = String(item?.contentType || '').toLowerCase()
        return VOICE_MIME_HINTS.some(hint => contentType.includes(hint))
    })
}

async function processWhatsAppMediaItems(mediaItems, userId, accountSid, authToken, extractionEnabled) {
    const processedMedia = []
    let remainingExtractionChars = MAX_MEDIA_EXTRACTION_TOTAL_CHARS
    let extractedTextCount = 0
    let unsupportedCount = 0
    let extractionFailureCount = 0

    for (const media of mediaItems) {
        try {
            const processed = await processSingleWhatsAppMedia(
                media,
                userId,
                accountSid,
                authToken,
                extractionEnabled,
                remainingExtractionChars
            )

            if (!processed) continue
            processedMedia.push(processed)

            if (processed.extractedText) {
                extractedTextCount += 1
                remainingExtractionChars = Math.max(0, remainingExtractionChars - processed.extractedText.length)
            } else if (processed.extractionStatus === 'unsupported') {
                unsupportedCount += 1
            } else if (
                processed.extractionStatus === 'error' ||
                processed.extractionStatus === 'timeout' ||
                processed.extractionStatus === 'parser_unavailable'
            ) {
                extractionFailureCount += 1
            }
        } catch (error) {
            console.warn('WhatsApp Incoming: Failed to process media item', {
                mediaIndex: media.index,
                contentType: media.contentType,
                error: error.message,
            })
        }
    }

    return {
        processedMedia,
        processedImageCount: processedMedia.filter(media => media.kind === 'image').length,
        extractedTextCount,
        unsupportedCount,
        extractionFailureCount,
    }
}

async function processSingleWhatsAppMedia(
    media,
    userId,
    accountSid,
    authToken,
    extractionEnabled,
    remainingExtractionChars
) {
    const contentType = String(media?.contentType || '').toLowerCase()
    const kind = getMediaKind(contentType)
    const storedMedia = await downloadAndStoreTwilioMedia(
        media.url,
        contentType,
        userId,
        accountSid,
        authToken,
        media.index,
        kind,
        media.fileName
    )
    const tokenFileName = sanitizeTokenText(storedMedia.fileName)

    let tokenText = ''
    if (kind === 'image') {
        tokenText = buildImageToken(storedMedia.storageUrl, storedMedia.storageUrl, tokenFileName)
    } else if (kind === 'video') {
        tokenText = buildVideoToken(storedMedia.storageUrl, tokenFileName)
    } else {
        tokenText = buildAttachmentToken(storedMedia.storageUrl, tokenFileName)
    }

    let extractedText = ''
    let extractionStatus = 'not_required'

    if (extractionEnabled && remainingExtractionChars > 0 && kind !== 'image') {
        const extractionResult = await runWithTimeout(
            extractTextFromWhatsAppFile({
                buffer: storedMedia.buffer,
                contentType,
                fileName: storedMedia.fileName,
            }),
            MEDIA_EXTRACTION_TIMEOUT_MS,
            'File extraction timeout'
        ).catch(error => ({ extractedText: '', status: 'timeout', error: error.message }))

        extractionStatus = extractionResult.status || 'unsupported'
        if (extractionResult.extractedText) {
            extractedText = extractionResult.extractedText.substring(0, remainingExtractionChars)
        }
    }

    return {
        kind,
        contentType,
        fileName: storedMedia.fileName,
        storageUrl: storedMedia.storageUrl,
        tokenText,
        extractedText,
        extractionStatus,
        sizeBytes: storedMedia.sizeBytes,
    }
}

async function downloadAndStoreTwilioMedia(
    mediaUrl,
    contentType,
    userId,
    accountSid,
    authToken,
    mediaIndex,
    kind,
    originalFileName
) {
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64')
    const response = await fetch(mediaUrl, {
        headers: {
            Authorization: `Basic ${credentials}`,
        },
        redirect: 'follow',
    })

    if (!response.ok) {
        throw new Error(`Failed to download media: ${response.status} ${response.statusText}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const sizeLimit = getMediaSizeLimit(kind)
    if (buffer.length > sizeLimit) {
        throw new Error(`Media too large (${buffer.length} bytes, limit ${sizeLimit})`)
    }

    const responseFileName = getFileNameFromMediaResponse(response)
    const fileName = buildStoredMediaFileName(originalFileName || responseFileName, contentType, mediaUrl, mediaIndex)
    const datePath = moment().format('DDMMYYYY')
    const randomHash = uuidv4().replace(/-/g, '')
    const filePath = `notesAttachments/${datePath}/${randomHash}/${fileName}`
    const bucket = admin.storage().bucket()
    const file = bucket.file(filePath)
    const downloadToken = uuidv4()

    await file.save(buffer, {
        metadata: {
            contentType: contentType || 'application/octet-stream',
            cacheControl: 'public,max-age=31536000',
            metadata: {
                firebaseStorageDownloadTokens: downloadToken,
            },
        },
    })

    const encodedPath = encodeURIComponent(filePath)
    const storageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${downloadToken}`

    return {
        buffer,
        fileName,
        storageUrl,
        sizeBytes: buffer.length,
    }
}

function getMediaKind(contentType) {
    if (contentType.startsWith('image/')) return 'image'
    if (contentType.startsWith('video/')) return 'video'
    if (contentType.startsWith('audio/')) return 'audio'
    if (contentType.startsWith('application/') || contentType.startsWith('text/')) return 'document'
    return 'file'
}

function getMediaSizeLimit(kind) {
    if (kind === 'image') return MAX_WHATSAPP_IMAGE_BYTES
    if (kind === 'audio') return MAX_WHATSAPP_AUDIO_BYTES
    if (kind === 'video') return MAX_WHATSAPP_VIDEO_BYTES
    return MAX_WHATSAPP_DOCUMENT_BYTES
}

function getFileExtensionForMedia(contentType, mediaUrl = '') {
    const ct = String(contentType || '').toLowerCase()
    if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg'
    if (ct.includes('png')) return 'png'
    if (ct.includes('webp')) return 'webp'
    if (ct.includes('gif')) return 'gif'
    if (ct.includes('pdf')) return 'pdf'
    if (ct.includes('json')) return 'json'
    if (ct.includes('csv')) return 'csv'
    if (ct.includes('plain')) return 'txt'
    if (ct.includes('wordprocessingml')) return 'docx'
    if (ct.includes('msword')) return 'doc'
    if (ct.includes('mpeg')) return 'mp3'
    if (ct.includes('wav')) return 'wav'
    if (ct.includes('ogg')) return 'ogg'
    if (ct.includes('mp4')) return 'mp4'

    try {
        const parsed = new URL(mediaUrl)
        const pathname = parsed.pathname || ''
        const parts = pathname.split('.')
        if (parts.length > 1 && parts[parts.length - 1]) {
            return parts[parts.length - 1].toLowerCase()
        }
    } catch (_) {}

    return 'bin'
}

function buildStoredMediaFileName(originalFileName, contentType, mediaUrl = '', mediaIndex = 0) {
    const normalizedOriginal = sanitizeIncomingMediaFileName(originalFileName)
    if (normalizedOriginal) {
        if (normalizedOriginal.includes('.')) return normalizedOriginal

        const extension = getFileExtensionForMedia(contentType, mediaUrl)
        if (extension && extension !== 'bin') {
            return `${normalizedOriginal}.${extension}`
        }

        return normalizedOriginal
    }

    const extension = getFileExtensionForMedia(contentType, mediaUrl)
    return `${Date.now()}_${mediaIndex}_${uuidv4()}.${extension}`
}

function getFileNameFromMediaResponse(response) {
    const contentDisposition =
        response?.headers?.get?.('content-disposition') || response?.headers?.get?.('Content-Disposition') || ''
    if (!contentDisposition) return ''

    const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)
    if (utf8Match?.[1]) {
        try {
            return sanitizeIncomingMediaFileName(decodeURIComponent(utf8Match[1]))
        } catch (_) {
            return sanitizeIncomingMediaFileName(utf8Match[1])
        }
    }

    const basicMatch = contentDisposition.match(/filename="?([^";]+)"?/i)
    if (basicMatch?.[1]) {
        return sanitizeIncomingMediaFileName(basicMatch[1])
    }

    return ''
}

function sanitizeIncomingMediaFileName(fileName) {
    const baseName = String(fileName || '')
        .split(/[\\/]/)
        .pop()
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()

    if (!baseName || baseName === '.' || baseName === '..') return ''

    return baseName.replace(/\s+/g, ' ')
}

function getBooleanFlag(value, defaultValue = false) {
    if (value === undefined || value === null || value === '') return defaultValue
    const normalized = String(value).trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false
    return defaultValue
}

function runWithTimeout(promise, timeoutMs, message) {
    let timeout
    const timeoutPromise = new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message || `Timed out after ${timeoutMs}ms`)), timeoutMs)
    })

    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout))
}

module.exports = {
    handleIncomingWhatsAppMessage,
    __private__: {
        extractMediaItems,
        buildStoredMediaFileName,
        getFileNameFromMediaResponse,
        sanitizeIncomingMediaFileName,
    },
}
