// Bounds the in-memory research loop. This does not change the persisted thread.
const { createHash } = require('crypto')
const { compactTaskListing } = require('./taskListingContext')
const { compactGoalListing } = require('./goalListingContext')
const { fitToolResultToBudget, shrinkValue } = require('./toolResultFit')
const { MAX_TOOL_RESULT_CONTEXT_CHARS } = require('./attachmentToolHandoff')

const RESEARCH_TOOLS = new Set([
    'read_knowledge_page',
    'search_knowledge',
    'search',
    'get_notes',
    'get_chats',
    'get_tasks',
    'get_contacts',
    'get_goals',
    'get_updates',
    'get_user_projects',
    'get_focus_task',
    'get_project_okrs',
    'get_project_happiness',
    'search_gmail',
    'search_calendar_events',
    'web_search',
    'fetch_url',
])
// One budget for every run. It was 16, which suited a chat where the user can say "keep going" but
// stopped unattended runs half-way: the Growth Lead's scheduled discovery (2026-11-11) used it up on
// the playbook, the contacts and a few web searches and ended at 0 of 6 prospects. Each run is still
// bounded by its wall clock (assistantRunLimits.js), and a successful write resets the count.
const MAX_RESEARCH_CALLS = 48
const MAX_STALLED_SEARCHES = 4
const CONTEXT_BYTE_LIMIT = 100000
// The final reply may still carry out what the user asked for: a run told to research and then save
// (a scheduled "update my user description") otherwise ends with the research done and nothing saved.
const FINAL_REPLY_INSTRUCTION =
    'Research has stopped because further searches were repetitive or the working context was too large. ' +
    'Do not call more research or lookup tools. If the original user request asks you to save, update or create ' +
    'something and a tool for that is still available to you, call it now using the evidence already returned; ' +
    'otherwise answer with what you have. Answer the original user request using the evidence already returned. ' +
    'Give the closest relevant findings and their exact source URLs when available. Clearly distinguish confirmed ' +
    'evidence from tentative matches. Explain any unfinished work briefly and ask for a specific detail only if ' +
    'needed. Do not claim that an unexecuted action succeeded.'

// A run with a hard wall clock (WhatsApp: whatsAppRunGuard.js) stops researching shortly before it,
// so the user gets an answer built from the evidence so far instead of only a timeout notice
// (2026-11-24: a WhatsApp "gib mir ein Briefing" request made 19 lookups in four minutes, was aborted
// twice and never answered).
const TIME_BUDGET_REPLY_INSTRUCTION =
    'Research has stopped because the time for this reply is nearly used up. ' +
    FINAL_REPLY_INSTRUCTION.slice(FINAL_REPLY_INSTRUCTION.indexOf('Do not call more research')) +
    ' Keep the answer short and say in one sentence what you could not check yet, so the user can ask you to continue.'

// Tools that only look things up. Once research has stopped the final reply is offered every other
// tool the run has, so the requested change can still be made, but none of these.
const LOOKUP_TOOL_PREFIX = /^(get|read|search|list|find|fetch)_|^browser_/
const NON_ACTION_TOOLS = new Set(['load_skill', 'compact_thread_context', 'open_mcp_app'])

// MCP tools reach the model as `mcp_<server>_<tool>_<12 hex>` (buildMcpToolName in assistantHelper.js),
// for example `mcp_story_builder__story_get_3d970dad804d`, so the verb is not a prefix and the
// built-in research set never matched them. Every MCP read then counted as workflow progress and
// reset the guard: on 2026-11-19 a task-chat reply called story_get 85 times (62 with the same
// storyId) and story_list 21 times in 34 minutes without the guard noticing. An MCP tool is an
// action only when its name carries a verb that changes something; every other MCP tool
// (story_get, story_list_voices, story_capabilities, job_get) is a lookup.
const MCP_TOOL_NAME_PATTERN = /^mcp_(.+)_[0-9a-f]{12}$/
const MCP_ACTION_VERBS = new Set(
    (
        'accept add append apply approve archive assign attach book cancel change clone close commit complete ' +
        'connect convert create decline delete deploy detach disable disconnect draft duplicate edit enable ' +
        'execute export forward generate import insert invite join label link mark merge modify move patch pin ' +
        'plan post prepare publish purchase put rematch remove rename reorder replace reply reset resolve ' +
        'respond restore retire revert revise rewrite run save schedule select send set share start submit ' +
        'sync toggle transcribe trash trigger undo unlabel unlink unmark unpin unshare untrash update upload ' +
        'upsert write'
    ).split(' ')
)

