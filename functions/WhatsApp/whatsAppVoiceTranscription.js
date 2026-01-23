const { getCachedEnvFunctions, getOpenAIClient } = require('../Assistant/assistantHelper')

/**
 * Transcribe a WhatsApp voice message using OpenAI Whisper API.
 *
 * @param {string} mediaUrl - Twilio media URL for the voice message
 * @param {string} twilioAccountSid - Twilio Account SID for auth
 * @param {string} twilioAuthToken - Twilio Auth Token for auth
 * @returns {Promise<{text: string, duration: number}>} Transcribed text and duration
 */
async function transcribeWhatsAppVoiceMessage(mediaUrl, twilioAccountSid, twilioAuthToken) {
    console.log('WhatsApp Voice: Starting transcription', { mediaUrl: mediaUrl.substring(0, 80) })

    // Download audio from Twilio (requires Basic auth)
    const audioBuffer = await downloadTwilioMedia(mediaUrl, twilioAccountSid, twilioAuthToken)

    if (!audioBuffer || audioBuffer.length === 0) {
        throw new Error('Failed to download voice message: empty audio data')
    }

    console.log('WhatsApp Voice: Downloaded audio', { size: audioBuffer.length })

    // Transcribe using OpenAI Whisper
    const envFunctions = getCachedEnvFunctions()
    const openai = getOpenAIClient(envFunctions.OPEN_AI_KEY)

    // Create a File-like object from the buffer for the OpenAI API
    const file = new File([audioBuffer], 'voice_message.ogg', { type: 'audio/ogg' })

    const transcription = await openai.audio.transcriptions.create({
        model: 'whisper-1',
        file: file,
        response_format: 'verbose_json',
    })

    const text = transcription.text || ''
    const duration = transcription.duration || 0

    console.log('WhatsApp Voice: Transcription complete', { textLength: text.length, duration })

    if (!text.trim()) {
        throw new Error('Transcription returned empty text')
    }

    return { text: text.trim(), duration }
}

/**
 * Download media from a Twilio URL with Basic authentication.
 *
 * @param {string} mediaUrl - The Twilio media URL
 * @param {string} accountSid - Twilio Account SID
 * @param {string} authToken - Twilio Auth Token
 * @returns {Promise<Buffer>} The downloaded file as a Buffer
 */
async function downloadTwilioMedia(mediaUrl, accountSid, authToken) {
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
    return Buffer.from(arrayBuffer)
}

module.exports = {
    transcribeWhatsAppVoiceMessage,
}
