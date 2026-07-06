'use strict'

const { getCachedEnvFunctions, getOpenAIClient, normalizeModelKey } = require('../Assistant/assistantHelper')
const {
    DEFAULT_CONFIDENCE_THRESHOLD,
    DEFAULT_GMAIL_LABELING_MODEL,
    DEFAULT_GMAIL_CONSISTENCY_MODEL,
} = require('./gmailLabelingConfig')
const { reasoningReferencesDifferentOption } = require('../shared/reasoningConsistency')

const GMAIL_CLASSIFIER_SYSTEM_PROMPT =
    'You classify Gmail messages into exactly one configured label or no match. Messages may be incoming or outgoing. Return strict JSON only with keys matched, labelKey, confidence, reasoning, needsReply. Never invent labels. Confidence must be a number between 0 and 1 and must describe confidence in the returned decision. needsReply is true only when the email is an incoming personal message that expects a reply from the recipient (a direct question, request, decision, or action addressed to them). Newsletters, notifications, receipts, marketing, calendar invites, and automated or no-reply senders never need a reply. Outgoing messages never need a reply. needsReply is independent of whether a label matched.'

// Second-pass auditor used when the first-pass reasoning looks inconsistent with the
// label it chose (e.g. it chose the "Bechtle" label but the reasoning describes "JTL").
const GMAIL_CONSISTENCY_SYSTEM_PROMPT =
    'You audit a Gmail label classification for self-consistency. You are given the email, the configured labels, and a first-pass decision (its chosen label, confidence, and reasoning). Decide the FINAL best label. If the email and the reasoning actually point to a different configured label than the one chosen, switch to the correct label. If no configured label clearly matches, return no match. The reasoning you return MUST justify and be consistent with the final label you choose. Return strict JSON only with keys matched, labelKey, confidence, reasoning, needsReply. Never invent labels. Confidence must be a number between 0 and 1. needsReply is true only when the email is an incoming personal message that expects a reply from the recipient; newsletters, notifications, receipts, marketing, and automated or no-reply senders never need a reply, and outgoing messages never need a reply.'

const GPT5_REASONING_MODEL_KEYS = new Set([
    'MODEL_GPT5_1',
    'MODEL_GPT5_2',
    'MODEL_GPT5_5',
    'MODEL_GPT5_4_MINI',
    'MODEL_GPT5_4_NANO',
])

function mapAssistantModelToOpenAIModel(modelKey) {
    const normalizedKey = normalizeModelKey(modelKey || DEFAULT_GMAIL_LABELING_MODEL)
    if (normalizedKey === 'MODEL_GPT3_5') return 'gpt-3.5-turbo'
    if (normalizedKey === 'MODEL_GPT4') return 'gpt-4'
    if (normalizedKey === 'MODEL_GPT4O') return 'gpt-4o'
    if (normalizedKey === 'MODEL_GPT5_1') return 'gpt-5.1'
    if (normalizedKey === 'MODEL_GPT5_5') return 'gpt-5.5'
    if (normalizedKey === 'MODEL_GPT5_4_MINI') return 'gpt-5.4-mini'
    if (normalizedKey === 'MODEL_GPT5_4_NANO') return 'gpt-5.4-nano'
    return 'gpt-5.2'
}

function isGpt5ReasoningModel(modelKey) {
    return GPT5_REASONING_MODEL_KEYS.has(normalizeModelKey(modelKey || DEFAULT_GMAIL_LABELING_MODEL))
}

function extractJsonFromText(text = '') {
    if (!text || typeof text !== 'string') return null

    const fencedMatch = text.match(/```json\s*([\s\S]*?)```/i)
    if (fencedMatch) {
        try {
            return JSON.parse(fencedMatch[1])
        } catch (error) {}
    }

    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end !== -1 && end > start) {
        try {
            return JSON.parse(text.slice(start, end + 1))
        } catch (error) {}
    }

    return null
}

