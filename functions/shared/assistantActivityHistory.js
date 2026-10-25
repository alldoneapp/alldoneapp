const MAX_ASSISTANT_ACTIVITY_HISTORY = 8

// Store only the display descriptor, never tool arguments or results. Subjects have
// already passed assistantToolActivity's allowlist and sanitizer.
const copyActivity = activity => {
    if (!activity || !['preparing', 'thinking', 'tool', 'composing'].includes(activity.phase)) return null
    const result = { phase: activity.phase }
    for (const field of [
        'toolName',
        'actionKey',
        'subject',
        'startedAt',
        'iteration',
        'total',
        'completed',
        'active',
    ]) {
        if (typeof activity[field] === 'string' || typeof activity[field] === 'number') result[field] = activity[field]
    }
    return result
}

const getAssistantActivityKey = activity =>
    JSON.stringify([
        activity?.phase,
        activity?.toolName,
        activity?.startedAt,
        activity?.iteration,
        // Older descriptors may lack an execution identity.
        activity?.startedAt == null && activity?.iteration == null ? activity?.actionKey : null,
        activity?.startedAt == null && activity?.iteration == null ? activity?.subject : null,
    ])

const appendAssistantActivity = (history, activity) => {
    const entries = (Array.isArray(history) ? history : []).map(copyActivity).filter(Boolean)
    const next = copyActivity(activity)
    if (next) {
        if (entries.length && getAssistantActivityKey(entries[entries.length - 1]) === getAssistantActivityKey(next)) {
            // Heartbeats and parallel-tool counts update the same activity in place.
            entries[entries.length - 1] = next
        } else {
            entries.push(next)
        }
    }
    return entries.slice(-MAX_ASSISTANT_ACTIVITY_HISTORY)
}

const advanceAssistantActivity = (run, activity) => ({
    activity,
    activityHistory: appendAssistantActivity(run.activityHistory || [run.activity], activity),
})

module.exports = {
    MAX_ASSISTANT_ACTIVITY_HISTORY,
    getAssistantActivityKey,
    appendAssistantActivity,
    advanceAssistantActivity,
}
