const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { getEnvFunctions } = require('../envFunctionsHelper')
const OpenAI = require('openai')
const fs = require('fs')
const os = require('os')
const path = require('path')

const admin = require('firebase-admin')

const TRANSCRIPTION_COST = 10 // Gold per chunk

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
        const apiKey = env.OPEN_AI_KEY

        if (!apiKey) {
            console.error('OpenAI API Key is missing')
            throw new HttpsError('internal', 'OpenAI API Key is not configured')
        }

        const openai = new OpenAI({
            apiKey: apiKey,
        })

        // Create a temporary file to store the audio chunk
        const tempFilePath = path.join(os.tmpdir(), `audio-${Date.now()}.webm`)

        try {
            // Convert base64 to buffer and write to file
            // The frontend should send the base64 string without the data URL prefix (e.g., "data:audio/webm;base64,")
            // But we handle stripping it here just in case, using a regex that handles extra parameters like codecs
            const base64Data = audioChunk.replace(/^data:audio\/[a-zA-Z0-9-+\.]+;.*base64,/, '')
            const buffer = Buffer.from(base64Data, 'base64')
            fs.writeFileSync(tempFilePath, buffer)

            const transcription = await openai.audio.transcriptions.create({
                file: fs.createReadStream(tempFilePath),
                model: 'whisper-1',
            })

            return { text: transcription.text }
        } catch (error) {
            console.error('Error transcribing audio:', error)
            throw new HttpsError('internal', 'Failed to transcribe audio', error)
        } finally {
            // Clean up: delete the temp file
            if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath)
            }
        }
    }
)
