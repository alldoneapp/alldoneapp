const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { getEnvFunctions } = require('../envFunctionsHelper')
const OpenAI = require('openai')
const fs = require('fs')
const os = require('os')
const path = require('path')

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
            // Or we handle stripping it here. let's be safe and strip if present.
            const base64Data = audioChunk.replace(/^data:audio\/\w+;base64,/, '')
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
