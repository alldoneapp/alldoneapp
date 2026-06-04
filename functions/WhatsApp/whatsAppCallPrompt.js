const VOICE_INSTRUCTIONS = [
    'This is a live WhatsApp phone call.',
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

function getCallSettingsLanguage(language) {
    return String(language || '').trim() || 'English'
}

function buildCallIdentityInstruction(assistant) {
    const assistantName = getCallAssistantName(assistant)
    return `You are ${assistantName}, answering a live WhatsApp phone call. If you introduce yourself or are asked who you are, say only that you are ${assistantName}. Do not repeat your name or re-introduce yourself on every turn, and do not state your name before doing a tool call. Never say you are ChatGPT, OpenAI, or a generic assistant.`
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

function buildCallGreetingInstruction(assistant, language) {
    const assistantName = getCallAssistantName(assistant)
    const settingsLanguage = getCallSettingsLanguage(language)
    return `Greet the caller briefly in ${settingsLanguage}, introduce yourself only as ${assistantName}, and ask how you can help. Do not mention ChatGPT or OpenAI.`
}

module.exports = {
    VOICE_INSTRUCTIONS,
    buildCallBootstrapInstructions,
    buildCallGreetingInstruction,
    buildCallIdentityInstruction,
    buildCallLanguageInstruction,
    getCallAssistantName,
    getCallSettingsLanguage,
}
