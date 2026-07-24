import store from '../redux/store'
import { setCheckTaskItem, setFocusedTaskItem, unsetActiveEditMode, updateAllSelectedTasks } from '../redux/actions'
import { protectModalDismissFromClickThrough, registerPopupDismiss } from './popupDismissGuard'

/**
 * Clear task-list interaction state before a focus change can optimistically
 * reorder the list. On mobile web, also consume the rest of the gesture so it
 * cannot open the task row that moves underneath the pressed focus button.
 */
export const prepareTaskFocusChange = (event, dismissEditMode) => {
    registerPopupDismiss()
    protectModalDismissFromClickThrough(event)

    store.dispatch([
        updateAllSelectedTasks([]),
        setCheckTaskItem('', false),
        setFocusedTaskItem('', false),
        unsetActiveEditMode(),
    ])

    dismissEditMode?.(true)
}
