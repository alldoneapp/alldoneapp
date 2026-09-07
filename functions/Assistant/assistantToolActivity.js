/**
 * Turns a tool call into a short, non-technical description of what the assistant is
 * doing right now — "Searching notes for “Pricing”" instead of `search({"query":...})`.
 *
 * Two hard rules shape this file:
 *
 * 1. Parameters are WHITELISTED per tool, never blacklisted. A tool with no rule below
 *    contributes no detail at all and falls back to the generic activity story. That way
 *    a newly added tool schema — or an MCP / external tool whose arguments are arbitrary
 *    third-party JSON — cannot leak a field into the UI just by existing.
 * 2. Even a whitelisted value is dropped when it looks like an identifier, credential,
 *    address or URL rather than something a person would recognise. Losing the detail is
 *    always preferable to showing something technical or sensitive.
 *
 * The output is an i18n KEY plus an already-sanitized subject, so the client renders it
 * in the user's language and the server can render the same thing in English for the
 * channels that only ever see comment text (WhatsApp, email).
 */

const SUBJECT_MAX_LENGTH = 48

// A value matching any of these is never shown, even from a whitelisted parameter.
const UNSAFE_SUBJECT_PATTERNS = [
    /^-[A-Za-z0-9_-]{15,}$/, // Firebase push id, e.g. -OzdcDhFZgovZ0n8WZ4q
    /^[0-9a-f]{16,}$/i, // hex id or hash
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i, // uuid
    /^[A-Za-z0-9+/=_-]{40,}$/, // opaque token / base64 blob
    /\bsk-[A-Za-z0-9]/i,
    /\bghp_[A-Za-z0-9]/i,
    /\bglpat-/i,
    /\bBearer\s+\S/i,
    /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, // email address
    /:\/\//, // any URL
]

/**
 * Collapse to a single readable line, reject anything identifier-shaped, and truncate on
 * a word boundary. Returns '' when nothing safe and useful survives.
 */
const sanitizeActivitySubject = value => {
    if (typeof value !== 'string') return ''

    const collapsed = value
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1F\x7F]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^["'`“”„‘’«»\s]+|["'`“”„‘’«»\s]+$/g, '')
        .trim()

    if (collapsed.length < 2) return ''
    if (UNSAFE_SUBJECT_PATTERNS.some(pattern => pattern.test(collapsed))) return ''
    if (collapsed.length <= SUBJECT_MAX_LENGTH) return collapsed

    const truncated = collapsed.slice(0, SUBJECT_MAX_LENGTH)
    const lastSpace = truncated.lastIndexOf(' ')
    const cut = lastSpace > SUBJECT_MAX_LENGTH * 0.6 ? truncated.slice(0, lastSpace) : truncated
    return `${cut.replace(/[\s,;:.\-–—]+$/, '')}…`
}

const SEARCH_KEY_BY_TYPE = {
    notes: 'assistant_activity_search_notes',
    tasks: 'assistant_activity_search_tasks',
    goals: 'assistant_activity_search_goals',
    contacts: 'assistant_activity_search_contacts',
    chats: 'assistant_activity_search_chats',
    assistants: 'assistant_activity_search_assistants',
}

/**
 * tool name -> { params, subjectKey | resolveSubjectKey, plainKey }
 *
 * `params` are tried in order; the first one that sanitizes to a usable value wins.
 * `plainKey` is used when no subject survives — it still describes the action, just
 * without the specific term. A rule may define only `plainKey` (many read tools take no
 * search term at all: get_notes filters by project/date, never by text).
 */
