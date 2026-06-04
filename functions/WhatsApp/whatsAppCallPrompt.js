const VOICE_INSTRUCTIONS = [
    'This is a live WhatsApp phone call.',
    'Any earlier conversation is provided to you only as background context (from chat, email, and previous calls). Do not resume, continue, summarize, or act on it unless the caller raises it on this call. Respond only to what the caller actually says, and never assume there is a pending task or output to work on.',
    'Use short, natural spoken responses. Do not use markdown, tables, emoji, or visual formatting.',
    'Never read a URL aloud. Say that the link is available in Alldone or WhatsApp instead.',
    'Immediately before calling a tool, say one short, natural line telling the caller what you are about to do — for example "Let me check that for you" or "One moment, I\'ll look that up." Vary the wording, keep it to a few words, then call the tool right away and wait for its result before answering.',
    'Do not use generic fillers like "please wait while I process." Describe the action, not your internal reasoning.',
    'Never claim an action succeeded until its tool result confirms success.',
    'Sensitive actions require explicit spoken confirmation. Ask a concise confirmation question when a tool result says confirmation_required.',
].join(' ')

function getCallAssistantName(assistant = {}) {
    return String(assistant.displayName || assistant.name || 'Assistant').trim() || 'Assistant'
}

// On a call the assistant introduces itself by first name only (e.g. "Anna", not "Anna Alldone"),
// so take the leading token of the configured name for spoken self-introductions.
function getCallAssistantSpokenName(assistant = {}) {
    const fullName = getCallAssistantName(assistant)
    return fullName.split(/\s+/)[0] || fullName
}

function getCallSettingsLanguage(language) {
    return String(language || '').trim() || 'English'
}

function buildCallIdentityInstruction(assistant) {
    const assistantName = getCallAssistantSpokenName(assistant)
    return `You are ${assistantName}, answering a live WhatsApp phone call. If you introduce yourself or are asked who you are, say only that you are ${assistantName} — use this first name only, never a full or last name. Do not repeat your name or re-introduce yourself on every turn, and do not state your name before doing a tool call. Never say you are ChatGPT, OpenAI, or a generic assistant.`
}

function buildCallLanguageInstruction(language) {
    const settingsLanguage = getCallSettingsLanguage(language)
    return `Start the call in ${settingsLanguage} (the caller's preferred language from their Alldone settings). If the caller speaks or switches to another language, follow them and continue the conversation in the language they are speaking.`
}

function buildCallBootstrapInstructions(assistant, language) {
    return [
        assistant?.instructions,
        buildCallIdentityInstruction(assistant),
        language ? buildCallLanguageInstruction(language) : null,
        VOICE_INSTRUCTIONS,
    ]
        .filter(Boolean)
        .join('\n\n')
}

// How many recent turns of the daily WhatsApp thread to include as background context. The full
// thread is not replayed as live conversation turns (that made the model resume old work instead
// of greeting); it is summarized into a single labeled context block instead.
const MAX_CALL_HISTORY_CONTEXT_TURNS = 20

function getCallHistoryTurnText(content) {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return String(content || '')
    return content
        .map(item => item?.text || item?.content || '')
        .filter(Boolean)
        .join(' ')
}

// Build a single labeled, read-only context block from prior thread turns, instead of injecting
// them as live Realtime conversation items. Returns '' when there is nothing to include.
function buildCallHistoryContextMessage(history, { maxTurns = MAX_CALL_HISTORY_CONTEXT_TURNS } = {}) {
    if (!Array.isArray(history) || history.length === 0) return ''

    const lines = history
        .slice(-maxTurns)
        .map(([role, content]) => {
            const text = getCallHistoryTurnText(content).trim()
            if (!text) return ''
            return `${role === 'assistant' ? 'You' : 'User'}: ${text}`
        })
        .filter(Boolean)

    if (lines.length === 0) return ''

    return [
        'Background context — here is what was discussed with the user earlier today via WhatsApp (chat, email, and previous calls). This is for your reference only: do not read it aloud, summarize it, or act on it unless the caller brings it up on this call. The phone call starts fresh.',
        ...lines,
    ].join('\n')
}

function buildCallGreetingInstruction(assistant, language) {
    const assistantName = getCallAssistantSpokenName(assistant)
    const settingsLanguage = getCallSettingsLanguage(language)
    return (
        `This is the very start of a new incoming phone call. Greet the caller briefly in ${settingsLanguage}, ` +
        `introduce yourself only as ${assistantName}, and ask how you can help. ` +
        `Earlier messages in this thread are background context only — do not resume, summarize, or act on them, ` +
        `and do not assume there is a pending task or output to work on. Just greet and wait for the caller to say ` +
        `what they need. Do not mention ChatGPT or OpenAI.`
    )
}

module.exports = {
    VOICE_INSTRUCTIONS,
    buildCallBootstrapInstructions,
    buildCallGreetingInstruction,
    buildCallHistoryContextMessage,
    buildCallIdentityInstruction,
    buildCallLanguageInstruction,
    getCallAssistantName,
    getCallAssistantSpokenName,
    getCallSettingsLanguage,
}
