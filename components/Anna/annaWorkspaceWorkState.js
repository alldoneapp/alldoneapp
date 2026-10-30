const terminal = new Set(['completed', 'failed', 'cancelled', 'incomplete', 'expired'])

// Use persisted run status, never the spinner timeout or the HTTP request ending.
// A completed parent with a running/awaiting-user VM child is still ongoing work.
//
// `busy` is deliberately conservative (an unloaded thread counts as busy) because it
// gates the automatic return to Home. `changingWorkspace` answers a much narrower
// question for the workspace frame (AT-2926): is a tool that changes an Alldone object
// executing right now? Thinking, streaming an answer and read-only tools leave the frame
// in its default colour. The server publishes the active call on `assistantRun.activity`
// (`phase: 'tool'` plus `changesWorkspace`, see functions/shared/
// assistantWorkspaceChangeTools.js) and moves it to `composing` once the batch returns; a
// terminal status (completed, failed, cancelled) clears it too. Any live message in the
// thread counts, so overlapping runs keep the frame lit until the last change finishes.
// VM jobs and runs waiting for the user never count, and an unloaded thread never does.
export const isAnnaWorkspaceChangeRunning = run =>
    !!run &&
    !terminal.has(run.status) &&
    run.status !== 'awaiting_user' &&
    run.kind !== 'vm_job' &&
    run.activity?.phase === 'tool' &&
    run.activity.changesWorkspace === true

export function getAnnaWorkspaceWorkState(messages) {
    const byRequest = new Map()
    let busy = !messages.loaded
    let changingWorkspace = false
    messages.forEach(message => {
        const run = message.assistantRun
        if (!run && !message.fromAssistant) return
        const pending = !!message.isLoading || (!!run && !terminal.has(run.status))
        if (pending) busy = true
        if (isAnnaWorkspaceChangeRunning(run)) changingWorkspace = true
        if (!run?.triggerMessageId) return
        const completed = !pending && run.status === 'completed'
        byRequest.set(run.triggerMessageId, completed && byRequest.get(run.triggerMessageId) !== false)
    })
    return {
        busy,
        changingWorkspace,
        completedRequests: [...byRequest].filter(([, completed]) => completed).map(([id]) => id),
    }
}
