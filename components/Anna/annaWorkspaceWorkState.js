const terminal = new Set(['completed', 'failed', 'cancelled', 'incomplete', 'expired'])

// Use persisted run status, never the spinner timeout or the HTTP request ending.
// A completed parent with a running/awaiting-user VM child is still ongoing work.
//
// `busy` is deliberately conservative (an unloaded thread counts as busy) because it
// gates the automatic return to Home. `running` answers a narrower question for the
// workspace frame's "working" signal: is the assistant answering right now? A VM job
// works in its own sandbox for hours and a run awaiting the user is waiting, not
// working, so neither lights the frame, and an unloaded thread never flashes it.
export function getAnnaWorkspaceWorkState(messages) {
    const byRequest = new Map()
    let busy = !messages.loaded
    let running = false
    messages.forEach(message => {
        const run = message.assistantRun
        if (!run && !message.fromAssistant) return
        const pending = !!message.isLoading || (!!run && !terminal.has(run.status))
        if (pending) busy = true
        if (
            !!message.isLoading ||
            (!!run && !terminal.has(run.status) && run.kind !== 'vm_job' && run.status !== 'awaiting_user')
        )
            running = true
        if (!run?.triggerMessageId) return
        const completed = !pending && run.status === 'completed'
        byRequest.set(run.triggerMessageId, completed && byRequest.get(run.triggerMessageId) !== false)
    })
    return {
        busy,
        running,
        completedRequests: [...byRequest].filter(([, completed]) => completed).map(([id]) => id),
    }
}
