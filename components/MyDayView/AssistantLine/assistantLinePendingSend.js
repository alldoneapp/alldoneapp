import { useEffect, useState } from 'react'

import { ASSISTANT_LOADING_TIMEOUT_MS } from '../../ChatsView/ChatDV/EditorView/messageLoadingState'

/**
 * AT-2504 — the in-flight state of a message submitted through the assistant line.
 *
 * The composer used to hold the typed text on screen, frozen and greyed, for the whole of
 * `updateNewAttachmentsData` + `createBotQuickTopic` — and that second call is two round trips
 * (the `createBotQuickTopicSecondGen` callable, then the `createObjectMessage` write), so on an
 * ordinary connection the line sat visibly stuck for a second or more before anything happened.
 * The submit now clears the composer synchronously and the work continues in the background, which
 * leaves a gap this module fills: something has to say that the message went somewhere.
 *
 * That "something" is the Last comment slot, because it is where the answer is going to appear —
 * the pending card occupies exactly the same 90px so nothing reflows when the real preview takes
 * over.
 *
 * Deliberately NOT redux, following `threadAssistantModelState.js` (AT-2502): this concerns one
 * send by one user for a few seconds, and per AT-2336 a slice keyed by project id re-renders every
 * subscriber of that map on every write. It is also deliberately not a React state lifted into
 * `AssistantLine`: the composer (`AssistantOptions`) and the preview (`LastCommentArea`) are
 * siblings, and the same pending send has to be visible from the collapsed row, the expanded card
 * and the All-projects line, which are three different mounts of that subtree.
 *
 * ## Keys
 *
 * An entry is filed under the keys the REAL pointer will later be written under —
 * `lastAssistantCommentData.<projectId>` and `lastAssistantCommentData.allProjects`
 * (`chatsComments.updateLastAssistantCommentData` client-side, `assistantHelper` server-side). The
 * caller passes them rather than the module deriving them, so this file stays dependency-free of
 * the backend graph. Filing under the same keys is what makes the pending card appear exactly
 * where the answer is going to appear, and nowhere else: if the composer's conversation project and
 * the preview's project key disagree (an assistant that lives in another project), the pending card
 * is not shown — which is correct, because the real comment would not show up there either.
 *
 * ## Lifetime
 *
 * Bounded three ways, because a spinner nobody can clear is worse than no spinner at all:
 *   - resolved when the assistant's comment lands (`resolveAssistantLineSendForChat`, driven by
 *     the redux pointer's `creatorType: 'assistant'` — no extra Firestore listener),
 *   - ended when the send itself fails (`endAssistantLineSend`),
 *   - and expired unconditionally after `ASSISTANT_PENDING_SEND_TIMEOUT_MS`. Shared with the Chat
 *     DV's own stale-spinner timeout so the two surfaces give up on the same schedule.
 */

export const ASSISTANT_PENDING_SEND_TIMEOUT_MS = ASSISTANT_LOADING_TIMEOUT_MS

// A failed send has already put the user's text back in the composer, so the card only has to say
// why it reappeared. It is not a state anyone waits in — it self-clears.
export const ASSISTANT_FAILED_SEND_DISPLAY_MS = 6000

export const PENDING_SEND_SENDING = 'sending'
export const PENDING_SEND_AWAITING_REPLY = 'awaiting_reply'
export const PENDING_SEND_FAILED = 'failed'

const entries = new Map()
const subscribers = new Set()
let idCounter = 0

const notify = () => {
    subscribers.forEach(listener => {
        try {
            listener()
        } catch (error) {
            console.warn('[assistantLinePendingSend] subscriber failed:', error)
        }
    })
}

// Each entry carries its own deadline rather than deriving one from `startedAt`, because the
// failure notice lives for seconds while a wait on the assistant lives for minutes.
const hasExpired = (entry, now) => now >= entry.expiresAt

const dropExpired = (now = Date.now()) => {
    let changed = false
    entries.forEach((entry, id) => {
        if (hasExpired(entry, now)) {
            entries.delete(id)
            changed = true
        }
    })
    return changed
}

/**
 * Register a submitted message. Returns the id the caller settles it with, or `null` when there is
 * nothing sensible to file it under — a null id is accepted by every other function here, so a
 * caller never has to branch on it.
 */
