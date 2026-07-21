'use strict'

const {
    buildOpenAiPromptCacheKey,
    getCachedEnvFunctions,
    getOpenAiCacheUsage,
    getOpenAIClient,
    logOpenAiCacheUsage,
    normalizeModelKey,
} = require('../Assistant/assistantHelper')
const {
    DEFAULT_CONFIDENCE_THRESHOLD,
    DEFAULT_GMAIL_LABELING_MODEL,
    DEFAULT_GMAIL_CONSISTENCY_MODEL,
    GMAIL_LABELING_PROMPT_MODE_DEFAULT,
    slugifyLabelKey,
} = require('./gmailLabelingConfig')
const { reasoningReferencesDifferentOption } = require('../shared/reasoningConsistency')

const GMAIL_CLASSIFIER_SYSTEM_PROMPT =
    'You classify Gmail messages into exactly one configured label or no match, and classify the follow-up as actionable or informational. Messages may be incoming or outgoing. Return strict JSON only with keys matched, labelKey, followUpType, confidence, reasoning. Never invent labels. followUpType must always be either "actionable" or "informational". Actionable means the email creates a concrete action, responsibility, decision, deadline, or follow-up for the user. Informational means it does not create a concrete action for the user, including useful updates, notifications, newsletters, automated messages, and irrelevant email. Confidence must be a number between 0 and 1 and must describe confidence in the returned decision.'

// Second-pass auditor used when the first-pass reasoning looks inconsistent with the
// label it chose (e.g. it chose the "Bechtle" label but the reasoning describes "JTL").
const GMAIL_CONSISTENCY_SYSTEM_PROMPT =
    'You audit a Gmail classification for self-consistency. You are given the email, configured labels, and a first-pass decision including its label and follow-up type. Decide the FINAL best label and whether the email is actionable or informational. If the email and reasoning point to a different configured label, switch to it. Use matched:false only when no configured label is suitable. The reasoning MUST justify both the final label and follow-up type. Return strict JSON only with keys matched, labelKey, followUpType, confidence, reasoning. Never invent labels. followUpType must be either "actionable" or "informational".'

const GPT5_REASONING_MODEL_KEYS = new Set([
    'MODEL_GPT5_6_SOL',
    'MODEL_GPT5_6_TERRA',
    'MODEL_GPT5_6_LUNA',
    'MODEL_GPT5_1',
    'MODEL_GPT5_2',
    'MODEL_GPT5_5',
    'MODEL_GPT5_4_MINI',
    'MODEL_GPT5_4_NANO',
])
const MAX_CLASSIFIER_LABEL_DESCRIPTION_CHARS = 900
const MAX_CLASSIFIER_BODY_CHARS = 12000

function mapAssistantModelToOpenAIModel(modelKey) {
    const normalizedKey = normalizeModelKey(modelKey || DEFAULT_GMAIL_LABELING_MODEL)
    if (normalizedKey === 'MODEL_GPT3_5') return 'gpt-3.5-turbo'
    if (normalizedKey === 'MODEL_GPT4') return 'gpt-4'
    if (normalizedKey === 'MODEL_GPT4O') return 'gpt-4o'
    if (normalizedKey === 'MODEL_GPT5_1') return 'gpt-5.1'
    if (normalizedKey === 'MODEL_GPT5_5') return 'gpt-5.5'
    if (normalizedKey === 'MODEL_GPT5_6_SOL') return 'gpt-5.6-sol'
    if (normalizedKey === 'MODEL_GPT5_6_TERRA') return 'gpt-5.6-terra'
    if (normalizedKey === 'MODEL_GPT5_6_LUNA') return 'gpt-5.6-luna'
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
    const followUpType = result?.followUpType === 'actionable' ? 'actionable' : 'informational'
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
            followUpType,
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
        followUpType,
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
    const cacheUsage = getOpenAiCacheUsage(completion.usage)
    return {
        totalTokens: Number.isFinite(completion.usage.total_tokens) ? completion.usage.total_tokens : 0,
        promptTokens: Number.isFinite(completion.usage.prompt_tokens) ? completion.usage.prompt_tokens : 0,
        completionTokens: Number.isFinite(completion.usage.completion_tokens) ? completion.usage.completion_tokens : 0,
        cachedTokens: cacheUsage.cachedTokens,
        cacheWriteTokens: cacheUsage.cacheWriteTokens,
    }
}

function combineUsage(a, b) {
    if (!a) return b || null
    if (!b) return a || null
    return {
        totalTokens: (a.totalTokens || 0) + (b.totalTokens || 0),
        promptTokens: (a.promptTokens || 0) + (b.promptTokens || 0),
        completionTokens: (a.completionTokens || 0) + (b.completionTokens || 0),
        cachedTokens: (a.cachedTokens || 0) + (b.cachedTokens || 0),
        cacheWriteTokens: (a.cacheWriteTokens || 0) + (b.cacheWriteTokens || 0),
    }
}

