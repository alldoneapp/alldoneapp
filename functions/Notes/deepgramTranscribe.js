'use strict'

const { DeepgramClient } = require('@deepgram/sdk')
const { getEnvFunctions } = require('../envFunctionsHelper')
const { getTranscriptionKeyterms } = require('../shared/transcriptionVocabulary')

// Deepgram accepts the container format embedded in the audio bytes themselves, so the same call
// serves audio/webm (Chrome/Firefox) and audio/mp4 (Safari/iOS) recordings without a format switch.
//
// `language: 'multi'` replaced the previous `detect_language: true` in PT-4648, and the swap is
// load-bearing rather than cosmetic:
//
//  - Keyterm prompting (the whole point of PT-4648) needs an explicit language. `detect_language`
//    is the one mode Deepgram's docs never bless alongside `keyterm`.
//  - `detect_language` SILENTLY DOWNGRADES THE MODEL. It covers 35 languages, Nova-3 does not, and
//    when the detected language is missing from the requested model Deepgram walks down
//    Nova-3 -> Nova-2 -> Nova-1 -> Enhanced -> Base on its own. Nova-2 does not support keyterm at
//    all, so keyterms would have died on exactly the requests we could not see.
//  - `multi` is the Nova-3 multilingual model: English, Spanish, French, German, Hindi, Russian,
//    Portuguese, Japanese, Italian and Dutch, with WORD-LEVEL code-switching. That matters here
//    because dictation routinely mixes languages inside one sentence, which per-clip detection
//    cannot represent at all — it has to pick one.
//
// The accepted trade-off: a language outside those ten transcribes worse than it did under
// detection. `logDetectedLanguages` below is what makes that visible if it ever happens.
//
// Detection would OVERRIDE `language`, so the two must never both be set.
const DEEPGRAM_TRANSCRIPTION_OPTIONS = {
    model: 'nova-3',
    smart_format: true,
    language: 'multi',
    // Diarization stays off: single-speaker dictation and per-chunk meeting audio alike have no
    // speaker identity that survives across requests.
    diarize: false,
    punctuate: true,
    paragraphs: true,
}

function stripDataUrlPrefix(base64Audio) {
    return base64Audio.replace(/^data:audio\/[a-zA-Z0-9-+\.]+;.*base64,/, '')
}

/**
 * The BCP-47 tags Deepgram's multilingual model actually detected, sorted by word count descending.
 *
 * This is the counterpart to the `language: 'multi'` decision above: `multi` covers ten languages,
 * and the only way to find out whether real users dictate outside them is to record what came back.
 * Language TAGS are metadata, not content, so this is safe to log where the transcript is not.
 *
 * Returns an empty array on any older/other response shape rather than throwing — an unrecognised
 * payload must never cost the user their transcript.
 */
function extractDetectedLanguages(result) {
    const channel = result?.results?.channels?.[0]
    if (Array.isArray(channel?.languages)) {
        return channel.languages.filter(entry => typeof entry === 'string')
    }
    // `detect_language` responses (and some single-language multi responses) report one tag.
    if (typeof channel?.detected_language === 'string') return [channel.detected_language]
    return []
}

function formatTranscript(result) {
    const alternative = result?.results?.channels?.[0]?.alternatives?.[0]
    const paragraphs = alternative?.paragraphs?.paragraphs
    if (paragraphs) {
        return paragraphs.map(p => p.sentences.map(s => s.text).join(' ')).join('\n\n')
    }
    return alternative?.transcript || ''
}

/**
 * Request options for one transcription. Keyterms are only attached when there are any, because the
 * SDK skips null/undefined query values but WOULD serialize an empty array into nothing useful —
 * and an absent parameter is the documented way to opt out.
 *
 * Verified against @deepgram/sdk 5.7.0: `keyterm` is typed `string | string[]` on this exact request
 * and its query builder serializes arrays in "repeat" style, producing the
 * `?keyterm=Alldone&keyterm=OpenClaw` form Deepgram documents (multi-word terms percent-encoded).
 */
function buildTranscriptionOptions({ keyterms } = {}) {
    const options = { ...DEEPGRAM_TRANSCRIPTION_OPTIONS }
    if (Array.isArray(keyterms) && keyterms.length > 0) {
        options.keyterm = [...keyterms]
    }
    return options
}

/**
 * Keyterm prompting is a Nova-3 feature and Deepgram documents it as available for monolingual and
 * multilingual transcription — but we send `detect_language`, so the language it is applied to is
 * only known to Deepgram, at request time, and the docs do not enumerate keyterm support per
 * detected language. A rejected parameter would take down dictation for whoever happens to speak
 * that language, which is a far worse outcome than losing the brand-spelling boost.
 *
 * So the failure is absorbed rather than predicted: anything that looks like the request being
 * rejected (a 4xx / validation-shaped error) is retried once without keyterms. A transport or
 * server-side failure is NOT retried — it would just fail twice and double the latency of an
 * outage.
 */
function isLikelyBadRequestError(error) {
    const status = error?.statusCode ?? error?.status ?? error?.response?.status
    if (typeof status === 'number') return status >= 400 && status < 500
    const message = typeof error?.message === 'string' ? error.message.toLowerCase() : ''
    return message.includes('keyterm') || message.includes('invalid') || message.includes('bad request')
}

// Returns { transcript, durationSeconds, keytermCount, keytermFallback }. durationSeconds comes from
// Deepgram's own measurement of the decoded audio, so billing cannot be steered by a client-supplied
// duration hint. `keytermFallback` records that the keyterm retry above fired, so a silently
// degraded configuration is visible in the logs instead of only in transcript quality.
async function transcribeAudioBase64(base64Audio, { keyterms = getTranscriptionKeyterms() } = {}) {
    const env = getEnvFunctions()
    const apiKey = env.DEEPGRAM_API_KEY
    if (!apiKey) {
        throw new Error('Deepgram API Key is not configured')
    }

    const deepgram = new DeepgramClient({ apiKey })
    const buffer = Buffer.from(stripDataUrlPrefix(base64Audio), 'base64')

    const requestedKeyterms = Array.isArray(keyterms) ? keyterms : []
    let keytermFallback = false
    let result
    try {
        result = await deepgram.listen.v1.media.transcribeFile(
            buffer,
            buildTranscriptionOptions({ keyterms: requestedKeyterms })
        )
    } catch (error) {
        if (requestedKeyterms.length === 0 || !isLikelyBadRequestError(error)) throw error
        console.warn(
            '[deepgramTranscribe] Keyterm request rejected, retrying without keyterms:',
            error?.message || error
        )
        keytermFallback = true
        result = await deepgram.listen.v1.media.transcribeFile(buffer, buildTranscriptionOptions())
    }

    const metadataDuration = Number(result?.metadata?.duration)
    return {
        transcript: formatTranscript(result).trim(),
        durationSeconds: Number.isFinite(metadataDuration) && metadataDuration > 0 ? metadataDuration : 0,
        keytermCount: keytermFallback ? 0 : requestedKeyterms.length,
        keytermFallback,
        detectedLanguages: extractDetectedLanguages(result),
    }
}

module.exports = {
    transcribeAudioBase64,
    buildTranscriptionOptions,
    formatTranscript,
    extractDetectedLanguages,
    stripDataUrlPrefix,
    isLikelyBadRequestError,
    DEEPGRAM_TRANSCRIPTION_OPTIONS,
}
