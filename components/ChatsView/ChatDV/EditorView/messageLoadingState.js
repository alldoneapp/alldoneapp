export const ASSISTANT_LOADING_TIMEOUT_MS = 5 * 60 * 1000

export const isAwaitingVmInteraction = assistantRun =>
    assistantRun?.kind === 'vm_job' && assistantRun?.status === 'awaiting_user'

export const showsAssistantLiveActivity = (isAssistant, isLoading, assistantRun) =>
    !!isAssistant && !!isLoading && assistantRun?.kind === 'chat'

const LIVE_RUN_STATUSES = ['running', 'queued', 'cancel_requested']

// The newest sign of life the server wrote for a live run. A chat run does not touch the comment's
// lastChangeDate while it calls tools, but it records every tool round in assistantRun.activity
// (and activityHistory). On 2026-11-19 a reply looped through tools for 34 minutes: its comment
// still had the creation time, so after 5 minutes the chat hid the working indicator and the Stop
// button while the run was still writing a new activity every 15 seconds.
export const getAssistantRunLastActivityTime = assistantRun => {
    if (!LIVE_RUN_STATUSES.includes(assistantRun?.status)) return 0
    const times = [
        assistantRun.activity?.startedAt,
        ...(Array.isArray(assistantRun.activityHistory) ? assistantRun.activityHistory : []).map(
            activity => activity?.startedAt
        ),
    ].filter(time => typeof time === 'number' && Number.isFinite(time))
    return times.length ? Math.max(...times) : 0
}

export const resolveEffectiveMessageLoading = (message, messageTime, now = Date.now()) => {
    if (!message?.isLoading) return false

    // Plan reviews, clarifying questions, and sensitive-operation approvals can
    // legitimately wait much longer than the stale-spinner timeout. Keep their
    // interaction card visible until the user responds or the backend expires it.
    if (isAwaitingVmInteraction(message.assistantRun)) return true

    // A spinner is stale when neither the comment nor its live run has changed for the timeout.
    if (!messageTime) return true
    const lastSignOfLife = Math.max(messageTime, getAssistantRunLastActivityTime(message.assistantRun))
    if (now - lastSignOfLife > ASSISTANT_LOADING_TIMEOUT_MS) return false
    return true
}
