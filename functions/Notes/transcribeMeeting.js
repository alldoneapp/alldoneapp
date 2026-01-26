const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { getEnvFunctions } = require('../envFunctionsHelper')
const { createClient } = require('@deepgram/sdk')
const fs = require('fs')
const os = require('os')
const path = require('path')

const admin = require('firebase-admin')

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

        // Deduct Gold
        try {
            await admin.firestore().runTransaction(async transaction => {
                const userRef = admin.firestore().doc(`users/${auth.uid}`)
                const userDoc = await transaction.get(userRef)

                if (!userDoc.exists) {
                    throw new Error('User not found')
                }

                const currentGold = userDoc.data().gold || 0
                if (currentGold < TRANSCRIPTION_COST) {
                    throw new Error('Insufficient Gold')
                }

                transaction.update(userRef, {
                    gold: admin.firestore.FieldValue.increment(-TRANSCRIPTION_COST),
                })
            })
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

        const deepgram = createClient(apiKey)

        // Create a temporary file to store the audio chunk
        const tempFilePath = path.join(os.tmpdir(), `audio-${Date.now()}.webm`)

        try {
            // Convert base64 to buffer and write to file
            // The frontend should send the base64 string without the data URL prefix (e.g., "data:audio/webm;base64,")
            // But we handle stripping it here just in case, using a regex that handles extra parameters like codecs
            const base64Data = audioChunk.replace(/^data:audio\/[a-zA-Z0-9-+\.]+;.*base64,/, '')
            const buffer = Buffer.from(base64Data, 'base64')

            // Deepgram accepts Buffer directly, so we don't strictly need the file if we use the buffer.
            // However, the existing code used a file, and it might be safer for memory handling if chunks are large.
            // But Deepgram SDK supports buffer sources. Let's use the buffer directly to simplify IO if possible,
            // but the original code was file-based.
            // Given cloud function memory limits (1GB), buffer is fine for chunks.
            // Let's stick to the file approach for stability if buffer handling has edge cases,
            // but Deepgram SDK is designed for buffers in Node.
            // Actually, let's use the buffer directly to skip disk I/O, it's faster.

            const { result, error } = await deepgram.listen.prerecorded.transcribeFile(buffer, {
                model: 'nova-3',
                smart_format: true,
                detect_language: true,
                // Deactivate diarization for now because with our current file / chunk based approach
                // who is which speaker will not be persisted across sessions.
                diarize: false,
                punctuate: true,
                paragraphs: true,
            })

            if (error) {
                console.error('Deepgram API error:', error)
                throw new Error('Deepgram transcription failed')
            }

            // Format the transcript
            // Nova-3 with paragraphs enabled returns structured paragraphs
            let formattedTranscript = ''

            if (
                result.results &&
                result.results.channels &&
                result.results.channels[0].alternatives &&
                result.results.channels[0].alternatives[0].paragraphs
            ) {
                const paragraphs = result.results.channels[0].alternatives[0].paragraphs.paragraphs
                if (paragraphs) {
                    formattedTranscript = paragraphs
                        .map(p => {
                            // Join sentences in the paragraph
                            return p.sentences.map(s => s.text).join(' ')
                        })
                        .join('\n\n')
                }
            } else if (
                result.results &&
                result.results.channels &&
                result.results.channels[0].alternatives &&
                result.results.channels[0].alternatives[0].transcript
            ) {
                // Fallback to raw transcript if paragraphs mapping fails
                formattedTranscript = result.results.channels[0].alternatives[0].transcript
            }

            return { text: formattedTranscript }
        } catch (error) {
            console.error('Error transcribing audio:', error)
            throw new HttpsError('internal', 'Failed to transcribe audio', error)
        } finally {
            // Clean up: delete the temp file if we created it (we didn't used it above, but kept variable)
            if (fs.existsSync(tempFilePath)) {
                try {
                    fs.unlinkSync(tempFilePath)
                } catch (e) {
                    // ignore
                }
            }
        }
    }
)
