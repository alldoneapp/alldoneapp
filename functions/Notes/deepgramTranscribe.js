'use strict'

const { DeepgramClient } = require('@deepgram/sdk')
const { getEnvFunctions } = require('../envFunctionsHelper')

// Deepgram accepts the container format embedded in the audio bytes themselves, so the same call
// serves audio/webm (Chrome/Firefox) and audio/mp4 (Safari/iOS) recordings without a format switch.
const DEEPGRAM_TRANSCRIPTION_OPTIONS = {
    model: 'nova-3',
    smart_format: true,
    detect_language: true,
    // Diarization stays off: single-speaker dictation and per-chunk meeting audio alike have no
    // speaker identity that survives across requests.
    diarize: false,
    punctuate: true,
    paragraphs: true,
}

function stripDataUrlPrefix(base64Audio) {
    return base64Audio.replace(/^data:audio\/[a-zA-Z0-9-+\.]+;.*base64,/, '')
}

function formatTranscript(result) {
    const alternative = result?.results?.channels?.[0]?.alternatives?.[0]
    const paragraphs = alternative?.paragraphs?.paragraphs
    if (paragraphs) {
        return paragraphs.map(p => p.sentences.map(s => s.text).join(' ')).join('\n\n')
    }
    return alternative?.transcript || ''
}

// Returns { transcript, durationSeconds }. durationSeconds comes from Deepgram's own measurement of
// the decoded audio, so billing cannot be steered by a client-supplied duration hint.
async function transcribeAudioBase64(base64Audio) {
    const env = getEnvFunctions()
    const apiKey = env.DEEPGRAM_API_KEY
    if (!apiKey) {
        throw new Error('Deepgram API Key is not configured')
    }

    const deepgram = new DeepgramClient({ apiKey })
    const buffer = Buffer.from(stripDataUrlPrefix(base64Audio), 'base64')

    const result = await deepgram.listen.v1.media.transcribeFile(buffer, DEEPGRAM_TRANSCRIPTION_OPTIONS)

    const metadataDuration = Number(result?.metadata?.duration)
    return {
        transcript: formatTranscript(result).trim(),
        durationSeconds: Number.isFinite(metadataDuration) && metadataDuration > 0 ? metadataDuration : 0,
    }
}

module.exports = {
    transcribeAudioBase64,
    formatTranscript,
    stripDataUrlPrefix,
    DEEPGRAM_TRANSCRIPTION_OPTIONS,
}
