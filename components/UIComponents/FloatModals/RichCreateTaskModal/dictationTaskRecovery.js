import { useSyncExternalStore } from 'react'

/**
 * PT-5425: the draft of a dictated task whose background creation could not finish. The popup it
 * came from is closed by then, and its opener may be gone too (a note, a contact, the floating
 * "+" of a board the user has left), so the draft is reopened by ONE app-wide popup
 * (`DictationTaskRecoveryModal`, mounted with the global modals) rather than by each opener.
 *
 * Deliberately not redux: it is one transient value that concerns one popup.
 */

let current = null
let sequence = 0
const listeners = new Set()

const emit = () => listeners.forEach(listener => listener())

/**
 * @param {{ projectId: string, automaticProject?: boolean, task: object, modalTitle?: string }} draft
 * @returns {number} the id of this recovery, for `closeDictationTaskRecovery`.
 */
export const openDictationTaskRecovery = ({ projectId, automaticProject = false, task, modalTitle }) => {
    sequence += 1
    current = { id: sequence, projectId, automaticProject: !!automaticProject, task, modalTitle }
    emit()
    return sequence
}

/** Closes the recovery popup — only the given one, so a newer recovery is never dismissed by an older close. */
export const closeDictationTaskRecovery = id => {
    if (!current) return
    if (id !== undefined && current.id !== id) return
    current = null
    emit()
}

export const getDictationTaskRecovery = () => current

export const subscribeDictationTaskRecovery = listener => {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export const useDictationTaskRecovery = () =>
    useSyncExternalStore(subscribeDictationTaskRecovery, getDictationTaskRecovery, getDictationTaskRecovery)
