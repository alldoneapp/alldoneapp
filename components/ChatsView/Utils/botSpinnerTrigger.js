import { ASSISTANT_LOADING_TIMEOUT_MS } from '../ChatDV/EditorView/messageLoadingState'

// A bot spinner trigger is a ONE-SHOT, CHAT-SCOPED request to show the "assistant is
// working on an answer" placeholder in the Chat DV that is about to be opened.
//
// It must never be a bare global boolean (AT-2084): flows that start an assistant run
// without navigating to the new thread (`skipNavigation: true`, e.g. the My Day assistant
// line or a pre-config task launched from the search modal) would otherwise leave a stale
// `true` in the store. The next Chat DV that mounts — any task, assistant not even enabled
// there — consumed it on mount and showed the placeholder forever, because no assistant
// message would ever arrive in that unrelated chat. Leaving the tab cleared the flag, so
// re-entering looked "fixed" while the assistant never answered.
export const BOT_SPINNER_TRIGGER_TTL_MS = ASSISTANT_LOADING_TIMEOUT_MS

export const buildBotSpinnerTrigger = (projectId, chatId, createdAt = Date.now()) =>
    projectId && chatId ? { projectId, chatId, createdAt } : null

export const shouldConsumeBotSpinnerTrigger = (trigger, projectId, chatId, now = Date.now()) => {
    // Legacy/unscoped triggers (plain booleans) are ignored on purpose: we cannot tell which
    // chat they belong to, and honoring them means showing a spinner in the wrong chat.
    if (!trigger || typeof trigger !== 'object') return false
    if (!projectId || !chatId) return false
    if (trigger.projectId !== projectId || trigger.chatId !== chatId) return false

    // A trigger that was never consumed (the target chat was never opened) must expire so it
    // cannot surface a spinner for a run that finished, or failed, long ago.
    const { createdAt } = trigger
    if (typeof createdAt === 'number' && now - createdAt > BOT_SPINNER_TRIGGER_TTL_MS) return false

    return true
}
