// Only audited, stateless reads may overlap. Unknown tools, browser sessions,
// delegation, voice controls, writes and attachment handoffs are ordering barriers.
const PARALLEL_READ_TOOLS = new Set([
    'web_search',
    'fetch_url',
    'search',
    'get_tasks',
    'get_chats',
    'get_updates',
    'get_contacts',
    'get_goals',
    'get_project_okrs',
    'get_project_happiness',
    'get_user_projects',
    'get_focus_task',
    'get_note',
    'get_notes',
    'get_route_info',
    'get_weather',
    'get_local_recommendations',
    'search_gmail',
    'list_recent_chat_media',
    'find_calendar_availability',
    'search_calendar_events',
])
const MAX_PARALLEL_TOOL_CALLS = 5
const canRunToolInParallel = call => PARALLEL_READ_TOOLS.has(call?.function?.name)

async function executeToolCallBatch(
    calls,
    execute,
    { canRunInParallel = canRunToolInParallel, onState = () => {} } = {}
) {
    const results = new Array(calls.length)
    const active = new Set()
    let completed = 0
    let failure = null
    const publish = () => {
        // Progress is advisory and must never orphan an in-flight operation.
        try {
            onState({ total: calls.length, completed, active: [...active] })
        } catch (_) {}
    }
    const run = async index => {
        if (failure) return
        active.add(index)
        try {
            publish()
            results[index] = await execute(calls[index], index)
            completed++
        } catch (error) {
            failure ||= error
        } finally {
            active.delete(index)
            publish()
        }
    }
    for (let start = 0; start < calls.length && !failure;) {
        if (!canRunInParallel(calls[start])) {
            await run(start++)
            continue
        }
        let end = start + 1
        while (end < calls.length && canRunInParallel(calls[end])) end++
        let next = start
        const worker = async () => {
            while (next < end && !failure) await run(next++)
        }
        // Drain every in-flight read before reporting cancellation/failure or
        // starting a write. No orphan promise may outlive the assistant run.
        await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_TOOL_CALLS, end - start) }, worker))
        start = end
    }
    if (failure) throw failure
    return results
}

module.exports = { executeToolCallBatch, canRunToolInParallel, MAX_PARALLEL_TOOL_CALLS }
