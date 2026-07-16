export const ASSISTANT_LOADING_TIMEOUT_MS = 5 * 60 * 1000

export const isAwaitingVmInteraction = assistantRun =>
    assistantRun?.kind === 'vm_job' && assistantRun?.status === 'awaiting_user'

export const resolveEffectiveMessageLoading = (message, messageTime, now = Date.now()) => {
    if (!message?.isLoading) return false

    // Plan reviews, clarifying questions, and sensitive-operation approvals can
    // legitimately wait much longer than the stale-spinner timeout. Keep their
    // interaction card visible until the user responds or the backend expires it.
    if (isAwaitingVmInteraction(message.assistantRun)) return true

    if (messageTime && now - messageTime > ASSISTANT_LOADING_TIMEOUT_MS) return false
    return true
}