function coerceClassifierResult(result, validLabelKeys = [], confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD) {
    const labelKey = typeof result?.labelKey === 'string' ? result.labelKey.trim() : null
    const confidence = Number.isFinite(result?.confidence) ? Number(result.confidence) : 0
    const reasoning = typeof result?.reasoning === 'string' ? result.reasoning.trim() : ''
    const matched = !!result?.matched && !!labelKey && validLabelKeys.includes(labelKey)
    // needsReply is independent of the label decision, so it survives the no-match branch.
    const needsReply = result?.needsReply === true
    const usage = result?.usage || null

    if (!matched || confidence < confidenceThreshold) {
        return {
            matched: false,
            labelKey: null,
            confidence,
            reasoning: reasoning || 'No configured label clearly matched.',
            needsReply,
            usage,
        }
    }

    return {
        matched: true,
        labelKey,
        confidence,
        reasoning,
        needsReply,
        usage,
    }
}

function normalizeConfidenceThreshold(value) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 1) : DEFAULT_CONFIDENCE_THRESHOLD
}

function buildDecisionGuidance(confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD) {
    return [
        `Configured confidence threshold: ${confidenceThreshold}.`,
        `Return matched:true only when the best configured label's confidence is at least ${confidenceThreshold}.`,
        'For matched:true, confidence means confidence that the returned labelKey is the correct configured label.',
        'For matched:false, confidence means confidence that no configured label matches.',
        'Use high no-match confidence only when the reasoning explains why the email is unrelated to every configured label.',
        'Do not return matched:false when your reasoning identifies a configured label, project name, client name, sender domain, or project-specific link. In that case return matched:true with that labelKey.',
        'Explicit project names, client names, sender domains, subjects, body references, deadlines, action requests, deliverables, or links to project-specific Alldone URLs are strong match evidence.',
    ].join('\n')
}

function noMatchReasoningSuggestsPositiveMatch(reasoning = '') {
    const text = String(reasoning || '').toLowerCase()
    if (!text.trim()) return false

    return [
        /\bexplicitly (titled|mentions|references|names)\b/,
        /\b(sender|email) is from\b/,
        /\bbody confirms\b/,
        /\blink points to\b/,
        /\bclearly (belongs|relates|matches|fits|aligns)\b/,
        /\baligns best with\b/,
        /\bbest (fits|matches|aligns with)\b/,
        /\b(strong|specific) (match|evidence)\b/,
        /\bproject-specific\b.*\b(link|url|reference)\b/,
        /\bunder the\b.*\bproject id\b/,
    ].some(pattern => pattern.test(text))
}

function extractUsage(completion) {
    if (!completion?.usage) return null
    return {
        totalTokens: Number.isFinite(completion.usage.total_tokens) ? completion.usage.total_tokens : 0,
        promptTokens: Number.isFinite(completion.usage.prompt_tokens) ? completion.usage.prompt_tokens : 0,
        completionTokens: Number.isFinite(completion.usage.completion_tokens) ? completion.usage.completion_tokens : 0,
    }
}

function combineUsage(a, b) {
    if (!a) return b || null
    if (!b) return a || null
    return {
        totalTokens: (a.totalTokens || 0) + (b.totalTokens || 0),
        promptTokens: (a.promptTokens || 0) + (b.promptTokens || 0),
        completionTokens: (a.completionTokens || 0) + (b.completionTokens || 0),
    }
}

async function runClassifierCompletion(openai, { selectedModel, isReasoningModel, systemPrompt, userContent }) {
    const requestParams = {
        model: selectedModel,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
        ],
    }

    // GPT-5 reasoning models use the provider default reasoning effort (medium).
    // Custom temperature isn't supported on GPT-5 reasoning variants, so we skip it
    // there. Non-reasoning models keep the low-temperature deterministic setting.
    if (!isReasoningModel) {
        requestParams.temperature = 0.1
    }

    const completion = await openai.chat.completions.create(requestParams)
    const content = completion?.choices?.[0]?.message?.content || ''
    return {
        parsed: extractJsonFromText(content),
        usage: extractUsage(completion),
    }
}