export const beginAssistantLineSend = ({
    keys,
    projectId = null,
    assistantId = null,
    assistantName = '',
    text = '',
} = {}) => {
    const filedUnder = (Array.isArray(keys) ? keys : []).filter(key => typeof key === 'string' && key.length > 0)
    if (filedUnder.length === 0) return null

    idCounter += 1
    const id = `assistant-line-send-${idCounter}`
    entries.set(id, {
        id,
        keys: filedUnder,
        projectId,
        assistantId,
        // Carried on the entry rather than resolved by the preview: it names the assistant the
        // message was actually sent to, which the preview cannot know while the thread it would
        // read that from does not exist yet.
        assistantName: typeof assistantName === 'string' ? assistantName : '',
        text: typeof text === 'string' ? text : '',
        chatId: null,
        status: PENDING_SEND_SENDING,
        startedAt: Date.now(),
        expiresAt: Date.now() + ASSISTANT_PENDING_SEND_TIMEOUT_MS,
    })
    notify()
    return id
}

/**
 * The topic exists and the user's own comment is written. From here the wait is on the assistant,
 * and the entry carries the chat id that resolves it.
 */
export const markAssistantLineSendCreated = (id, chatId) => {
    const entry = id ? entries.get(id) : null
    if (!entry || !chatId) return
    entries.set(id, { ...entry, chatId, status: PENDING_SEND_AWAITING_REPLY })
    notify()
}

export const endAssistantLineSend = id => {
    if (id && entries.delete(id)) notify()
}

/**
 * The send never made it. The caller has already put the text back in the composer; this turns the
 * progress card into a short-lived notice so the reappearing text is explained rather than
 * mysterious.
 */
export const failAssistantLineSend = id => {
    const entry = id ? entries.get(id) : null
    if (!entry) return
    entries.set(id, {
        ...entry,
        chatId: null,
        status: PENDING_SEND_FAILED,
        expiresAt: Date.now() + ASSISTANT_FAILED_SEND_DISPLAY_MS,
    })
    notify()
}

/** Called when the assistant has posted into `chatId`. */
export const resolveAssistantLineSendForChat = chatId => {
    if (!chatId) return
    let changed = false
    entries.forEach((entry, id) => {
        if (entry.chatId === chatId) {
            entries.delete(id)
            changed = true
        }
    })
    if (changed) notify()
}

/**
 * The newest live entry filed under `projectKey`.
 *
 * `assistantId` is only compared when the caller passes one — that is the `scopeToAssistant`
 * reading of the preview (an assistant's own board), which must not show a pending send made to a
 * different assistant in the same project.
 */
export const getPendingAssistantLineSend = (projectKey, assistantId = null, now = Date.now()) => {
    if (!projectKey) return null

    let newest = null
    entries.forEach(entry => {
        if (hasExpired(entry, now)) return
        if (!entry.keys.includes(projectKey)) return
        if (assistantId && entry.assistantId !== assistantId) return
        if (!newest || entry.startedAt >= newest.startedAt) newest = entry
    })
    return newest
}

/**
 * True when the last-comment pointer says the assistant itself has now posted into the pending
 * chat. `creatorType` is the discriminator and it is written by both producers: `'user'` by
 * `chatsComments.updateLastAssistantCommentData` for our own comment (which lands FIRST and must
 * not end the wait), `'assistant'` by the server once the answer exists.
 */
export const assistantHasRepliedToPendingSend = (pending, lastCommentData) => {
    if (!pending?.chatId || !lastCommentData) return false
    if (lastCommentData.objectId !== pending.chatId) return false
    return lastCommentData.creatorType === 'assistant'
}

/** Exported for tests: module-level state outlives a test file otherwise. */
export const resetAssistantLinePendingSends = () => {
    entries.clear()
    idCounter = 0
}

export const useAssistantLinePendingSend = (projectKey, assistantId = null) => {
    const [pending, setPending] = useState(() => getPendingAssistantLineSend(projectKey, assistantId))

    useEffect(() => {
        let active = true
        let expiryTimer = null

        const sync = () => {
            if (!active) return
            const next = getPendingAssistantLineSend(projectKey, assistantId)
            setPending(next)

            // An entry nobody settles has to stop being rendered on its own, and no further store
            // event is coming to make that happen — so the timeout is what re-renders it away.
            if (expiryTimer) clearTimeout(expiryTimer)
            expiryTimer = null
            if (next) {
                const remaining = Math.max(0, next.expiresAt - Date.now())
                expiryTimer = setTimeout(() => {
                    dropExpired()
                    sync()
                }, remaining + 1)
            }
        }

        subscribers.add(sync)
        sync()

        return () => {
            active = false
            subscribers.delete(sync)
            if (expiryTimer) clearTimeout(expiryTimer)
        }
    }, [projectKey, assistantId])

    return pending
}
