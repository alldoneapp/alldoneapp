const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { getEnvFunctions } = require('../envFunctionsHelper')
const { transcribeAudioBase64 } = require('./deepgramTranscribe')

const { deductGold } = require('../Gold/goldHelper')

const TRANSCRIPTION_COST = 0.2 // Gold per chunk

exports.transcribeMeetingAudio = onCall(
    {
        timeoutSeconds: 300,
        memory: '1GiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request

        if (!auth) {
            throw new HttpsError('permission-denied', 'Authentication required')
        }

        const { audioChunk } = data
        if (!audioChunk) {
            throw new HttpsError('invalid-argument', 'Audio chunk is required')
        }

        try {
            const goldResult = await deductGold(auth.uid, TRANSCRIPTION_COST, {
                source: 'meeting_transcription',
                channel: 'notes',
            })

            if (!goldResult?.success) {
                throw new Error(goldResult?.message || 'Insufficient Gold')
            }
        } catch (e) {
            console.error('Gold deduction failed:', e)
            if (e.message === 'Insufficient Gold') {
                throw new HttpsError('resource-exhausted', 'Insufficient Gold to transcribe audio.')
            }
            throw new HttpsError('internal', 'Transaction failed', e)
        }

        const env = getEnvFunctions()
        const apiKey = env.DEEPGRAM_API_KEY

        if (!apiKey) {
            console.error('Deepgram API Key is missing')
            throw new HttpsError('internal', 'Deepgram API Key is not configured')
        }

        try {
            // Shares the rambler's transcription helper rather than repeating the Deepgram call:
            // both paths must stay on the same model, the same formatting and the same keyterm
            // vocabulary, and two copies of that options object is exactly how they drift apart.
            // The helper handles the data-URL prefix, the buffer conversion and the paragraph
            // formatting (with the flat-transcript fallback) identically to the inline code it
            // replaces.
            const { transcript, keytermFallback } = await transcribeAudioBase64(audioChunk)

            if (keytermFallback) {
                console.warn('[transcribeMeeting] Transcribed without keyterms after a rejected request')
            }

            return { text: transcript }
        } catch (error) {
            console.error('Error transcribing audio:', error)
            throw new HttpsError('internal', 'Failed to transcribe audio', error)
        }
    }
)
