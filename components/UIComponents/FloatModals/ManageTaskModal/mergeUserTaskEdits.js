/**
 * Protects an unsaved, user-typed task title from remote overwrites.
 *
 * `TaskEditionMode` holds the task being edited in `state.tempTask` and only
 * persists the title when the modal is submitted. Its `componentDidUpdate`
 * rebuilds `tempTask` from `props.task` whenever the task document changes -
 * and that document changes for reasons that have nothing to do with the title:
 * a new comment, a `lastEditionDate` bump, an assistant editing the task in the
 * background.
 *
 * Replacing `tempTask` wholesale in that situation silently reverts what the
 * user typed. The failure is especially nasty because it is invisible: the
 * Quill editor keeps displaying the typed title (`initialTextExtended` is
 * mount-only), so the user sees their text right up until the old value is
 * saved over it.
 *
 * So take everything from the remote task except the title, which stays
 * user-owned from the first keystroke until submit.
 */
export const mergeUserTaskEdits = (remoteTask, localTask, userEditedExtendedName) => {
    if (!userEditedExtendedName || !localTask || !remoteTask) return remoteTask

    return {
        ...remoteTask,
        extendedName: localTask.extendedName,
        name: localTask.name,
    }
}

export default mergeUserTaskEdits