// Adapt the configured Gmail labels to the shared option shape (key + searchable names).
function buildConsistencyOptionsFromLabels(labelDefinitions = []) {
    return (Array.isArray(labelDefinitions) ? labelDefinitions : [])
        .filter(label => label && label.key)
        .map(label => ({ key: label.key, names: [label.gmailLabelName || '', label.key] }))
}

async function verifyClassificationConsistency(
    openai,
    {
        selectedModel,
        isReasoningModel,
        config,
        message,
        labelDefinitions,
        validLabelKeys,
        confidenceThreshold,
        firstResult,
    }
) {
    const userContent =
        `Prompt:\n${config.prompt}\n\n` +
        `Configured labels:\n${JSON.stringify(labelDefinitions, null, 2)}\n\n` +
        `Email:\n${JSON.stringify(message, null, 2)}\n\n` +
        `Decision rules:\n${buildDecisionGuidance(confidenceThreshold)}\n\n` +
        `First-pass decision:\n${JSON.stringify(
            {
                matched: firstResult.matched,
                labelKey: firstResult.labelKey,
                confidence: firstResult.confidence,
                reasoning: firstResult.reasoning,
            },
            null,
            2
        )}\n\n` +
        'Re-check the decision. If the email and reasoning actually point to a different configured label, switch to it. ' +
        'If no configured label clearly matches, return matched:false. The reasoning must be consistent with the final labelKey you choose. ' +
        'Return JSON exactly like {"matched":true,"labelKey":"newsletter","confidence":0.92,"reasoning":"...","needsReply":false}.'

    const { parsed, usage } = await runClassifierCompletion(openai, {
        selectedModel,
        isReasoningModel,
        systemPrompt: GMAIL_CONSISTENCY_SYSTEM_PROMPT,
        userContent,
    })

    const verified = coerceClassifierResult({ ...parsed }, validLabelKeys, confidenceThreshold)
    return { verified, usage, parsed }
}

