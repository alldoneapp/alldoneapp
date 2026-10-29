const terminal = new Set(['completed', 'failed', 'cancelled', 'incomplete', 'expired'])

// Use persisted run status, never the spinner timeout or the HTTP request ending.
// A completed parent with a running/awaiting-user VM child is still ongoing work.
export function getAnnaWorkspaceWorkState(messages) {
    const byRequest = new Map()
    let busy = !messages.loaded
    messages.forEach(message => {
        const run = message.assistantRun
        if (!run && !message.fromAssistant) return
        const pending = !!message.isLoading || (!!run && !terminal.has(run.status))
        if (pending) busy = true
        if (!run?.triggerMessageId) return
        const completed = !pending && run.status === 'completed'
        byRequest.set(run.triggerMessageId, completed && byRequest.get(run.triggerMessageId) !== false)
    })
    return {
        busy,
        completedRequests: [...byRequest].filter(([, completed]) => completed).map(([id]) => id),
    }
}