const TOOL_ACTIVITY_RULES = {
    // --- Searching -------------------------------------------------------------
    search: {
        params: ['query'],
        resolveSubjectKey: toolArgs =>
            SEARCH_KEY_BY_TYPE[String(toolArgs?.type || '').toLowerCase()] || 'assistant_activity_search_workspace',
        plainKey: 'assistant_activity_search_workspace_plain',
    },
    web_search: {
        params: ['query'],
        subjectKey: 'assistant_activity_search_web',
        plainKey: 'assistant_activity_search_web_plain',
    },
    search_gmail: {
        params: ['query'],
        subjectKey: 'assistant_activity_search_email',
        plainKey: 'assistant_activity_search_email_plain',
    },
    search_calendar_events: {
        params: ['query'],
        subjectKey: 'assistant_activity_search_calendar',
        plainKey: 'assistant_activity_search_calendar_plain',
    },

    // --- Reading the workspace (no free-text parameter exists on these) ---------
    get_notes: { plainKey: 'assistant_activity_read_notes' },
    get_tasks: { plainKey: 'assistant_activity_read_tasks' },
    get_goals: { plainKey: 'assistant_activity_read_goals' },
    get_contacts: { plainKey: 'assistant_activity_read_contacts' },
    get_chats: { plainKey: 'assistant_activity_read_chats' },
    get_updates: { plainKey: 'assistant_activity_read_updates' },
    get_focus_task: { plainKey: 'assistant_activity_read_focus' },
    get_user_projects: { plainKey: 'assistant_activity_read_projects' },
    get_project_okrs: { plainKey: 'assistant_activity_read_okrs' },
    get_project_happiness: { plainKey: 'assistant_activity_read_happiness' },

    // --- Changing things -------------------------------------------------------
    create_task: {
        params: ['name'],
        subjectKey: 'assistant_activity_create_task',
        plainKey: 'assistant_activity_create_task_plain',
    },
    update_task: {
        params: ['taskName', 'name'],
        subjectKey: 'assistant_activity_update_task',
        plainKey: 'assistant_activity_update_task_plain',
    },
    create_note: {
        params: ['title'],
        subjectKey: 'assistant_activity_create_note',
        plainKey: 'assistant_activity_create_note_plain',
    },
    update_note: {
        params: ['noteTitle', 'title'],
        subjectKey: 'assistant_activity_update_note',
        plainKey: 'assistant_activity_update_note_plain',
    },
    update_contact: {
        params: ['contactName'],
        subjectKey: 'assistant_activity_update_contact',
        plainKey: 'assistant_activity_update_contact_plain',
    },
    add_chat_comment: { plainKey: 'assistant_activity_add_comment' },
    update_user_memory: { plainKey: 'assistant_activity_update_memory' },
    compact_thread_context: { plainKey: 'assistant_activity_compact_context' },

    // --- Calendar --------------------------------------------------------------
    create_calendar_event: {
        params: ['summary'],
        subjectKey: 'assistant_activity_create_event',
        plainKey: 'assistant_activity_create_event_plain',
    },
    update_calendar_event: {
        params: ['summary'],
        subjectKey: 'assistant_activity_update_event',
        plainKey: 'assistant_activity_update_event_plain',
    },
    delete_calendar_event: { plainKey: 'assistant_activity_delete_event' },
    find_calendar_availability: { plainKey: 'assistant_activity_find_availability' },

    // --- Email -----------------------------------------------------------------
    // Deliberately no subject: an email subject line is message content, not an object
    // name, so only the action is described.
    create_gmail_draft: { plainKey: 'assistant_activity_draft_email' },
    create_gmail_reply_draft: { plainKey: 'assistant_activity_draft_email' },
    update_gmail_draft: { plainKey: 'assistant_activity_update_draft' },
    update_gmail_email: { plainKey: 'assistant_activity_organize_email' },

    // --- Lookups ---------------------------------------------------------------
    get_weather: {
        params: ['location'],
        subjectKey: 'assistant_activity_check_weather',
        plainKey: 'assistant_activity_check_weather_plain',
    },
    get_route_info: {
        params: ['destination'],
        subjectKey: 'assistant_activity_plan_route',
        plainKey: 'assistant_activity_plan_route_plain',
    },
    get_local_recommendations: {
        params: ['query'],
        subjectKey: 'assistant_activity_find_places',
        plainKey: 'assistant_activity_find_places_plain',
    },
    load_skill: {
        params: ['name'],
        subjectKey: 'assistant_activity_load_skill',
        plainKey: 'assistant_activity_load_skill_plain',
    },

    // --- Handing work off ------------------------------------------------------
    execute_task_in_vm: {
        params: ['objective'],
        subjectKey: 'assistant_activity_vm_task',
        plainKey: 'assistant_activity_vm_task_plain',
    },
}

const TALK_TO_ASSISTANT_PREFIX = 'talk_to_assistant_'

/**
 * The delegation tool name is `talk_to_assistant_<projectSlug>_<assistantSlug>_<hash>`,
 * which cannot be split back into a display name unambiguously (both slugs may contain
 * underscores). So the name is remembered when the tool schema is built and looked up
 * here. A miss simply degrades to the subject-less "Asking a specialist" wording — the
 * lookup is a per-process cache, and the persisted schema cache can outlive it.
 */
const DELEGATION_NAME_CACHE_LIMIT = 500
const delegationDisplayNames = new Map()

const rememberDelegationDisplayName = (toolName, displayName) => {
    const safeName = sanitizeActivitySubject(displayName)
    if (!toolName || !safeName) return

    if (delegationDisplayNames.has(toolName)) delegationDisplayNames.delete(toolName)
    delegationDisplayNames.set(toolName, safeName)

    while (delegationDisplayNames.size > DELEGATION_NAME_CACHE_LIMIT) {
        delegationDisplayNames.delete(delegationDisplayNames.keys().next().value)
    }
}

const getDelegationDisplayName = toolName => delegationDisplayNames.get(toolName) || ''

const pickSubject = (toolArgs, params) => {
    if (!Array.isArray(params) || !toolArgs || typeof toolArgs !== 'object') return ''
    for (const param of params) {
        const subject = sanitizeActivitySubject(toolArgs[param])
        if (subject) return subject
    }
    return ''
}

/**
 * @returns {{ actionKey: string|null, subject: string|null }} — both null when the tool
 * has no rule, so callers fall back to the generic activity story.
 */
const describeToolActivity = ({ toolName, toolArgs } = {}) => {
    const normalized = String(toolName || '').trim()
    const empty = { actionKey: null, subject: null }
    if (!normalized) return empty

    if (normalized.startsWith(TALK_TO_ASSISTANT_PREFIX)) {
        const specialist = getDelegationDisplayName(normalized)
        return specialist
            ? { actionKey: 'assistant_activity_ask_assistant', subject: specialist }
            : { actionKey: 'assistant_activity_ask_assistant_plain', subject: null }
    }

    // `get_note` is the legacy alias that getToolSchemas maps onto `get_notes`.
    const rule = TOOL_ACTIVITY_RULES[normalized === 'get_note' ? 'get_notes' : normalized]
    if (!rule) return empty

    const subject = pickSubject(toolArgs, rule.params)
    if (subject) {
        const actionKey = rule.resolveSubjectKey ? rule.resolveSubjectKey(toolArgs) : rule.subjectKey
        if (actionKey) return { actionKey, subject }
    }

    return rule.plainKey ? { actionKey: rule.plainKey, subject: null } : empty
}

module.exports = {
    SUBJECT_MAX_LENGTH,
    sanitizeActivitySubject,
    describeToolActivity,
    rememberDelegationDisplayName,
}
