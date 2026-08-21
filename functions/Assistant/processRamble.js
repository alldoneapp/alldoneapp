'use strict'

/**
 * Rambler dictation callable: audio → Deepgram transcript → assistant-context LLM cleanup → one Gold
 * charge, one response. The client records a single mic-only clip (max 5 minutes) and inserts the
 * returned text at the cursor.
 *
 * Billing is charged AFTER success (the email draft-reply convention, not transcribeMeeting's
 * charge-before): the deduct is the last step, so no refund path is needed. A cheap balance
 * pre-check bounds the API spend a broke account can trigger.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')

// ~9M base64 chars ≈ 6.75MB of raw audio, safely under the ~10MB callable payload cap while
// allowing a 5-minute Safari AAC recording. The client guards at 8MB of blob before encoding.
const MAX_AUDIO_BASE64_LENGTH = 9 * 1024 * 1024

// Matches the meeting-transcription rate: 0.2 Gold per 10s chunk = 0.02 Gold per second.
const TRANSCRIPTION_GOLD_PER_SECOND = 0.02

// Billing fallback when a model key has no tokensPerGold entry — getTokensPerGold returns undefined
// for unknown keys, and undefined must never turn the charge into NaN (or silently into 0).
const FALLBACK_TOKENS_PER_GOLD = 100

const VALID_TARGET_KINDS = ['title', 'description', 'comment', 'note', 'generic']

const RAMBLER_GOLD_SOURCE = 'rambler'

function normalizeTargetKind(targetKind) {
    return VALID_TARGET_KINDS.includes(targetKind) ? targetKind : 'generic'
}

// Context makes the cleanup better but is never worth failing the ramble over: ANY error here —
// including an unexpected synchronous one — degrades to an uncontextualized cleanup. (The first
// production failure was exactly that: a missing assistantHelper export threw synchronously,
// escaped the per-call catches, and surfaced to the user as "Failed to transcribe audio".)
async function loadCleanupContext({ userData, projectId, userId }) {
    try {
        const { getDefaultAssistantIdForProject } = require('../shared/projectRoutingCommentHelper')
        const {
            getAssistantForChat,
            getProjectDescriptionContextMessage,
            getUserDescriptionContextMessage,
        } = require('./assistantHelper')

        const assistantId = await getDefaultAssistantIdForProject(userData, projectId).catch(() => null)
        const [assistant, projectContext, userContext] = await Promise.all([
            getAssistantForChat(projectId, assistantId, userId).catch(() => null),
            getProjectDescriptionContextMessage(projectId).catch(() => ''),
            getUserDescriptionContextMessage(projectId, userId).catch(() => ''),
        ])
        return { assistant, projectContext, userContext }
    } catch (error) {
        console.error('[processRamble] Context loading failed, cleaning without context:', error)
        return { assistant: null, projectContext: '', userContext: '' }
    }
}

function calculateRambleGoldCost({ durationSeconds, totalTokens, modelKey }) {
    const { getTokensPerGold } = require('./assistantHelper')
    const tokensPerGold = getTokensPerGold(modelKey)
    const effectiveRate = tokensPerGold > 0 ? tokensPerGold : FALLBACK_TOKENS_PER_GOLD
    const transcriptionGold = (durationSeconds > 0 ? durationSeconds : 0) * TRANSCRIPTION_GOLD_PER_SECOND
    const tokenGold = (totalTokens > 0 ? totalTokens : 0) / effectiveRate
    return Math.max(1, Math.round(transcriptionGold + tokenGold))
}

const processRambleSecondGen = onCall(
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

        const { projectId, audio, targetKind, currentText, language } = data || {}
        if (!projectId || typeof projectId !== 'string') {
            throw new HttpsError('invalid-argument', 'projectId is required')
        }
        if (!audio || typeof audio !== 'string') {
            throw new HttpsError('invalid-argument', 'audio is required')
        }
        if (audio.length > MAX_AUDIO_BASE64_LENGTH) {
            throw new HttpsError('invalid-argument', 'Audio recording is too large')
        }

        const userDoc = await admin.firestore().doc(`users/${auth.uid}`).get()
        if (!userDoc.exists) {
            throw new HttpsError('permission-denied', 'User not found')
        }
        const userData = userDoc.data() || {}
        const { getAccessibleProjectIdsFromUserData } = require('./assistantHelper')
        if (!getAccessibleProjectIdsFromUserData(userData).includes(projectId)) {
            throw new HttpsError('permission-denied', 'No access to project')
        }
        // Pre-check bounds API spend for empty accounts; the deduct below stays the real gate. Only
        // a numeric balance rejects, so legacy docs without the field behave as before.
        if (typeof userData.gold === 'number' && userData.gold <= 0) {
            throw new HttpsError('resource-exhausted', 'Insufficient Gold to process dictation.')
        }

        const normalizedTargetKind = normalizeTargetKind(targetKind)

        const startedAt = Date.now()
        const timings = {}

        const { transcribeAudioBase64 } = require('../Notes/deepgramTranscribe')
        // Context loading never rejects (see loadCleanupContext), so a failure here is transcription.
        const contextPromise = loadCleanupContext({ userData, projectId, userId: auth.uid })
        let transcription
        try {
            transcription = await transcribeAudioBase64(audio)
        } catch (error) {
            console.error('[processRamble] Transcription failed:', error)
            throw new HttpsError('internal', 'Failed to transcribe audio')
        }
        timings.transcriptionMs = Date.now() - startedAt
        const contextWaitStartedAt = Date.now()
        const context = await contextPromise
        // Context loads in parallel with transcription; this is only the tail not hidden behind it.
        timings.contextExtraMs = Date.now() - contextWaitStartedAt

        const transcript = transcription.transcript
        if (!transcript) {
            throw new HttpsError('failed-precondition', 'EMPTY_TRANSCRIPT')
        }

        const { cleanupRamble } = require('./ramblerCleanup')
        const cleanupStartedAt = Date.now()
        let text = transcript
        let totalTokens = 0
        let modelKey = null
        let cleanupFailed = false
        try {
            const cleaned = await cleanupRamble({
                transcript,
                targetKind: normalizedTargetKind,
                assistant: context.assistant,
                userData,
                projectContext: context.projectContext,
                userContext: context.userContext,
                currentText: typeof currentText === 'string' ? currentText : '',
                appLanguage: typeof language === 'string' ? language : userData.language || '',
                cacheScope: `${auth.uid}:${projectId}`,
            })
            if (cleaned.text) {
                text = cleaned.text
                totalTokens = cleaned.totalTokens
                modelKey = cleaned.modelKey
            } else {
                cleanupFailed = true
            }
        } catch (error) {
            // The transcript is still valuable — return it raw rather than failing the whole ramble.
            console.error('[processRamble] Cleanup failed, falling back to raw transcript:', error)
            cleanupFailed = true
        }

        timings.cleanupMs = Date.now() - cleanupStartedAt

        const goldCost = calculateRambleGoldCost({
            durationSeconds: transcription.durationSeconds,
            totalTokens,
            modelKey,
        })
        const billingStartedAt = Date.now()
        const { deductGold } = require('../Gold/goldHelper')
        const goldResult = await deductGold(auth.uid, goldCost, {
            source: RAMBLER_GOLD_SOURCE,
            channel: normalizedTargetKind,
            projectId,
        })
        if (!goldResult?.success) {
            throw new HttpsError('resource-exhausted', 'Insufficient Gold to process dictation.')
        }
        timings.billingMs = Date.now() - billingStartedAt
        timings.totalMs = Date.now() - startedAt

        // Raw-vs-cleaned comparison for the dictation vocabulary (PT-4648). This logs COUNTS ONLY —
        // never a word the user dictated — so it is safe to leave on in production. It is the only
        // way to tell the two layers apart: a brand hit already present in `raw` means Deepgram's
        // keyterm prompting caught it, a hit that appears only in `cleaned` means the LLM fixed it,
        // and a confusable form that grows from raw to cleaned means the cleanup introduced the
        // mirror-image error ("all done" rewritten to the brand where it did not belong).
        const { summarizeVocabularyUsage } = require('../shared/transcriptionVocabulary')
        const vocabulary = summarizeVocabularyUsage(transcript, text)

        console.log('[processRamble] timing', {
            ...timings,
            audioSeconds: transcription.durationSeconds,
            payloadChars: audio.length,
            transcriptChars: transcript.length,
            cleanedChars: text.length,
            totalTokens,
            modelKey,
            targetKind: normalizedTargetKind,
            projectId,
            assistantId: context.assistant?.uid || null,
            assistantModel: context.assistant?.model || null,
            // How many keyterms Deepgram actually accepted. A `keytermFallback: true` means the
            // request was rejected and retried without them — the transcript is fine, but the
            // acoustic half of the vocabulary silently did nothing, which is otherwise invisible.
            keytermCount: transcription.keytermCount ?? 0,
            keytermFallback: transcription.keytermFallback === true,
            // Which languages the Nova-3 multilingual model actually detected. `language: 'multi'`
            // covers ten languages; this is how a user dictating outside them becomes visible
            // instead of just quietly getting a worse transcript. Tags only, never content.
            detectedLanguages: transcription.detectedLanguages || [],
            vocabularyTerms: vocabulary.terms,
            vocabularyConfusable: vocabulary.confusable,
        })

        return {
            text,
            transcript,
            goldCharged: goldCost,
            timings,
            ...(cleanupFailed ? { cleanupFailed: true } : {}),
        }
    }
)

module.exports = {
    processRambleSecondGen,
    calculateRambleGoldCost,
    normalizeTargetKind,
    MAX_AUDIO_BASE64_LENGTH,
    TRANSCRIPTION_GOLD_PER_SECOND,
    RAMBLER_GOLD_SOURCE,
    VALID_TARGET_KINDS,
}
