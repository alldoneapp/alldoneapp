import { useCallback, useEffect, useRef, useState } from 'react'

import { getEmailTaskArchiveData, getGmailTaskData } from '../../../../utils/Gmail/gmailTaskUtils'
import { PROVIDER_MICROSOFT } from '../../../../utils/IntegrationProviders'
import { archiveEmailInBackground } from '../../../TaskListView/TaskItem/TaskPresentation/CheckBoxContainer/emailTaskCompletion'
import { translate } from '../../../../i18n/TranslationService'

// AT-3164: postponing an email task can also archive its email in Gmail. The task takes over the
// follow-up in Alldone (it comes back on the chosen date), so the mail can leave the inbox now.
// No Gmail snooze and nothing ever moves the mail back to the inbox.
//
// Only a single existing Gmail task that is still open qualifies. Bulk, goal and project postpones
// write many tasks at once, and the edit-mode date picker only sets a draft that is saved later.
export function getPostponeEmailArchiveData({
    task,
    inEditTask,
    multipleTasks,
    inParentGoal,
    postponeProject,
    updateParentGoalReminderDate,
    goal,
} = {}) {
    if (!task?.id || task.done) return null
    if (inEditTask || multipleTasks || inParentGoal || postponeProject || updateParentGoalReminderDate || goal) {
        return null
    }
    // The option is labelled "in Gmail"; Outlook tasks keep the old dialog.
    if (getGmailTaskData(task)?.provider === PROVIDER_MICROSOFT) return null
    return getEmailTaskArchiveData(task)
}

// True only on positive evidence that a linked message is still in the inbox. A state that could
// not be read is omitted by the server, so "unknown" hides the option rather than offering it.
export function isEmailStillInInbox(states, messageIds = []) {
    if (!Array.isArray(states)) return false
    const linkedIds = new Set(messageIds)
    return states.some(
        state => state && linkedIds.has(state.messageId) && state.exists !== false && state.inInbox === true
    )
}

// Lazily required (the `linkedEmailActions` pattern): the backend module pulls in the redux store
// and the Firebase client, which every test that renders the date picker would otherwise load.
const getEmailLineBackend = () => require('../../../../utils/backends/EmailLine/emailLineBackend')

const getErrorMessage = error => (error?.message ? `: ${error.message}` : '')

/**
 * Wraps the task's postpone write. The email is archived only after the write succeeded, so a
 * failed postpone never leaves the mail gone from both the inbox and today's list. The archive
 * runs in the background and reports its own failure; the task stays postponed either way.
 */
export function wrapPostponeWithEmailArchive(write, { archiveData, archiveEmailAction, notify = alert } = {}) {
    if (!archiveData) return write

    return async (...args) => {
        let result
        try {
            result = await write(...args)
        } catch (error) {
            notify(translate("The task couldn't be postponed, so the email was not archived in Gmail"))
            throw error
        }

        const action = archiveEmailAction || getEmailLineBackend().performEmailLineAction
        archiveEmailInBackground(archiveData, action).catch(error => {
            console.error('[email task postpone] Could not archive linked email', error)
            notify(
                `${translate("The task was postponed, but the email couldn't be archived in Gmail")}${getErrorMessage(
                    error
                )}`
            )
        })
        return result
    }
}

/**
 * Asks the mailbox whether the linked email is still in the inbox and keeps the option's state.
 * The option is hidden until that answer is a clear yes, and it starts checked.
 */
export function useEmailPostponeArchiveOption(archiveData, { fetchMessageStates } = {}) {
    const [inInbox, setInInbox] = useState(false)
    const [checked, setChecked] = useState(true)
    const stateRef = useRef({ inInbox: false, checked: true })
    stateRef.current = { inInbox, checked }

    const requestKey = archiveData ? `${archiveData.connectionProjectId}:${archiveData.messageIds.join('|')}` : ''

    useEffect(() => {
        setInInbox(false)
        if (!archiveData) return undefined

        let cancelled = false
        const fetchStates = fetchMessageStates || getEmailLineBackend().fetchEmailLineMessageStates
        Promise.resolve()
            .then(() => fetchStates(archiveData.connectionProjectId, archiveData.messageIds))
            .then(states => {
                if (!cancelled) setInInbox(isEmailStillInInbox(states, archiveData.messageIds))
            })
            .catch(error => {
                // Offline, an expired connection or a mailbox of someone else: no option, no alert.
                if (__DEV__) console.warn('[email task postpone] Could not read email state', error?.message)
            })
        return () => {
            cancelled = true
        }
    }, [requestKey])

    const toggle = useCallback(() => setChecked(value => !value), [])

    // Read at confirmation time, from a ref, so a date picked right after toggling sees the toggle.
    const shouldArchive = useCallback(
        () => !!archiveData && stateRef.current.inInbox && stateRef.current.checked,
        [requestKey]
    )

    return { visible: !!archiveData && inInbox, checked, toggle, shouldArchive }
}
