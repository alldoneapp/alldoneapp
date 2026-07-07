'use strict'

const admin = require('firebase-admin')

const { getCachedEnvFunctions, getOpenAIClient } = require('../Assistant/assistantHelper')
const { extractJsonFromText, isGpt5ReasoningModel, mapAssistantModelToOpenAIModel } = require('./gmailPromptClassifier')
const { MAX_LEARNED_RULES_LENGTH, getGmailLabelingStateRef } = require('./gmailLabelingConfig')

// Feedback is free — the cap only bounds abuse. Folding a user correction into the
// learned-rules block is a low-frequency, quality-sensitive judgment task, so it runs on a
// stronger model than the nano first-pass classifier (same rationale as the consistency
// auditor). The nano model intermittently returned empty/unparseable output here
// ("Feedback revision produced no rules text"), silently dropping the correction; a stronger
// model both fixes that and produces better-generalized rules.
const FEEDBACK_DAILY_CAP = 30
const FEEDBACK_REVISION_MODEL = 'MODEL_GPT5_5'

const REVISION_SYSTEM_PROMPT =
    'You maintain a compact list of user feedback rules for an AI email labeling assistant. ' +
    'Given the current rules, the configured labels, one email, the label decision the assistant made, and the ' +
    "user's correction, produce the updated rules list. Merge the new feedback into the existing rules: " +
    'generalize when the feedback matches an existing rule, add a new rule otherwise, and drop rules the feedback ' +
    'contradicts. Rules may include concrete examples (sender domains, subjects) when they help. Keep the list ' +
    `short and specific — plain-text bullet lines starting with "- ", ${MAX_LEARNED_RULES_LENGTH} characters maximum. ` +
    'Return strict JSON only with the single key learnedRules.'

function buildFeedbackDayKey() {
    return new Date().toISOString().slice(0, 10)
}

async function enforceDailyFeedbackCap(userId, projectId) {
    const stateRef = getGmailLabelingStateRef(userId, projectId)
    const dayKey = buildFeedbackDayKey()

    await admin.firestore().runTransaction(async transaction => {
        const snapshot = await transaction.get(stateRef)
        const state = snapshot.exists ? snapshot.data() || {} : {}
        const sameDay = state.feedbackCountDate === dayKey
        const count = sameDay ? Number(state.feedbackCountDay) || 0 : 0

        if (count >= FEEDBACK_DAILY_CAP) {
            const error = new Error('Daily feedback limit reached. Try again tomorrow.')
            error.code = 'FEEDBACK_LIMIT'
            throw error
        }

        transaction.set(stateRef, { feedbackCountDate: dayKey, feedbackCountDay: count + 1 }, { merge: true })
    })
}

function describeLabelOptions(labelDefinitions = []) {
    return labelDefinitions.map(label => ({
        key: label.key,
        gmailLabelName: label.gmailLabelName,
        description: label.description,
    }))
}

async function resolveFeedbackLabelingContext({ userId, userData, projectId, messageId }) {
    const { loadConfig, loadAuditEntry, getGmailLabelingLookupKeys } = require('./serverSideGmailLabelingSync')
    const lookupKeys = getGmailLabelingLookupKeys(userData, projectId)
    let firstConfiguredContext = null

    for (const key of lookupKeys) {
        const configContext = await loadConfig(userId, key)
        if (!configContext.exists) continue
        if (!firstConfiguredContext) firstConfiguredContext = { key, ...configContext }

        const auditEntry = await loadAuditEntry(userId, key, messageId)
        if (auditEntry) return { key, ...configContext, auditEntry }
    }

    if (!firstConfiguredContext) {
        const error = new Error('Enable email labeling before giving label feedback')
        error.code = 'LABELING_NOT_CONFIGURED'
        throw error
    }

    const error = new Error('This email has not been processed by the labeling sync yet')
    error.code = 'AUDIT_ENTRY_NOT_FOUND'
    throw error
}

async function reviseLearnedRules({ currentRules, labelDefinitions, auditEntry, verdict, correctLabel, note }) {
    const envFunctions = getCachedEnvFunctions()
    const openAiKey = envFunctions?.OPEN_AI_KEY
    if (!openAiKey) throw new Error('Feedback revision unavailable: missing OpenAI key')

    const openai = getOpenAIClient(openAiKey)
    const selectedModel = mapAssistantModelToOpenAIModel(FEEDBACK_REVISION_MODEL)

    const userContent =
        `Current rules:\n${currentRules || '(none)'}\n\n` +
        `Configured labels:\n${JSON.stringify(describeLabelOptions(labelDefinitions), null, 2)}\n\n` +
        `Email:\n${JSON.stringify(
            {
                from: auditEntry.from || '',
                subject: auditEntry.subject || '',
                snippet: auditEntry.snippet || '',
                direction: auditEntry.direction || 'incoming',
            },
            null,
            2
        )}\n\n` +
        `Assistant decision:\n${JSON.stringify(
            {
                labelKey: auditEntry.selectedLabelKey || null,
                gmailLabelName: auditEntry.selectedGmailLabelName || null,
                reasoning: auditEntry.reasoning || '',
                needsReply: auditEntry.needsReply === true,
            },
            null,
            2
        )}\n\n` +
        `User feedback:\n${JSON.stringify(
            {
                verdict,
                correctLabel: correctLabel || null,
                note: note || '',
            },
            null,
            2
        )}\n\n` +
        'Return JSON exactly like {"learnedRules":"- Emails from acme.com are always the Acme project label\\n- ..."}.'

    const requestParams = {
        model: selectedModel,
        messages: [
            { role: 'system', content: REVISION_SYSTEM_PROMPT },
            { role: 'user', content: userContent },
        ],
    }
    if (!isGpt5ReasoningModel(FEEDBACK_REVISION_MODEL)) {
        requestParams.temperature = 0.1
    }

    const completion = await openai.chat.completions.create(requestParams)
    const content = completion?.choices?.[0]?.message?.content || ''
    const parsed = extractJsonFromText(content)
    const revised = typeof parsed?.learnedRules === 'string' ? parsed.learnedRules.trim() : ''
    if (!revised) throw new Error('Feedback revision produced no rules text')
    return revised.slice(0, MAX_LEARNED_RULES_LENGTH)
}

