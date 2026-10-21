const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { getEnvFunctions } = require('../envFunctionsHelper')
const { transcribeAudioBase64 } = require('./deepgramTranscribe')

const { deductGold } = require('../Gold/goldHelper')
const { withMeetingTranscriptionCache } = require('./meetingTranscriptionCache')

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

        const { audioChunk, sessionId, chunkIndex, projectId, noteId } = data || {}
        if (typeof audioChunk !== 'string' || !audioChunk || audioChunk.length > 9000000) {
            throw new HttpsError('invalid-argument', 'Audio chunk is required')
        }

        // Calls without IDs retain the existing screen/tab transcription contract.
        const transcribe = async idempotencyKey => {
            const env = getEnvFunctions()
            if (!env.DEEPGRAM_API_KEY) throw new HttpsError('internal', 'Deepgram API Key is not configured')
            try {
                const goldResult = await deductGold(auth.uid, TRANSCRIPTION_COST, {
                    source: 'meeting_transcription',
                    channel: 'notes',
                    ...(idempotencyKey ? { idempotencyKey, projectId, objectId: noteId, objectType: 'note' } : {}),
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
        if (sessionId !== undefined || chunkIndex !== undefined) {
            return withMeetingTranscriptionCache({ uid: auth.uid, sessionId, chunkIndex, audioChunk, run: transcribe })
        }
        return transcribe()
    }
)
