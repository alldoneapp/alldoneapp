import { isEqual } from 'lodash'

/**
 * AT-2267 - lets a background update survive a save from an editor that was already open.
 *
 * `EditTask` clones the task into `tmpTask` when the editor mounts and never re-syncs it, and
 * `updateTask` persists the *whole* document. So anything written to the task while the editor is
 * open - an assistant assigning a goal, a collaborator changing the due date, a recurrence bump - is
 * silently reverted the moment the user presses Save.
 *
 * Until AT-2267 that was mostly hidden: a background `parentGoalId` write unmounted the editor
 * outright, so there was no save to revert with. Now that the editor legitimately stays open across
 * background updates, the stale write is reachable, and the auto-assigned goal would disappear a few
 * keystrokes after it appeared.
 *
 * The fix is to send a *diff* rather than a snapshot: whatever the user actually touched in this
 * editing session wins, and every other field comes from the live task document. Only fields the
 * user changed are compared, so a field nobody touched can never be written back to a stale value.
 *
 * @param openedTask  the task exactly as it was when the editor opened (the base of `tmpTask`)
 * @param editedTask  the task the editor is about to save
 * @param remoteTask  the live task document, including any background updates
 */
export const mergeBackgroundTaskUpdates = (openedTask, editedTask, remoteTask) => {
    if (!editedTask || !openedTask || !remoteTask) return editedTask

    const merged = { ...remoteTask }

    Object.keys(editedTask).forEach(field => {
        if (!isEqual(editedTask[field], openedTask[field])) merged[field] = editedTask[field]
    })

    return merged
}

export default mergeBackgroundTaskUpdates