async function runClassifierCompletion(
    openai,
    {
        selectedModel,
        isReasoningModel,
        systemPrompt,
        staticUserContent,
        dynamicUserContent,
        cacheKey,
        cacheRoute,
        enableCacheWrite = true,
    }
) {
    const supportsExplicitCaching = selectedModel.startsWith('gpt-5.6')
    const usesExplicitCacheBreakpoint = supportsExplicitCaching && enableCacheWrite
    const requestParams = {
        model: selectedModel,
        messages: [
            { role: 'system', content: systemPrompt },
            {
                role: 'user',
                content: usesExplicitCacheBreakpoint
                    ? [
                          {
                              type: 'text',
                              text: staticUserContent,
                              prompt_cache_breakpoint: { mode: 'explicit' },
                          },
                      ]
                    : staticUserContent,
            },
            { role: 'user', content: dynamicUserContent },
        ],
        prompt_cache_key: cacheKey,
    }

    if (supportsExplicitCaching) {
        requestParams.prompt_cache_options = { mode: 'explicit', ttl: '30m' }
    }

    // GPT-5 reasoning models use the provider default reasoning effort (medium).
    // Custom temperature isn't supported on GPT-5 reasoning variants, so we skip it
    // there. Non-reasoning models keep the low-temperature deterministic setting.
    if (!isReasoningModel) {
        requestParams.temperature = 0.1
    }

    const completion = await openai.chat.completions.create(requestParams)
    logOpenAiCacheUsage({
        usage: completion?.usage,
        route: cacheRoute,
        model: selectedModel,
        cacheKey,
        cacheMode: supportsExplicitCaching
            ? usesExplicitCacheBreakpoint
                ? 'explicit'
                : 'explicit-no-breakpoint'
            : 'automatic',
    })
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

function buildClassifierLabelDefinitions(labelDefinitions = []) {
    return (Array.isArray(labelDefinitions) ? labelDefinitions : [])
        .filter(label => label && label.key)
        .map(label => ({
            key: label.key,
            gmailLabelName: label.gmailLabelName || '',
            description: String(label.description || '').slice(0, MAX_CLASSIFIER_LABEL_DESCRIPTION_CHARS),
        }))
        .sort((a, b) => String(a.key).localeCompare(String(b.key)))
}

function compactClassifierBody(body = '') {
    const normalizedBody = String(body || '')
    if (normalizedBody.length <= MAX_CLASSIFIER_BODY_CHARS) return normalizedBody
    return `${normalizedBody.slice(0, MAX_CLASSIFIER_BODY_CHARS)}\n[Older email content truncated]`
}

function buildClassifierMessage(message = {}) {
    return {
        direction: message.direction || '',
        from: message.from || '',
        to: message.to || '',
        cc: message.cc || '',
        bcc: message.bcc || '',
        date: message.date || '',
        subject: message.subject || '',
        snippet: message.snippet || '',
        bodyText: compactClassifierBody(message.bodyText || message.body || ''),
        inReplyTo: message.inReplyTo || '',
        references: message.references || '',
        gmailLabelIds: Array.isArray(message.gmailLabelIds)
            ? message.gmailLabelIds
            : Array.isArray(message.labelIds)
            ? message.labelIds
            : [],
        listUnsubscribe: message.listUnsubscribe || '',
    }
}

function buildAuditLabelDefinitions(labelDefinitions, firstResult, crossReference, consistencyTrigger) {
    if (consistencyTrigger?.type === 'zero_confidence') return labelDefinitions

    const candidateKeys = new Set()
    if (firstResult?.labelKey) candidateKeys.add(firstResult.labelKey)
    if (crossReference?.otherKey) candidateKeys.add(crossReference.otherKey)
    if (firstResult?.rawLabelKey) {
        const resolvedRawKey = resolveConfiguredLabelKey(firstResult.rawLabelKey, labelDefinitions)
        if (resolvedRawKey) candidateKeys.add(resolvedRawKey)
    }

    if (candidateKeys.size === 0) return labelDefinitions
    const candidates = labelDefinitions.filter(label => candidateKeys.has(label.key))
    return candidates.length > 0 ? candidates : labelDefinitions
}

// Optional "who is the user" section — helps judge relevance (cold outreach vs a real
// business opportunity, which newsletters the user plausibly subscribed to).
function buildUserDescriptionSection(config = {}) {
    const description = typeof config.userDescription === 'string' ? config.userDescription.trim() : ''
    return description ? `About the user (context for judging relevance):\n${description}\n\n` : ''
}

function buildNoMatchResponseGuidance(config = {}) {
    if (config.promptMode === GMAIL_LABELING_PROMPT_MODE_DEFAULT) {
        return 'If the email is work-relevant but no specific non-default project label matches clearly, use the default project label. Use matched:false only when it does not relate to any configured project or Ads label.'
    }

    return 'Use matched:false only when the prompt and configured labels do not provide a suitable label.'
}

async function verifyClassificationConsistency(
    openai,
    { selectedModel, isReasoningModel, config, message, labelDefinitions, confidenceThreshold, firstResult }
) {
    const staticUserContent =
        `Prompt:\n${config.prompt}\n\n` +
        buildUserDescriptionSection(config) +
        `Configured labels:\n${JSON.stringify(labelDefinitions)}\n\n` +
        `Decision rules:\n${buildDecisionGuidance(confidenceThreshold)}`
    const dynamicUserContent =
        `Email:\n${JSON.stringify(message)}\n\n` +
        `First-pass decision:\n${JSON.stringify(
            {
                matched: firstResult.matched,
                labelKey: firstResult.labelKey,
                confidence: firstResult.confidence,
                reasoning: firstResult.reasoning,
                followUpType: firstResult.followUpType,
            },
            null,
            2
        )}\n\n` +
        'Re-check the decision. If the email and reasoning actually point to a different configured label, switch to it. ' +
        `${buildNoMatchResponseGuidance(
            config
        )} The reasoning must be consistent with the final labelKey you choose. ` +
        'Return JSON exactly like {"matched":true,"labelKey":"newsletter","followUpType":"informational","confidence":0.92,"reasoning":"..."}.'

    const { parsed, usage } = await runClassifierCompletion(openai, {
        selectedModel,
        isReasoningModel,
        systemPrompt: GMAIL_CONSISTENCY_SYSTEM_PROMPT,
        staticUserContent,
        dynamicUserContent,
        cacheKey: buildOpenAiPromptCacheKey(
            'gmail-audit',
            selectedModel,
            config?.projectId || '',
            config?.gmailEmail || '',
            staticUserContent
        ),
        cacheRoute: 'gmail-classifier-audit',
        // Audits are sparse and their user-specific prefixes are almost never reused.
        // Explicit mode without a breakpoint avoids a charged one-off cache write.
        enableCacheWrite: false,
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
            followUpType: 'informational',
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
    const classifierLabelDefinitions = buildClassifierLabelDefinitions(labelDefinitions)
    const classifierMessage = buildClassifierMessage(message)

    const firstStaticUserContent =
        `Prompt:\n${config.prompt}\n\n` +
        buildUserDescriptionSection(config) +
        `Configured labels:\n${JSON.stringify(classifierLabelDefinitions)}\n\n` +
        `Decision rules:\n${buildDecisionGuidance(confidenceThreshold)}`
    const firstDynamicUserContent =
        `Email:\n${JSON.stringify(classifierMessage)}\n\n` +
        'Return JSON exactly like {"matched":true,"labelKey":"newsletter","followUpType":"informational","confidence":0.92,"reasoning":"..."}. ' +
        `${buildNoMatchResponseGuidance(
            config
        )} If returning no match, use JSON like {"matched":false,"labelKey":null,"followUpType":"informational","confidence":0.2,"reasoning":"..."}.`

    const { parsed, usage: firstUsage } = await runClassifierCompletion(openai, {
        selectedModel,
        isReasoningModel,
        systemPrompt: GMAIL_CLASSIFIER_SYSTEM_PROMPT,
        staticUserContent: firstStaticUserContent,
        dynamicUserContent: firstDynamicUserContent,
        cacheKey: buildOpenAiPromptCacheKey(
            'gmail-first',
            selectedModel,
            config?.projectId || '',
            config?.gmailEmail || '',
            firstStaticUserContent
        ),
        cacheRoute: 'gmail-classifier-first-pass',
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
              buildConsistencyOptionsFromLabels(labelDefinitions),
              { requirePositiveRelationship: true }
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
        const auditLabelDefinitions = buildAuditLabelDefinitions(
            classifierLabelDefinitions,
            firstResult,
            crossReference,
            consistencyTrigger
        )
        const { verified, usage: verifyUsage, parsed: verifyParsed } = await verifyClassificationConsistency(openai, {
            selectedModel: auditModel,
            isReasoningModel: auditIsReasoningModel,
            config,
            message: classifierMessage,
            labelDefinitions: auditLabelDefinitions,
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
        return {
            ...firstResult,
            consistencyCheck: {
                ran: true,
                corrected: false,
                failed: true,
                trigger: consistencyTrigger,
                auditModel,
                originalLabelKey: firstResult.labelKey,
                originalRawLabelKey: firstResult.rawLabelKey || null,
                originalConfidence: firstResult.confidence,
            },
        }
    }
}

module.exports = {
    buildAuditLabelDefinitions,
    buildClassifierLabelDefinitions,
    buildClassifierMessage,
    classifyGmailMessage,
    extractJsonFromText,
    isGpt5ReasoningModel,
    mapAssistantModelToOpenAIModel,
    GMAIL_CLASSIFIER_SYSTEM_PROMPT,
    GMAIL_CONSISTENCY_SYSTEM_PROMPT,
}
