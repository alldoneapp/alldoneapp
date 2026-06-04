const VOICE_INSTRUCTIONS = [
    'This is a live WhatsApp phone call.',
    'Use short, natural spoken responses. Do not use markdown, tables, emoji, or visual formatting.',
    'Never read a URL aloud. Say that the link is available in Alldone or WhatsApp instead.',
    'Briefly announce when an operation may take time.',
    'Never claim an action succeeded until its tool result confirms success.',
    'Sensitive actions require explicit spoken confirmation. Ask a concise confirmation question when a tool result says confirmation_required.',
].join(' ')

function getCallAssistantName(assistant = {}) {
    return String(assistant.displayName || assistant.name || 'Assistant').trim() || 'Assistant'
}

function buildCallIdentityInstruction(assistant) {
    const assistantName = getCallAssistantName(assistant)
    return `You are ${assistantName}, answering a live WhatsApp phone call. Always identify yourself as ${assistantName}. Never introduce yourself as ChatGPT, OpenAI, or a generic assistant.`
}

function buildCallBootstrapInstructions(assistant) {
    return [assistant?.instructions, buildCallIdentityInstruction(assistant), VOICE_INSTRUCTIONS]
        .filter(Boolean)
        .join('\n\n')
}

function buildCallGreetingInstruction(assistant) {
    const assistantName = getCallAssistantName(assistant)
    return `Greet the caller briefly, introduce yourself only as ${assistantName}, and ask how you can help. Do not mention ChatGPT or OpenAI.`
}

module.exports = {
    VOICE_INSTRUCTIONS,
    buildCallBootstrapInstructions,
    buildCallGreetingInstruction,
    buildCallIdentityInstruction,
    getCallAssistantName,
}
