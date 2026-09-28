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

// The trigger only says "start waiting"; this says "stop waiting". The code that started a
// server-hosted run knows when that request has settled — succeeded, failed, or was refused
// before the server posted anything — while the Chat DV only knows that no assistant message
// has arrived yet. Without this a refused or failed run left the placeholder up for the full
// ASSISTANT_LOADING_TIMEOUT_MS, which reads as "the assistant is still working" long after it
// stopped. A settled request ends the wait in the chat it was started for, whether or not the
// Chat DV has consumed the trigger yet.
const waitEndListeners = new Set()

export const subscribeBotSpinnerWaitEnd = listener => {
    waitEndListeners.add(listener)
    return () => waitEndListeners.delete(listener)
}

export const endBotSpinnerWait = (projectId, chatId) => {
    if (!projectId || !chatId) return
    // Lazy: this module is imported by chat rows and tests that must not pull in the store.
    const store = require('../../../redux/store').default
    const { setTriggerBotSpinner } = require('../../../redux/actions')
    const pending = store.getState().triggerBotSpinner
    if (pending && typeof pending === 'object' && pending.projectId === projectId && pending.chatId === chatId) {
        store.dispatch(setTriggerBotSpinner(null))
    }
    waitEndListeners.forEach(listener => listener(projectId, chatId))
}