// Applies the user's correction in two ways: (1) immediately re-labels the email's Gmail thread so
// it leaves the wrong label section right away, and (2) folds the correction into the config's
// learnedRules block, which resolveEffectiveGmailLabelingConfig appends to the classifier prompt on
// every future sync. The re-label is the user's primary intent, so it runs first and its failure
// propagates; the learned-rules revision is best-effort (a transient LLM hiccup must not undo or
// mask a successful move). Feedback also records an audit event either way.
async function submitEmailLabelFeedback({
    userId,
    userData,
    projectId,
    messageId,
    verdict,
    correctLabel,
    note,
    correctLabelName,
    currentLabelId,
}) {
    const normalizedVerdict = verdict === 'wrong' ? 'wrong' : null
    if (!normalizedVerdict) throw new Error('Unsupported feedback verdict')
    if (!messageId || typeof messageId !== 'string') throw new Error('messageId is required')

    const {
        resolveEffectiveGmailLabelingConfig,
        applyGmailThreadLabelCorrection,
    } = require('./serverSideGmailLabelingSync')
    const { key: feedbackProjectId, config, ref: configRef, auditEntry } = await resolveFeedbackLabelingContext({
        userId,
        userData,
        projectId,
        messageId,
    })

    await enforceDailyFeedbackCap(userId, feedbackProjectId)

    const feedbackEvent = {
        verdict: normalizedVerdict,
        correctLabel: typeof correctLabel === 'string' && correctLabel.trim() ? correctLabel.trim() : null,
        note: typeof note === 'string' ? note.trim().slice(0, 500) : '',
        previousLabelKey: auditEntry.selectedLabelKey || null,
        userId,
        at: admin.firestore.Timestamp.now(),
    }

    const auditRef = getGmailLabelingStateRef(userId, feedbackProjectId).collection('messages').doc(messageId)
    await auditRef.set({ feedback: admin.firestore.FieldValue.arrayUnion(feedbackEvent) }, { merge: true })

    const effectiveConfig = await resolveEffectiveGmailLabelingConfig(config, userData)

    // Re-label the thread when the client sent move context. The target is resolved by NAME server
    // side (any configured label, created if needed). `correctLabelName === null` is an explicit
    // "Inbox only" move; `undefined` means an older client that only wants to record feedback, so
    // we skip the move.
    let relabel = null
    const targetLabelName =
        typeof correctLabelName === 'string' && correctLabelName.trim() ? correctLabelName.trim() : null
    const wantsRelabel = typeof currentLabelId === 'string' && currentLabelId.trim() && correctLabelName !== undefined
    if (wantsRelabel && auditEntry.gmailThreadId) {
        relabel = await applyGmailThreadLabelCorrection(userId, feedbackProjectId, {
            threadId: auditEntry.gmailThreadId,
            currentLabelId: currentLabelId.trim(),
            targetLabelName,
            labelDefinitions: effectiveConfig.labelDefinitions || [],
        })
        await auditRef.set(
            {
                selectedLabelKey: relabel.targetLabelKey,
                selectedGmailLabelName: relabel.targetGmailLabelName,
                applied: relabel.applied,
                archived: relabel.archived,
                correctedByFeedbackAt: admin.firestore.Timestamp.now(),
            },
            { merge: true }
        )
    }

    let learnedRules = typeof config.learnedRules === 'string' ? config.learnedRules : ''
    try {
        learnedRules = await reviseLearnedRules({
            currentRules: learnedRules,
            labelDefinitions: effectiveConfig.labelDefinitions || [],
            auditEntry,
            verdict: normalizedVerdict,
            correctLabel: feedbackEvent.correctLabel,
            note: feedbackEvent.note,
        })
        await configRef.set({ learnedRules, updatedAt: admin.firestore.Timestamp.now() }, { merge: true })
    } catch (error) {
        // Keep the existing rules and the successful re-label; the correction is still recorded in
        // the audit feedback array, so nothing is lost.
        console.warn('[gmailLabeling] Learned-rules revision skipped after feedback:', error?.message || error)
    }

    return {
        learnedRules,
        relabeled: !!relabel,
        targetLabelId: relabel?.targetLabelId || null,
        archived: relabel?.archived || false,
    }
}

module.exports = {
    submitEmailLabelFeedback,
    FEEDBACK_DAILY_CAP,
}
