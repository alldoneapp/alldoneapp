'use strict'

const { getCachedEnvFunctions, getOpenAIClient, normalizeModelKey } = require('../Assistant/assistantHelper')
const {
    DEFAULT_CONFIDENCE_THRESHOLD,
    DEFAULT_GMAIL_LABELING_MODEL,
    DEFAULT_GMAIL_CONSISTENCY_MODEL,
    slugifyLabelKey,
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

// Resolve the model-returned labelKey to a configured label key. Models sometimes return
// the Gmail label NAME ("Privat", "Ads") or a differently-cased/spaced variant of the key
// instead of the exact configured key ("privat", "urgent_client"). An exact-match-only
// lookup silently turned those into no-match results even though the reasoning argued for
// the label, so the email ended up with an explanation but no label applied.
function resolveConfiguredLabelKey(rawLabelKey, labelDefinitions = []) {
    const raw = typeof rawLabelKey === 'string' ? rawLabelKey.trim() : ''
    if (!raw) return null

    const definitions = (Array.isArray(labelDefinitions) ? labelDefinitions : []).filter(
        label => label && typeof label.key === 'string' && label.key
    )

    const exactKey = definitions.find(label => label.key === raw)
    if (exactKey) return exactKey.key

    // Config validation rejects keys/label names that collide case-insensitively, so the
    // relaxed lookups below are unambiguous.
    const lookup = raw.toLowerCase()
    const caseInsensitiveKey = definitions.find(label => label.key.toLowerCase() === lookup)
    if (caseInsensitiveKey) return caseInsensitiveKey.key

    const byLabelName = definitions.find(
        label => typeof label.gmailLabelName === 'string' && label.gmailLabelName.trim().toLowerCase() === lookup
    )
    if (byLabelName) return byLabelName.key

    // "JTL Software" -> "jtl_software"
    const slug = slugifyLabelKey(raw)
    if (slug) {
        const bySlug = definitions.find(
            label => slugifyLabelKey(label.key) === slug || slugifyLabelKey(label.gmailLabelName || '') === slug
        )
        if (bySlug) return bySlug.key
    }

    return null
}

function coerceClassifierResult(result, labelDefinitions = [], confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD) {
    const rawLabelKey = typeof result?.labelKey === 'string' && result.labelKey.trim() ? result.labelKey.trim() : null
    const labelKey = resolveConfiguredLabelKey(rawLabelKey, labelDefinitions)
    const rawMatched = !!result?.matched
    const confidence = Number.isFinite(result?.confidence) ? Number(result.confidence) : 0
    const reasoning = typeof result?.reasoning === 'string' ? result.reasoning.trim() : ''
    const matched = rawMatched && !!labelKey
    // needsReply is independent of the label decision, so it survives the no-match branch.
    const needsReply = result?.needsReply === true
    const usage = result?.usage || null

    // rawLabelKey/rawMatched preserve the model's pre-coercion decision so demotions are
    // diagnosable from logs and can trigger the consistency audit.
    if (!matched || confidence < confidenceThreshold) {
        return {
            matched: false,
            labelKey: null,
            rawLabelKey,
            rawMatched,
            confidence,
            reasoning: reasoning || 'No configured label clearly matched.',
            needsReply,
            usage,
        }
    }

    return {
        matched: true,
        labelKey,
        rawLabelKey,
        rawMatched,
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
        // Assertive "this deserves label X" phrasings seen in production no-match results,
        // e.g. "so it should be labeled as Privat rather than Ads" and
        // "This fits the Privat label guidance for house/home/apartment search alerts".
        // Deliberately NOT a bare label-name mention: no-match reasonings legitimately name
        // labels while ruling them out ("does not mention Privat or JTL Software").
        /\b(should|would|could|ought to|deserves? to) be labell?ed\b/,
        /\blabell?ed as\b/,
        /\blabel (it|this|the (email|message)) as\b/,
        /\bfits the\b[^.!?]*\blabel\b/,
        /\bmatches the\b[^.!?]*\blabel\b/,
        /\bbelongs (to|under|in)\b/,
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

// Optional "who is the user" section — helps judge relevance (cold outreach vs a real
// business opportunity, which newsletters the user plausibly subscribed to).
function buildUserDescriptionSection(config = {}) {
    const description = typeof config.userDescription === 'string' ? config.userDescription.trim() : ''
    return description ? `About the user (context for judging relevance):\n${description}\n\n` : ''
}

async function verifyClassificationConsistency(
    openai,
    { selectedModel, isReasoningModel, config, message, labelDefinitions, confidenceThreshold, firstResult }
) {
    const userContent =
        `Prompt:\n${config.prompt}\n\n` +
        buildUserDescriptionSection(config) +
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

    const verified = coerceClassifierResult({ ...parsed }, labelDefinitions, confidenceThreshold)
    return { verified, usage, parsed }
}

async function classifyGmailMessage({ config, message }) {
    const envFunctions = getCachedEnvFunctions()
    const openAiKey = envFunctions?.OPEN_AI_KEY
    const labelDefinitions = Array.isArray(config?.labelDefinitions) ? config.labelDefinitions : []
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
        buildUserDescriptionSection(config) +
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

    const firstResult = coerceClassifierResult({ ...parsed, usage: firstUsage }, labelDefinitions, confidenceThreshold)

    // Surface demotions: the model named a label (or claimed a match) but the normalized
    // outcome is no-match — an unresolvable key, a below-threshold confidence, or a
    // self-contradictory raw output. Without this log the raw decision is unrecoverable.
    if (!firstResult.matched && (firstResult.rawLabelKey || firstResult.rawMatched)) {
        console.warn('[gmailLabeling] First-pass classifier result demoted to no-match', {
            rawMatched: firstResult.rawMatched,
            rawLabelKey: firstResult.rawLabelKey,
            confidence: firstResult.confidence,
            confidenceThreshold,
        })
    }

    // Self-consistency check: when the model's reasoning references a configured label that is
    // inconsistent with the normalized outcome, the model reports zero confidence, or a raw
    // labelKey was demoted to no-match, run a stronger second pass to reconcile. This covers
    // matched-but-wrong-key, no-match-with-project-reasoning, and unusable zero-confidence
    // results.
    const hasZeroConfidence = firstResult.confidence === 0
    const shouldInspectReasoning =
        firstResult.matched ||
        hasZeroConfidence ||
        !!firstResult.rawLabelKey ||
        noMatchReasoningSuggestsPositiveMatch(firstResult.reasoning)
    const crossReference = shouldInspectReasoning
        ? reasoningReferencesDifferentOption(
              firstResult.reasoning,
              firstResult.labelKey,
              buildConsistencyOptionsFromLabels(labelDefinitions)
          )
        : null
    const demotedRawLabelKey =
        !firstResult.matched && firstResult.rawLabelKey
            ? { type: 'demoted_label_key', rawLabelKey: firstResult.rawLabelKey }
            : null
    const consistencyTrigger =
        crossReference || (hasZeroConfidence ? { type: 'zero_confidence' } : null) || demotedRawLabelKey
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
                    originalRawLabelKey: firstResult.rawLabelKey || null,
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
                originalRawLabelKey: firstResult.rawLabelKey || null,
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
