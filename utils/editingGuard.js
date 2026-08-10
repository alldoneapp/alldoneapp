import { useSelector } from 'react-redux'

/**
 * Central "the user is busy typing / has something open" guard.
 *
 * Background data (a task created by an assistant, a collaborator's edit, a
 * Firestore snapshot echo) must never destroy work in progress. An open editor
 * is fragile for two independent reasons:
 *
 *  1. Open state and draft text live in component-local state
 *     (`DismissibleItem.state.visibleModal`, `SocialTextInput.state.text`,
 *     `EditTask`'s `tmpTask`). If the subtree unmounts, the popup closes and
 *     the typed text is gone.
 *  2. Even without an unmount, *moving* a mounted DOM node (which React does
 *     when a keyed list reorders) blurs whatever is focused inside it. Focus
 *     and caret position are lost even though the popup is technically open.
 *
 * So any render path that can unmount or reorder a mounted editor must be
 * frozen while this returns true. Note the goal is NOT to hide incoming data:
 * new tasks still render immediately. Only *restructuring* of what is already
 * mounted is deferred until the user is done.
 *
 * The redux half of the signal is reactive and therefore usable from render:
 *  - `activeEditMode`      - an inline/add task, goal or note editor is mounted
 *                            (set by EditTask / EditGoal / EditNote on mount).
 *  - `showFloatPopup > 0`  - a float popup (due date, estimation, parent goal,
 *                            description, ...) is stacked on top.
 *  - `taskTitleInEditMode` - a title is being edited in place.
 *
 * The DOM half (`isEditableElementFocused`) catches plain inputs and Quill
 * surfaces that register no redux state - chat/comment composers, search
 * fields. It is *not* reactive, so it is only consulted from imperative call
 * sites.
 *
 * This module deliberately keeps its imports to `react-redux` only. It is a
 * leaf utility pulled into render paths and test suites all over the app;
 * reaching for `utils/HelperFunctions` (which transitively loads
 * `utils/backends/firestore`, and with it the env-var imports) would drag the
 * whole Firebase layer into every consumer. Hence the local DOM check below
 * and the lazy `redux/store` require.
 */

/**
 * Local copy of `HelperFunctions.isInputsFocused`, hardened against a null
 * `activeElement` (which the original dereferences unguarded) and against
 * running where there is no DOM at all.
 */
export const isEditableElementFocused = () => {
    if (typeof document === 'undefined') return false

    const activeElement = document.activeElement
    if (!activeElement) return false

    const tagName = activeElement.tagName ? activeElement.tagName.toLowerCase() : ''
    if (tagName === 'input' || tagName === 'textarea') return true
    if (activeElement.isContentEditable) return true

    return !!activeElement.classList && activeElement.classList.contains('ql-editor')
}
export const isEditingState = state =>
    !!state && (state.activeEditMode === true || state.showFloatPopup > 0 || state.taskTitleInEditMode === true)

/**
 * Reactive, render-safe variant. Use this to freeze list restructuring.
 */
export const useIsUserEditing = () => useSelector(isEditingState)

/**
 * Imperative variant, including DOM focus. Use this to guard side effects that
 * tear down or collapse a subtree (re-subscribing a listener, collapsing a
 * list, ...).
 */
export const isUserEditing = state => {
    // Lazily resolved so importing this module never pulls in the store.
    const resolvedState = state === undefined ? require('../redux/store').default.getState() : state
    if (isEditingState(resolvedState)) return true

    // Never let a DOM quirk break a caller that is only asking a question.
    try {
        return isEditableElementFocused()
    } catch (e) {
        return false
    }
}

export default isUserEditing