function mcpToolNameWords(toolName) {
    const match = typeof toolName === 'string' ? MCP_TOOL_NAME_PATTERN.exec(toolName) : null
    return match ? match[1].split('_').filter(Boolean) : null
}

function isMcpActionTool(toolName) {
    const words = mcpToolNameWords(toolName)
    return !!words && words.some(word => MCP_ACTION_VERBS.has(word))
}

function isMcpLookupTool(toolName) {
    return !!mcpToolNameWords(toolName) && !isMcpActionTool(toolName)
}

function isLookupTool(toolName) {
    return (
        RESEARCH_TOOLS.has(toolName) ||
        NON_ACTION_TOOLS.has(toolName) ||
        LOOKUP_TOOL_PREFIX.test(toolName) ||
        isMcpLookupTool(toolName)
    )
}

function toolsForFinalReply(toolNames = []) {
    return (Array.isArray(toolNames) ? toolNames : []).filter(
        toolName => typeof toolName === 'string' && toolName && !isLookupTool(toolName)
    )
}

// The final reply keeps the MCP tools that act (story_delete_voice after the voices were looked up),
// never an MCP lookup, so it cannot read on.
function mcpToolsForFinalReply({ mcpToolSchemas = [], mcpApps = [] } = {}) {
    const schemas = (Array.isArray(mcpToolSchemas) ? mcpToolSchemas : []).filter(schema =>
        isMcpActionTool(schema?.function?.name)
    )
    const kept = new Set(schemas.map(schema => schema.function.name))
    const apps = (Array.isArray(mcpApps) ? mcpApps : [])
        .map(app => ({ ...app, toolNames: (app.toolNames || []).filter(toolName => kept.has(toolName)) }))
        .filter(app => app.toolNames.length > 0)
    return { mcpToolSchemas: schemas, mcpApps: apps }
}

// A job that is still queued or running is polled with the same arguments until it ends
// (Story Builder's job_get). Such a poll is neither a duplicate nor research.
const PENDING_STATUSES = new Set(['queued', 'running', 'pending', 'processing', 'in_progress'])

function describesPendingWork(value, depth = 0) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 3) return false
    if (typeof value.status === 'string' && PENDING_STATUSES.has(value.status.toLowerCase())) return true
    return Object.values(value).some(item => describesPendingWork(item, depth + 1))
}

function roleOf(entry) {
    return Array.isArray(entry) ? entry[0] : entry.role
}

function contentOf(entry) {
    return Array.isArray(entry) ? entry[1] : entry.content
}

function replaceContent(entry, content) {
    return Array.isArray(entry) ? [entry[0], content, ...entry.slice(2)] : { ...entry, content }
}

function fingerprint(value, ignoreQueryMetadata = false) {
    // Query wording and result summaries are not new evidence. Key order also does not matter.
    const normalize = item => {
        if (Array.isArray(item)) return item.map(normalize)
        if (!item || typeof item !== 'object') return item
        return Object.fromEntries(
            Object.keys(item)
                .sort()
                .filter(key => !ignoreQueryMetadata || !['query', 'summary', 'searchQuery'].includes(key))
                .map(key => [key, normalize(item[key])])
        )
    }
    return createHash('sha256')
        .update(JSON.stringify(normalize(value)) ?? 'null')
        .digest('hex')
}

// The newest result is what the model is about to act on: it keeps the full per-result ceiling.
// The one before it keeps 8,000 bytes; older ones share 40,000 bytes. The final reply (aggressive)
// shares 40,000 bytes across all results but still gives the newest at least 8,000.
const LATEST_RESULT_BUDGET = MAX_TOOL_RESULT_CONTEXT_CHARS
const RECENT_RESULT_BUDGET = 8000
const TRUNCATION_MARKER_BYTES = 32
const TIGHTEST_SHAPE = { maxString: 40, maxItems: 5 }

function resultBudget(index, count, perResultBudget, aggressive) {
    if (aggressive) return index === count ? Math.max(perResultBudget, RECENT_RESULT_BUDGET) : perResultBudget
    if (index === count) return LATEST_RESULT_BUDGET
    if (index === count - 1) return RECENT_RESULT_BUDGET
    return perResultBudget
}

