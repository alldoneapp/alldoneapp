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

// How long the response will wait for an in-flight vocabulary rebuild to land in the cache. The
// rebuild started before transcription, so it has already had the whole transcription + cleanup
// window to finish; this is only the tail. Bounded because a slow workspace must delay the cache,
// never the user's text.
const VOCABULARY_REBUILD_DRAIN_MS = 2000

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
        const projectDoc = await admin.firestore().doc(`projects/${projectId}`).get()
        const projectUserIds =
            projectDoc.exists && Array.isArray(projectDoc.data()?.userIds) ? projectDoc.data().userIds : []
        if (!projectUserIds.includes(auth.uid)) {
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

        // The per-user dictation vocabulary (PT-4648). This is ONE cached document read on the
        // common path — the workspace is never scanned here; see `userVoiceVocabulary.js` for why.
        // It has to resolve BEFORE the Deepgram call, because keyterms are a request parameter.
        // It never rejects: any failure returns an empty dynamic list and the static glossary alone.
        // The whole block is guarded, INCLUDING the requires. `loadCleanupContext` above carries the
        // same wrapper for a reason recorded in its comment: a missing export threw synchronously at
        // module load, escaped the per-call catches, and reached the user as "Failed to transcribe
        // audio". A bare require of three modules is exactly that shape, and the contract here is
        // that the vocabulary can never fail a dictation.
        const vocabularyStartedAt = Date.now()
        let userVocabulary = { terms: [], cacheState: 'unavailable', pendingRebuild: null }
        let keyterms = []
        try {
            const { getUserVocabularyTerms } = require('../shared/userVoiceVocabulary')
            const { getTranscriptionKeyterms, PRODUCT_KEYTERMS } = require('../shared/transcriptionVocabulary')
            userVocabulary = await getUserVocabularyTerms({
                db: admin.firestore(),
                userId: auth.uid,
                userData,
                excludeTerms: PRODUCT_KEYTERMS,
            })
            // The single final list, shared verbatim by the acoustic layer and the cleanup layer.
            keyterms = getTranscriptionKeyterms(userVocabulary.terms)
        } catch (error) {
            console.error('[processRamble] Vocabulary unavailable, dictating without it:', error)
        }
        timings.vocabularyMs = Date.now() - vocabularyStartedAt

        // A stale or cold rebuild runs alongside transcription and cleanup, so by the time this is
        // called it is almost always already done. It still has to be AWAITED: Cloud Run may freeze
        // the container once the response is returned, and a rebuild that never finishes is a cache
        // that stays cold forever — the user would get the static glossary on every dictation and
        // nothing would ever say why. Bounded, because finishing the response matters more.
        //
        // Idempotent, and reached from the failure paths too. The one that matters is
        // EMPTY_TRANSCRIPT: per AT-2357 that is the documented symptom of a silent microphone, so
        // it repeats for the same user many times in a row — and each attempt would otherwise pay
        // for a full workspace scan, have it killed by the freeze, and re-pay the cold-build wait
        // on the next try, indefinitely.
        let rebuildDrained = false
        const drainVocabularyRebuild = async () => {
            if (rebuildDrained || !userVocabulary.pendingRebuild) return
            rebuildDrained = true
            const rebuildStartedAt = Date.now()
            await Promise.race([
                userVocabulary.pendingRebuild,
                new Promise(resolve => setTimeout(resolve, VOCABULARY_REBUILD_DRAIN_MS)),
            ])
            timings.vocabularyRebuildWaitMs = Date.now() - rebuildStartedAt
        }
        const failAfterDraining = async (code, message) => {
            await drainVocabularyRebuild()
            throw new HttpsError(code, message)
        }

        let transcription
        // Measured from here, so the vocabulary lookup above is not billed to Deepgram. Sharing
        // `startedAt` made `transcriptionMs` silently include `vocabularyMs` — up to a four-second
        // cold build attributed to the wrong subsystem, with `vocabularyMs` sitting next to it
        // looking like an independent measurement.
        const transcriptionStartedAt = Date.now()
        try {
            transcription = await transcribeAudioBase64(audio, keyterms.length ? { keyterms } : undefined)
        } catch (error) {
            console.error('[processRamble] Transcription failed:', error)
            await failAfterDraining('internal', 'Failed to transcribe audio')
        }
        timings.transcriptionMs = Date.now() - transcriptionStartedAt
        const contextWaitStartedAt = Date.now()
        const context = await contextPromise
        // Context loads in parallel with transcription; this is only the tail not hidden behind it.
        timings.contextExtraMs = Date.now() - contextWaitStartedAt

        const transcript = transcription.transcript
        if (!transcript) {
            await failAfterDraining('failed-precondition', 'EMPTY_TRANSCRIPT')
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
                vocabularyTerms: keyterms,
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
            // Cleanup model the token half of the ramble price came from (AT-2487).
            model: modelKey || '',
        })
        if (!goldResult?.success) {
            await failAfterDraining('resource-exhausted', 'Insufficient Gold to process dictation.')
        }
        timings.billingMs = Date.now() - billingStartedAt
        timings.totalMs = Date.now() - startedAt

        // Raw-vs-cleaned comparison for the dictation vocabulary (PT-4648). This logs COUNTS ONLY —
        // never a word the user dictated — so it is safe to leave on in production. It is the only
        // way to tell the two layers apart: a brand hit already present in `raw` means Deepgram's
        // keyterm prompting caught it, a hit that appears only in `cleaned` means the LLM fixed it,
        // and a confusable form that grows from raw to cleaned means the cleanup introduced the
        // mirror-image error ("all done" rewritten to the brand where it did not belong).
        //
        // Guarded, and the guard matters more here than anywhere else in this file: this runs AFTER
        // `deductGold`, so an exception would charge the user and then hand them an `internal` error
        // instead of the text they just paid for.
        let vocabulary = { terms: {}, confusable: {}, dynamic: null }
        try {
            const { summarizeVocabularyUsage } = require('../shared/transcriptionVocabulary')
            vocabulary = summarizeVocabularyUsage(transcript, text, keyterms)
        } catch (error) {
            console.error('[processRamble] Vocabulary summary failed:', error)
        }

        await drainVocabularyRebuild()

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
            // The per-user half (PT-4648). `cacheState` says which path this dictation took —
            // `fresh` is the steady state, a persistent `cold`/`unavailable` means the rebuild
            // never lands and the personalization is silently doing nothing. `dynamic` is COUNTS
            // ONLY: these terms are contact names and must never be logged by name.
            vocabularyCacheState: userVocabulary.cacheState,
            vocabularyDynamicCount: userVocabulary.terms.length,
            vocabularyDynamic: vocabulary.dynamic,
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
