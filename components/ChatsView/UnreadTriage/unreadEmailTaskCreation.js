import { useMemo, useSyncExternalStore } from 'react'

import { translate } from '../../../i18n/TranslationService'
import { requestEmailTaskCreation } from '../../TaskListView/EmailLine/EmailTaskAction'
import { runWithLastUnreadRedirect } from '../lastUnreadRedirect'

/**
 * "Create email task" from the unread list (AT-3187): the row leaves the list on the press, and the
 * task is created by the server in the background, as before (AT-3165, `createTask`).
 *
 * The press:
 * 1. Marks the email `pending`. The list drops every row of a pending email in the same render
 *    (UnreadMessagesList), before anything is written.
 * 2. Clears the unread state of every comment of the email, the way Archive does (AT-2424,
 *    `clearChatCommentsForLinkedEmails`). The delete lands in the local cache at once, so the unread
 *    counters drop with the row, and the last-unread redirect (AT-3104/3108) can move on at once.
 * 3. Asks the server for the task. On success the email is `created`; its comments are marked read
 *    once more, which catches a comment that came in while the task was being created (the old
 *    post-create step).
 * 4. On failure the unread state is restored, then the email becomes `failed`: the row is back,
 *    with a red action and a "try again" line (decided with Karsten, 2026-11-27). If the press has
 *    already opened the tasks, the row is no longer on screen, so an alert says it instead, as the
 *    archive buttons do.
 *
 * The state is module-level on purpose: the row that was pressed unmounts at step 1, and the
 * failure arrives seconds later. Kept in the row (or in a provider that the redirect unmounts), it
 * would land nowhere and the email would come back with nothing saying why.
 *
 * No duplicates: a press for an email that is pending returns the running request instead of
 * sending another, and `requestEmailTaskCreation` shares one request with the thread's button for
 * the same email. A retry only starts after the failed request settled, and the server returns the
 * existing task for an email that already has one.
 */

export const EMAIL_TASK_PENDING = 'pending'
export const EMAIL_TASK_CREATED = 'created'
export const EMAIL_TASK_FAILED = 'failed'

// Lazy, like the row's other backend calls: the module pulls in the redux store and the Firebase client.
const chatReadActions = () => require('../../../utils/backends/Chats/markChatCommentsAsRead')

let entries = {}
const runs = new Map()
const listeners = new Set()

const setEntry = (key, entry) => {
    entries = { ...entries, [key]: entry }
    listeners.forEach(listener => listener())
}

const subscribe = listener => {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

const getEntries = () => entries

const normalizeTask = task => (task?.taskId && task?.projectId ? task : null)

/** The state of one email's task creation: `{ status, task }`, or null when nothing was pressed. */
export const getUnreadEmailTaskEntry = key => (key && entries[key]) || null

export function useUnreadEmailTaskEntry(key) {
    return useSyncExternalStore(subscribe, () => getUnreadEmailTaskEntry(key))
}

/** The linked-email keys whose task is being created; their rows stay out of the unread list. */
export function usePendingUnreadEmailTaskKeys() {
    const current = useSyncExternalStore(subscribe, getEntries)
    return useMemo(
        () => new Set(Object.keys(current).filter(key => current[key].status === EMAIL_TASK_PENDING)),
        [current]
    )
}

async function createAndSettle(linkedEmail, redirect) {
    const { key } = linkedEmail
    let restoreUnreadState = null
    try {
        restoreUnreadState = await chatReadActions().clearChatCommentsForLinkedEmails([linkedEmail])
    } catch (error) {
        // The task is what the user asked for; the unread state is cleared again after it.
        console.error('[unread list] Could not clear the email before creating its task', error)
    }

    let task
    try {
        task = normalizeTask(
            await requestEmailTaskCreation(linkedEmail.connectionProjectId, {
                action: 'createTask',
                messageIds: [linkedEmail.messageId],
                labelId: null,
                labelName: null,
            })
        )
        if (!task) throw new Error('The server returned no task')
    } catch (error) {
        console.error('[unread list] Could not create the email task', error)
        // Restored while the row is still hidden as pending, so it comes back once, with its hint.
        if (restoreUnreadState) await restoreUnreadState()
        setEntry(key, { status: EMAIL_TASK_FAILED, task: null })
        if (redirect?.leftChats?.()) alert(translate("Task couldn't be created. Try again"))
        return false
    }

    try {
        await chatReadActions().markAlldoneChatsReadForLinkedEmails([linkedEmail])
    } catch (error) {
        console.error('[unread list] Could not mark the email as read after creating its task', error)
    }
    setEntry(key, { status: EMAIL_TASK_CREATED, task })
    return task
}

/**
 * Creates the task for the email of an unread row. Resolves to the task, or to false when it failed
 * (never rejects). Pressing again while it runs returns the same promise.
 */
export function createUnreadEmailTask(projectId, linkedEmail) {
    const key = linkedEmail?.key
    if (!key || !linkedEmail.connectionProjectId || !linkedEmail.messageId) return Promise.resolve(false)
    const running = runs.get(key)
    if (running) return running

    setEntry(key, { status: EMAIL_TASK_PENDING, task: null })
    const run = Promise.resolve(
        runWithLastUnreadRedirect([projectId], redirect => createAndSettle(linkedEmail, redirect))
    ).catch(error => {
        // Never leave an email hidden as pending: whatever went wrong, its row comes back to retry.
        console.error('[unread list] Email task creation stopped unexpectedly', error)
        setEntry(key, { status: EMAIL_TASK_FAILED, task: null })
        return false
    })
    runs.set(key, run)
    const clear = () => {
        if (runs.get(key) === run) runs.delete(key)
    }
    run.then(clear, clear)
    return run
}

/** Tests only. */
export function resetUnreadEmailTaskCreation() {
    entries = {}
    runs.clear()
    listeners.forEach(listener => listener())
}