// Retain complete tool call/result pairs (including mutation outcomes), original instructions,
// and user turns. Older result bodies become explicitly marked excerpts, never invented summaries.
function compactResearchConversation(conversation, aggressive = false) {
    const toolEntries = conversation.filter(entry => roleOf(entry) === 'tool')
    const toolNames = new Map()
    for (const entry of conversation) {
        for (const call of entry.tool_calls || []) toolNames.set(call.id, call.function?.name)
    }
    const perResultBudget = Math.max(500, Math.floor(40000 / Math.max(1, toolEntries.length)))
    let toolIndex = 0
    return conversation.map(entry => {
        if (roleOf(entry) === 'tool') {
            toolIndex++
            const budget = resultBudget(toolIndex, toolEntries.length, perResultBudget, aggressive)
            let result
            try {
                result = JSON.parse(contentOf(entry))
            } catch (_) {
                result = { excerpt: String(contentOf(entry) || '') }
            }
            if (Buffer.byteLength(JSON.stringify(result), 'utf8') <= budget) return entry
            if (toolNames.get(entry.tool_call_id) === 'get_tasks' && Array.isArray(result?.tasks)) {
                return replaceContent(entry, JSON.stringify(compactTaskListing(result, budget)))
            }
            if (toolNames.get(entry.tool_call_id) === 'get_goals' && Array.isArray(result?.goals)) {
                return replaceContent(entry, JSON.stringify(compactGoalListing(result, budget)))
            }
            // Shrink the structure (long strings first, list items last) so every record keeps its
            // keys, ids and short fields. A prefix of the JSON hid every scene's voiceId after the
            // second one of a 24-scene story_get (2026-11-19).
            const wrap = value =>
                value && typeof value === 'object' && !Array.isArray(value) ? value : { result: value }
            let compacted = fitToolResultToBudget(wrap(result), budget - TRUNCATION_MARKER_BYTES, {
                maxString: Math.min(2000, budget / 2),
            })
            // Keep valid JSON even when many short fields still exceed the budget.
            if (!compacted) {
                compacted = {
                    success: result.success,
                    status: result.status,
                    taskId: result.taskId,
                    noteId: result.noteId,
                    projectId: result.projectId,
                    url: result.url,
                    sourceRecords: collectSourceRecords(result).slice(0, 3),
                    excerpt: JSON.stringify(shrinkValue(wrap(result), TIGHTEST_SHAPE)).slice(0, Math.floor(budget / 4)),
                }
            }
            return replaceContent(entry, JSON.stringify({ ...compacted, contextTruncated: true }))
        }
        if (roleOf(entry) === 'assistant' && !Array.isArray(entry) && entry.tool_calls) {
            return replaceContent(entry, String(entry.content || '').slice(0, 1000))
        }
        return entry
    })
}

function collectSourceRecords(value, records = []) {
    if (!value || typeof value !== 'object') return records
    if (Array.isArray(value)) {
        value.forEach(item => collectSourceRecords(item, records))
        return records
    }
    const title = value.title || value.name
    const url = value.url || value.link
    if (typeof title === 'string' && typeof url === 'string' && /^https?:\/\//.test(url)) {
        records.push({ title: title.slice(0, 120), url })
    }
    Object.values(value).forEach(item => collectSourceRecords(item, records))
    return records
}

