const TOOL_ACTIVITY_KINDS = {
    WEB: 'web',
    WORKSPACE: 'workspace',
    COMMUNICATION: 'communication',
    CHANGE: 'change',
    SPECIALIST: 'specialist',
    GENERIC: 'generic',
}

const normalizeToolName = toolName =>
    String(toolName || '')
        .trim()
        .toLowerCase()

const getToolActivityKind = toolName => {
    const normalized = normalizeToolName(toolName)

    if (normalized === 'web_search' || normalized.includes('search_web')) return TOOL_ACTIVITY_KINDS.WEB
    if (normalized.startsWith('talk_to_assistant_') || normalized === 'execute_task_in_vm') {
        return TOOL_ACTIVITY_KINDS.SPECIALIST
    }
    if (/^(create|update|delete|archive|move|complete|restore|add|remove)_/.test(normalized)) {
        return TOOL_ACTIVITY_KINDS.CHANGE
    }
    if (/(gmail|email|calendar|meeting|contact|whatsapp)/.test(normalized)) {
        return TOOL_ACTIVITY_KINDS.COMMUNICATION
    }
    if (/(note|task|goal|project|focus|search)/.test(normalized)) return TOOL_ACTIVITY_KINDS.WORKSPACE
    return TOOL_ACTIVITY_KINDS.GENERIC
}

const TOOL_STATUS_STORIES = {
    [TOOL_ACTIVITY_KINDS.WEB]: [
        ['🔎 Searching for fresh information…', 'I’m looking for reliable sources that match your question.'],
        ['📚 Reading the promising results…', 'I’m checking the details instead of stopping at the first answer.'],
        ['🧭 Cross-checking what I found…', 'I’m keeping the useful bits and leaving the noise behind.'],
        [
            '✨ Turning the research into an answer…',
            'The tiny gears are still turning — I’m nearly ready to explain it clearly.',
        ],
    ],
    [TOOL_ACTIVITY_KINDS.WORKSPACE]: [
        ['🗂️ Looking through your workspace…', 'I’m finding the notes, tasks, or projects that matter here.'],
        [
            '🔍 Reading the relevant details…',
            'I’m narrowing things down so you do not have to sift through everything.',
        ],
        ['🧩 Connecting the useful pieces…', 'I’m checking how they fit your question.'],
        ['✨ Getting the answer into shape…', 'Still with you — I’m tying up the loose ends.'],
    ],
    [TOOL_ACTIVITY_KINDS.COMMUNICATION]: [
        ['📬 Checking the right place…', 'I’m looking for the relevant message, event, or conversation.'],
        ['👀 Reading it carefully…', 'I’m picking out the details that matter.'],
        ['🧩 Pulling the useful context together…', 'I’m making sure the answer reflects what I found.'],
        ['✨ Getting ready to reply…', 'Still working — one thoughtful pass remains.'],
    ],
    [TOOL_ACTIVITY_KINDS.CHANGE]: [
        ['🛠️ Making the requested change…', 'I’m taking care of the update now.'],
        ['🔍 Checking that it went through…', 'I’m verifying the result before I call it done.'],
        ['🧹 Tying up the loose ends…', 'I’m making sure nothing important was missed.'],
        ['✨ Preparing the good news…', 'Still with you — the final check is underway.'],
    ],
    [TOOL_ACTIVITY_KINDS.SPECIALIST]: [
        ['🤝 Briefing the right specialist…', 'I’m passing along your request and the useful context.'],
        ['🧠 Letting the specialist dig in…', 'This may take a moment while the deeper work happens.'],
        ['👀 Keeping an eye on the progress…', 'I’m waiting for the result so I can bring it back to you clearly.'],
        ['✨ Getting the hand-off ready…', 'Still with you — the specialist is wrapping up.'],
    ],
    [TOOL_ACTIVITY_KINDS.GENERIC]: [
        ['🧰 Using the right tool for the job…', 'I’m taking the next useful step for your request.'],
        ['⏳ Waiting for the result…', 'Some tools need a little time to do their work properly.'],
        ['🔍 Checking what came back…', 'I’m making sure the result is actually useful.'],
        ['✨ Connecting the dots…', 'Still with you — I’m turning the result into a clear answer.'],
    ],
}

const buildInitialAssistantRunStatusMessage = () =>
    [
        '✨ Getting everything lined up…',
        'I’m reading the conversation, gathering what matters, and choosing the best way to help.',
        'I’ll keep you posted here while I work.',
    ].join('\n')

const buildToolProgressStatusMessage = ({ toolName, elapsedMs }) => {
    const story = TOOL_STATUS_STORIES[getToolActivityKind(toolName)]
    const storyIndex = Math.min(Math.floor(Math.max(0, Number(elapsedMs) || 0) / 7000), story.length - 1)
    return story[storyIndex].join('\n')
}

module.exports = {
    TOOL_ACTIVITY_KINDS,
    getToolActivityKind,
    buildInitialAssistantRunStatusMessage,
    buildToolProgressStatusMessage,
}
