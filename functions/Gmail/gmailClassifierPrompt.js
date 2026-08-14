'use strict'

const GMAIL_LABELING_PROMPT_MODE_DEFAULT = 'default'
const MAX_CLASSIFIER_BODY_CHARS = 12000

const GMAIL_ACTIONABILITY_GUIDANCE =
    'Classify the follow-up as actionable only when both conditions are met: (1) the email creates a concrete, specific next step for the user, and (2) given the user and matched project context, it is likely something the user genuinely wants to do or should do. Consider the user description, matched project description, participants and relationship, business relevance, and conversation or thread state. A call to action, request, invitation, suggestion, offer, or deadline alone is not enough. Treat unsolicited outreach, promotional asks, optional offers, generic invitations, low-relevance requests, and actions already completed or handled as informational unless the context clearly shows the user would want or need to act. When uncertain whether the user would genuinely act, choose informational.'

const GMAIL_CLASSIFIER_SYSTEM_PROMPT =
    'You classify Gmail messages into exactly one configured label or no match, and classify the follow-up as actionable or informational. Messages may be incoming or outgoing. Return strict JSON only with keys matched, labelKey, followUpType, confidence, reasoning. Never invent labels. followUpType must always be either "actionable" or "informational". ' +
    GMAIL_ACTIONABILITY_GUIDANCE +
    ' Informational means the email does not meet both actionable conditions, including useful updates, notifications, newsletters, automated messages, and irrelevant email. Confidence must be a number between 0 and 1 and must describe confidence in the returned decision.'

function buildDecisionGuidance(confidenceThreshold) {
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

function buildClassifierLabelDefinitions(labelDefinitions = []) {
    return (Array.isArray(labelDefinitions) ? labelDefinitions : [])
        .filter(label => label && label.key)
        .map(label => ({
            key: label.key,
            gmailLabelName: label.gmailLabelName || '',
            description: String(label.description || ''),
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

function buildFirstPassClassifierPromptSections({ config = {}, message = {}, confidenceThreshold }) {
    const classifierLabelDefinitions = buildClassifierLabelDefinitions(config.labelDefinitions)
    const classifierMessage = buildClassifierMessage(message)
    const staticUserContent =
        `Prompt:\n${config.prompt || ''}\n\n` +
        buildUserDescriptionSection(config) +
        `Configured labels:\n${JSON.stringify(classifierLabelDefinitions)}\n\n` +
        `Decision rules:\n${buildDecisionGuidance(confidenceThreshold)}`
    const dynamicUserContent =
        `Email:\n${JSON.stringify(classifierMessage)}\n\n` +
        'Return JSON exactly like {"matched":true,"labelKey":"newsletter","followUpType":"informational","confidence":0.92,"reasoning":"..."}. ' +
        `${buildNoMatchResponseGuidance(
            config
        )} If returning no match, use JSON like {"matched":false,"labelKey":null,"followUpType":"informational","confidence":0.2,"reasoning":"..."}.`

    return {
        systemPrompt: GMAIL_CLASSIFIER_SYSTEM_PROMPT,
        staticUserContent,
        dynamicUserContent,
        classifierLabelDefinitions,
        classifierMessage,
    }
}

module.exports = {
    GMAIL_ACTIONABILITY_GUIDANCE,
    GMAIL_CLASSIFIER_SYSTEM_PROMPT,
    buildClassifierLabelDefinitions,
    buildClassifierMessage,
    buildDecisionGuidance,
    buildFirstPassClassifierPromptSections,
    buildNoMatchResponseGuidance,
    buildUserDescriptionSection,
}