function createResearchGuard() {
    const calls = new Set()
    const evidence = new Set()
    const sources = new Map()
    let researchCalls = 0
    let stalledSearches = 0
    return {
        beforeTool(toolName, args) {
            // MCP lookups are counted once their result is known (recordResult): a poll of a
            // pending job repeats the same call legitimately.
            if (!RESEARCH_TOOLS.has(toolName)) return null
            const key = `${toolName}:${fingerprint(args)}`
            if (calls.has(key)) return 'duplicate_research_call'
            if (researchCalls >= MAX_RESEARCH_CALLS) return 'research_call_limit'
            calls.add(key)
            researchCalls++
            return researchCalls >= MAX_RESEARCH_CALLS ? 'research_call_limit' : null
        },
        recordResult(toolName, result, args) {
            collectSourceRecords(result).forEach(record => sources.set(record.url, record))
            if (isWorkflowProgress(toolName, result)) {
                researchCalls = 0
                stalledSearches = 0
                calls.clear()
                evidence.clear()
            }
            if (isMcpLookupTool(toolName)) {
                if (describesPendingWork(result)) return null
                // The same call answered the same way before: the model is re-reading, not learning.
                const key = `${toolName}:${fingerprint(args ?? null)}:${fingerprint(result, true)}`
                if (calls.has(key)) return 'duplicate_research_call'
                calls.add(key)
                researchCalls++
                return researchCalls >= MAX_RESEARCH_CALLS ? 'research_call_limit' : null
            }
            if (!RESEARCH_TOOLS.has(toolName)) return null
            const key = `${toolName}:${fingerprint(result?.results || result, true)}`
            const repeated = evidence.has(key)
            evidence.add(key)
            if (toolName === 'search') {
                stalledSearches = repeated || result?.totalResults === 0 ? stalledSearches + 1 : 0
            } else if (!repeated && result?.success !== false) {
                stalledSearches = 0
            }
            return stalledSearches >= MAX_STALLED_SEARCHES ? 'repeated_search_results' : null
        },
        compactIfNeeded(conversation) {
            const beforeBytes = Buffer.byteLength(JSON.stringify(conversation), 'utf8')
            if (beforeBytes < CONTEXT_BYTE_LIMIT || !conversation.some(entry => roleOf(entry) === 'tool'))
                return conversation
            const compacted = compactResearchConversation(conversation)
            console.log('Assistant: Compacted research context', {
                beforeBytes,
                afterBytes: Buffer.byteLength(JSON.stringify(compacted), 'utf8'),
            })
            return compacted
        },
        fallback() {
            const findings = [...sources.values()].slice(0, 3)
            return [
                'I could not finish researching this request. Please narrow the search with a date, name, or specific record.',
                ...(findings.length ? ['Records found so far (matches are not confirmed):'] : []),
                ...findings.map(record => `- ${record.title}: ${record.url}`),
            ].join('\n')
        },
    }
}

function isWorkflowProgress(toolName, result) {
    return (
        !RESEARCH_TOOLS.has(toolName) &&
        !NON_ACTION_TOOLS.has(toolName) &&
        !isMcpLookupTool(toolName) &&
        result?.success !== false &&
        !result?.error &&
        !['failed', 'blocked', 'skipped'].includes(result?.status)
    )
}

// All channel-specific loops pass their tool history through interactWithChatStream.
// Deriving state from that history also keeps concurrent runs isolated without runtime globals.
// options.timeBudgetSpent: the caller's wall clock is nearly spent, so this request must be the final
// reply whatever the tool history says.
function prepareResearchRequest(conversation, options = {}) {
    if (!Array.isArray(conversation)) return { messages: conversation, stopReason: null, fallback: () => '' }
    const guard = createResearchGuard()
    const callsById = new Map()
    let stopReason = null
    for (const entry of conversation) {
        if (!Array.isArray(entry) && entry.tool_calls) {
            for (const call of entry.tool_calls) callsById.set(call.id, call.function)
        }
        if (roleOf(entry) !== 'tool') continue
        const call = callsById.get(entry.tool_call_id)
        if (!call) continue
        let args
        let result
        try {
            args = JSON.parse(call.arguments || '{}')
            result = JSON.parse(contentOf(entry))
        } catch (_) {
            continue
        }
        const callStopReason = guard.beforeTool(call.name, args)
        const resultStopReason = guard.recordResult(call.name, result, args)
        if (isWorkflowProgress(call.name, result)) stopReason = null
        stopReason ||= callStopReason || resultStopReason
    }
    if (options.timeBudgetSpent) stopReason = 'time_budget'
    let messages = guard.compactIfNeeded(conversation)
    if (stopReason) {
        messages = [
            ...compactResearchConversation(messages, true),
            {
                role: 'system',
                content: stopReason === 'time_budget' ? TIME_BUDGET_REPLY_INSTRUCTION : FINAL_REPLY_INSTRUCTION,
            },
        ]
        console.warn('Assistant: Finalizing bounded research', { reason: stopReason })
    }
    return { messages, stopReason, fallback: () => guard.fallback() }
}

module.exports = {
    prepareResearchRequest,
    compactResearchConversation,
    FINAL_REPLY_INSTRUCTION,
    TIME_BUDGET_REPLY_INSTRUCTION,
    toolsForFinalReply,
    mcpToolsForFinalReply,
    isMcpLookupTool,
    isMcpActionTool,
    MAX_RESEARCH_CALLS,
    MAX_STALLED_SEARCHES,
}
