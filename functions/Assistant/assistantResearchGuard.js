// Bounds the in-memory research loop. This does not change the persisted thread.
const { createHash } = require('crypto')
const { compactTaskListing } = require('./taskListingContext')
const { compactGoalListing } = require('./goalListingContext')

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
const MAX_RESEARCH_CALLS = 16
// A scheduled assistant task runs unattended: nobody can answer "keep going" when the 16-call chat
// budget runs out, so it stops with tentative findings and still costs the Gold. The Growth Lead's
// daily discovery (2026-11-11) needs a search, a source and a date check per prospect and ended at
// 0 of 6. Its own 25-minute wall clock (assistantRunLimits.js) still bounds the run.
const SCHEDULED_MAX_RESEARCH_CALLS = 48
const RESEARCH_CALL_LIMIT_CEILING = 100
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

// Tools that only look things up. Once research has stopped the final reply is offered every other
// tool the run has, so the requested change can still be made, but none of these.
const LOOKUP_TOOL_PREFIX = /^(get|read|search|list|find|fetch)_|^browser_/
const NON_ACTION_TOOLS = new Set(['load_skill', 'compact_thread_context'])

function isLookupTool(toolName) {
    return RESEARCH_TOOLS.has(toolName) || NON_ACTION_TOOLS.has(toolName) || LOOKUP_TOOL_PREFIX.test(toolName)
}

function toolsForFinalReply(toolNames = []) {
    return (Array.isArray(toolNames) ? toolNames : []).filter(
        toolName => typeof toolName === 'string' && toolName && !isLookupTool(toolName)
    )
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

function compactValue(value, maxStringLength, depth = 0) {
    if (typeof value === 'string') {
        return value.length <= maxStringLength
            ? value
            : `${value.slice(0, maxStringLength)} [excerpt; remaining text omitted]`
    }
    if (!value || typeof value !== 'object') return value
    if (depth > 8) return '[nested details omitted]'
    if (Array.isArray(value)) return value.slice(0, 5).map(item => compactValue(item, maxStringLength, depth + 1))
    return Object.fromEntries(
        Object.entries(value)
            .slice(0, 40)
            .map(([key, item]) => [key, compactValue(item, maxStringLength, depth + 1)])
    )
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
            const budget = !aggressive && toolIndex > toolEntries.length - 2 ? 8000 : perResultBudget
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
            let compacted = compactValue(result, Math.min(2000, budget / 2))
            if (!compacted || typeof compacted !== 'object' || Array.isArray(compacted)) {
                compacted = { result: compacted }
            }
            // Keep valid JSON even when many short fields still exceed the budget.
            if (Buffer.byteLength(JSON.stringify(compacted), 'utf8') > budget) {
                compacted = {
                    success: result.success,
                    status: result.status,
                    taskId: result.taskId,
                    noteId: result.noteId,
                    projectId: result.projectId,
                    url: result.url,
                    sourceRecords: collectSourceRecords(result).slice(0, 3),
                    excerpt: JSON.stringify(compacted).slice(0, Math.floor(budget / 4)),
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

function resolveMaxResearchCalls(value) {
    const limit = Number(value)
    return Number.isInteger(limit) && limit > 0 ? Math.min(limit, RESEARCH_CALL_LIMIT_CEILING) : MAX_RESEARCH_CALLS
}

function createResearchGuard({ maxResearchCalls = MAX_RESEARCH_CALLS } = {}) {
    const callLimit = resolveMaxResearchCalls(maxResearchCalls)
    const calls = new Set()
    const evidence = new Set()
    const sources = new Map()
    let researchCalls = 0
    let stalledSearches = 0
    return {
        beforeTool(toolName, args) {
            if (!RESEARCH_TOOLS.has(toolName)) return null
            const key = `${toolName}:${fingerprint(args)}`
            if (calls.has(key)) return 'duplicate_research_call'
            if (researchCalls >= callLimit) return 'research_call_limit'
            calls.add(key)
            researchCalls++
            return researchCalls >= callLimit ? 'research_call_limit' : null
        },
        recordResult(toolName, result) {
            collectSourceRecords(result).forEach(record => sources.set(record.url, record))
            if (isWorkflowProgress(toolName, result)) {
                researchCalls = 0
                stalledSearches = 0
                calls.clear()
                evidence.clear()
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
        !['load_skill', 'compact_thread_context'].includes(toolName) &&
        result?.success !== false &&
        !result?.error &&
        !['failed', 'blocked', 'skipped'].includes(result?.status)
    )
}

// All channel-specific loops pass their tool history through interactWithChatStream.
// Deriving state from that history also keeps concurrent runs isolated without runtime globals.
// options.maxResearchCalls raises the call budget for unattended runs (SCHEDULED_MAX_RESEARCH_CALLS);
// anything that is not a positive integer keeps the chat default.
function prepareResearchRequest(conversation, { maxResearchCalls } = {}) {
    if (!Array.isArray(conversation)) return { messages: conversation, stopReason: null, fallback: () => '' }
    const guard = createResearchGuard({ maxResearchCalls })
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
        const resultStopReason = guard.recordResult(call.name, result)
        if (isWorkflowProgress(call.name, result)) stopReason = null
        stopReason ||= callStopReason || resultStopReason
    }
    let messages = guard.compactIfNeeded(conversation)
    if (stopReason) {
        messages = [
            ...compactResearchConversation(messages, true),
            { role: 'system', content: FINAL_REPLY_INSTRUCTION },
        ]
        console.warn('Assistant: Finalizing bounded research', { reason: stopReason })
    }
    return { messages, stopReason, fallback: () => guard.fallback() }
}

module.exports = {
    prepareResearchRequest,
    compactResearchConversation,
    FINAL_REPLY_INSTRUCTION,
    toolsForFinalReply,
    MAX_RESEARCH_CALLS,
    SCHEDULED_MAX_RESEARCH_CALLS,
    MAX_STALLED_SEARCHES,
}