async function classifyGmailMessage({ config, message }) {
    const envFunctions = getCachedEnvFunctions()
    const openAiKey = envFunctions?.OPEN_AI_KEY
    const labelDefinitions = Array.isArray(config?.labelDefinitions) ? config.labelDefinitions : []
    const validLabelKeys = labelDefinitions.map(label => label.key)
    const confidenceThreshold = normalizeConfidenceThreshold(config?.confidenceThreshold)

    if (!openAiKey || labelDefinitions.length === 0) {
        return {
            matched: false,
            labelKey: null,
            confidence: 0,
            reasoning: 'Classifier unavailable or no labels configured.',
            needsReply: false,
        }
    }

    const openai = getOpenAIClient(openAiKey)
    const selectedModel = mapAssistantModelToOpenAIModel(config?.model)
    const isReasoningModel = isGpt5ReasoningModel(config?.model)

    // The self-consistency auditor (second pass) runs on a stronger, independent model than the
    // first pass. Re-judging with the same (small) model just reproduces the first pass's error;
    // a different high-capability model gives genuinely uncorrelated judgement. Per-config override
    // via `consistencyModel` is honored for tuning without redeploy; otherwise the strong default.
    const auditModelKey = config?.consistencyModel || DEFAULT_GMAIL_CONSISTENCY_MODEL
    const auditModel = mapAssistantModelToOpenAIModel(auditModelKey)
    const auditIsReasoningModel = isGpt5ReasoningModel(auditModelKey)

    const firstUserContent =
        `Prompt:\n${config.prompt}\n\n` +
        `Configured labels:\n${JSON.stringify(labelDefinitions, null, 2)}\n\n` +
        `Email:\n${JSON.stringify(message, null, 2)}\n\n` +
        `Decision rules:\n${buildDecisionGuidance(confidenceThreshold)}\n\n` +
        'Return JSON exactly like {"matched":true,"labelKey":"newsletter","confidence":0.92,"reasoning":"...","needsReply":false}. If no label matches clearly, return {"matched":false,"labelKey":null,"confidence":0.2,"reasoning":"...","needsReply":false}'

    const { parsed, usage: firstUsage } = await runClassifierCompletion(openai, {
        selectedModel,
        isReasoningModel,
        systemPrompt: GMAIL_CLASSIFIER_SYSTEM_PROMPT,
        userContent: firstUserContent,
    })

    const firstResult = coerceClassifierResult({ ...parsed, usage: firstUsage }, validLabelKeys, confidenceThreshold)

    // Self-consistency check: when the model's reasoning references a configured label that is
    // inconsistent with the normalized outcome, or the model reports zero confidence, run a
    // stronger second pass to reconcile. This covers matched-but-wrong-key,
    // no-match-with-project-reasoning, and unusable zero-confidence results.
    const hasZeroConfidence = firstResult.confidence === 0
    const shouldInspectReasoning =
        firstResult.matched || hasZeroConfidence || noMatchReasoningSuggestsPositiveMatch(firstResult.reasoning)
    const crossReference = shouldInspectReasoning
        ? reasoningReferencesDifferentOption(
              firstResult.reasoning,
              firstResult.labelKey,
              buildConsistencyOptionsFromLabels(labelDefinitions)
          )
        : null
    const consistencyTrigger = crossReference || (hasZeroConfidence ? { type: 'zero_confidence' } : null)
    if (!consistencyTrigger) {
        return firstResult
    }

    try {
        const { verified, usage: verifyUsage, parsed: verifyParsed } = await verifyClassificationConsistency(openai, {
            selectedModel: auditModel,
            isReasoningModel: auditIsReasoningModel,
            config,
            message,
            labelDefinitions,
            validLabelKeys,
            confidenceThreshold,
            firstResult,
        })

        // If the auditor produced no usable JSON, treat the check as inconclusive and keep the
        // first-pass match rather than letting a transient glitch downgrade it to no-match.
        // We still fold in the spent tokens so the user is billed for the call that happened.
        if (!verifyParsed || typeof verifyParsed !== 'object') {
            return {
                ...firstResult,
                usage: combineUsage(firstResult.usage, verifyUsage),
                consistencyCheck: {
                    ran: true,
                    corrected: false,
                    inconclusive: true,
                    trigger: consistencyTrigger,
                    auditModel,
                    originalLabelKey: firstResult.labelKey,
                    originalConfidence: firstResult.confidence,
                },
            }
        }

        const corrected = verified.labelKey !== firstResult.labelKey || verified.matched !== firstResult.matched

        if (corrected) {
            console.warn('[gmailLabeling] Consistency check corrected Gmail classification', {
                originalLabelKey: firstResult.labelKey,
                correctedLabelKey: verified.labelKey,
                correctedMatched: verified.matched,
                trigger: consistencyTrigger,
                auditModel,
            })
        }

        return {
            ...verified,
            usage: combineUsage(firstResult.usage, verifyUsage),
            consistencyCheck: {
                ran: true,
                corrected,
                trigger: consistencyTrigger,
                auditModel,
                originalLabelKey: firstResult.labelKey,
                originalConfidence: firstResult.confidence,
            },
        }
    } catch (error) {
        console.warn('[gmailLabeling] Gmail classification consistency check failed; keeping first pass', {
            labelKey: firstResult.labelKey,
            error: error.message,
        })
        return firstResult
    }
}

module.exports = {
    classifyGmailMessage,
    extractJsonFromText,
    isGpt5ReasoningModel,
    mapAssistantModelToOpenAIModel,
    GMAIL_CLASSIFIER_SYSTEM_PROMPT,
    GMAIL_CONSISTENCY_SYSTEM_PROMPT,
}
