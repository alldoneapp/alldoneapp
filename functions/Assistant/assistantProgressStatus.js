const { describeToolActivity, rememberDelegationDisplayName } = require('./assistantToolActivity')

/**
 * English rendering of every activity key, for the channels that only ever see the
 * comment text (WhatsApp, email digests). The in-app UI ignores this and renders the
 * same keys through i18n instead — see components/.../AssistantProgress.js.
 * `%s` is replaced by the already-sanitized subject.
 */
const ACTION_PRESENTATION = {
    assistant_activity_search_notes: ['🔍', 'Searching notes for “%s”'],
    assistant_activity_search_tasks: ['🔍', 'Searching tasks for “%s”'],
    assistant_activity_search_goals: ['🔍', 'Searching goals for “%s”'],
    assistant_activity_search_contacts: ['🔍', 'Searching contacts for “%s”'],
    assistant_activity_search_chats: ['🔍', 'Searching chats for “%s”'],
    assistant_activity_search_assistants: ['🔍', 'Searching assistants for “%s”'],
    assistant_activity_search_workspace: ['🔍', 'Searching your workspace for “%s”'],
    assistant_activity_search_workspace_plain: ['🗂️', 'Searching your workspace'],
    assistant_activity_search_web: ['🔎', 'Searching the web for “%s”'],
    assistant_activity_search_web_plain: ['🔎', 'Searching the web'],
    assistant_activity_search_email: ['📬', 'Searching your email for “%s”'],
    assistant_activity_search_email_plain: ['📬', 'Searching your email'],
    assistant_activity_search_calendar: ['📅', 'Searching your calendar for “%s”'],
    assistant_activity_search_calendar_plain: ['📅', 'Searching your calendar'],
    assistant_activity_read_notes: ['🗂️', 'Looking through your notes'],
    assistant_activity_read_tasks: ['✅', 'Looking through your tasks'],
    assistant_activity_read_goals: ['🎯', 'Looking through your goals'],
    assistant_activity_read_contacts: ['👥', 'Looking through your contacts'],
    assistant_activity_read_chats: ['💬', 'Looking through your chats'],
    assistant_activity_read_updates: ['📰', 'Catching up on recent updates'],
    assistant_activity_read_focus: ['🎯', 'Checking your focus task'],
    assistant_activity_read_projects: ['🗂️', 'Checking your projects'],
    assistant_activity_read_okrs: ['🎯', 'Looking through the OKRs'],
    assistant_activity_read_happiness: ['😊', 'Checking the project happiness'],
    assistant_activity_create_task: ['✅', 'Creating the task “%s”'],
    assistant_activity_create_task_plain: ['✅', 'Creating a task'],
    assistant_activity_update_task: ['✏️', 'Updating the task “%s”'],
    assistant_activity_update_task_plain: ['✏️', 'Updating a task'],
    assistant_activity_create_note: ['📝', 'Creating the note “%s”'],
    assistant_activity_create_note_plain: ['📝', 'Creating a note'],
    assistant_activity_update_note: ['✏️', 'Updating the note “%s”'],
    assistant_activity_update_note_plain: ['✏️', 'Updating a note'],
    assistant_activity_update_contact: ['👤', 'Updating the contact %s'],
    assistant_activity_update_contact_plain: ['👤', 'Updating a contact'],
    assistant_activity_add_comment: ['💬', 'Adding a comment to the chat'],
    assistant_activity_update_memory: ['🧠', 'Updating what I remember about you'],
    assistant_activity_compact_context: ['🧹', 'Tidying up the conversation context'],
    assistant_activity_create_event: ['📅', 'Adding “%s” to your calendar'],
    assistant_activity_create_event_plain: ['📅', 'Adding an event to your calendar'],
    assistant_activity_update_event: ['📅', 'Updating the event “%s”'],
    assistant_activity_update_event_plain: ['📅', 'Updating a calendar event'],
    assistant_activity_delete_event: ['🗑️', 'Removing an event from your calendar'],
    assistant_activity_find_availability: ['📅', 'Looking for a free slot in your calendar'],
    assistant_activity_draft_email: ['✉️', 'Drafting an email'],
    assistant_activity_update_draft: ['✉️', 'Updating the email draft'],
    assistant_activity_organize_email: ['📬', 'Organising your email'],
    assistant_activity_check_weather: ['🌦️', 'Checking the weather in %s'],
    assistant_activity_check_weather_plain: ['🌦️', 'Checking the weather'],
    assistant_activity_plan_route: ['🗺️', 'Looking up the route to %s'],
    assistant_activity_plan_route_plain: ['🗺️', 'Looking up the route'],
    assistant_activity_find_places: ['📍', 'Looking for “%s” nearby'],
    assistant_activity_find_places_plain: ['📍', 'Looking for recommendations nearby'],
    assistant_activity_load_skill: ['📚', 'Getting up to speed on “%s”'],
    assistant_activity_load_skill_plain: ['📚', 'Getting up to speed'],
    assistant_activity_vm_task: ['🤝', 'Handing “%s” to a specialist'],
    assistant_activity_vm_task_plain: ['🤝', 'Handing the work to a specialist'],
    assistant_activity_ask_assistant: ['🤝', 'Asking %s for help'],
    assistant_activity_ask_assistant_plain: ['🤝', 'Asking a specialist for help'],
}

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

/**
 * The user-facing activity for a running tool call: an i18n key plus a sanitized
 * subject, safe to persist on `assistantRun.activity` and render on the client.
 * Both fields are null when the tool has no whitelist rule.
 */
const buildToolActivityDescriptor = ({ toolName, toolArgs } = {}) => describeToolActivity({ toolName, toolArgs })

const renderActionText = (actionKey, subject) => {
    const presentation = ACTION_PRESENTATION[actionKey]
    if (!presentation) return ''

    const [emoji, template] = presentation
    if (template.includes('%s') && !subject) return ''
    return `${emoji} ${template.replace('%s', subject || '')}…`
}

const buildToolProgressStatusMessage = ({ toolName, toolArgs, elapsedMs }) => {
    const story = TOOL_STATUS_STORIES[getToolActivityKind(toolName)]
    const storyIndex = Math.min(Math.floor(Math.max(0, Number(elapsedMs) || 0) / 7000), story.length - 1)

    // A specific headline ("Searching notes for “Pricing”") replaces the generic one and
    // stays put for the whole call; the rotating subline keeps signalling progress.
    const { actionKey, subject } = buildToolActivityDescriptor({ toolName, toolArgs })
    const actionText = renderActionText(actionKey, subject)
    if (actionText) return [actionText, story[storyIndex][1]].join('\n')

    return story[storyIndex].join('\n')
}

module.exports = {
    TOOL_ACTIVITY_KINDS,
    ACTION_PRESENTATION,
    getToolActivityKind,
    buildInitialAssistantRunStatusMessage,
    buildToolProgressStatusMessage,
    buildToolActivityDescriptor,
    rememberDelegationDisplayName,
}
