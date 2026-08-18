// AT-2363: dropping files straight onto a task row in the list appends them to that task's
// description, without opening the task or its description editor.
//
// The established insert path (AttachmentDropZone -> insertAttachmentInsideEditor) needs a live
// Quill instance to embed a blot into, and a task row has none. So this module reproduces the
// SAME persisted representation headlessly: it builds the exact sentinel-delimited "new
// attachment" word that CustomTextInput3 would have serialised, hands it to the shared
// `updateNewAttachmentsData` uploader, and appends the resolved word to `task.description`.
// Nothing here re-implements uploading, quota accounting or the description mutation — those
// stay in `Backend.storeAttachment` and `setTaskDescription`.

import {
    ATTACHMENT_TRIGGER,
    IMAGE_TRIGGER,
    VIDEO_TRIGGER,
    updateNewAttachmentsData,
} from '../../../Feeds/Utils/HelperFunctions'
import { getAttachmentData, getImageData, getVideoData } from '../../../../functions/Utils/parseTextUtils'
import { NEW_ATTACHMENT, fileIsImage, fileIsVideo } from '../../../Feeds/CommentsTextInput/textInputHelper'
import { addFilesAsAttachments } from '../../../Feeds/CommentsTextInput/attachmentFileUtils'
import { setTaskDescription } from '../../../../utils/backends/Tasks/tasksFirestore'
import Backend from '../../../../utils/BackendBridge'

// A `blob:` uri only ever exists in this browser tab. Persisting one would render as a
// permanently broken image/attachment for everybody, including the author after a reload.
const LOCAL_URI_PREFIX = 'blob:'

/**
 * Whether a row may accept a file drop.
 *
 * The first four flags are exactly what makes the description editable in the detailed view
 * (see PropertiesView's `disabled` prop on DescriptionField) — a drop must never be a way around
 * a permission the DV enforces. The rest are row-only states in which the row is not a real,
 * directly-editable task: organize mode (the row IS the drag handle), a suggested task (not
 * persisted yet) and the comment popup header (a read-only echo of the task).
 *
 * Callers pass booleans rather than the raw task so this stays dependency-free and testable.
 */
export const canDropFilesOnTaskRow = ({
    accessGranted,
    loggedUserCanUpdateObject,
    isCalendarTask,
    isAssistantTask,
    isLocked,
    isActiveOrganizeMode,
    isSuggested,
    inCommentPopup,
} = {}) =>
    !!accessGranted &&
    !!loggedUserCanUpdateObject &&
    !isCalendarTask &&
    !isAssistantTask &&
    !isLocked &&
    !isActiveOrganizeMode &&
    !isSuggested &&
    !inCommentPopup

/**
 * The word CustomTextInput3 serialises for a freshly inserted embed, per file kind.
 * Images carry a second uri because the editor keeps a separate resized thumbnail.
 */
export const buildNewAttachmentToken = (name, uri) => {
    if (fileIsImage(name)) {
        return `${IMAGE_TRIGGER}${uri}${IMAGE_TRIGGER}${uri}${IMAGE_TRIGGER}${name}${IMAGE_TRIGGER}${NEW_ATTACHMENT}`
    }
    if (fileIsVideo(name)) {
        return `${VIDEO_TRIGGER}${uri}${VIDEO_TRIGGER}${name}${VIDEO_TRIGGER}${NEW_ATTACHMENT}`
    }
    return `${ATTACHMENT_TRIGGER}${uri}${ATTACHMENT_TRIGGER}${name}${ATTACHMENT_TRIGGER}${NEW_ATTACHMENT}`
}

const uriIsRemote = uri => typeof uri === 'string' && uri.length > 0 && !uri.startsWith(LOCAL_URI_PREFIX)

/**
 * `updateNewAttachmentsData` swallows upload errors and returns the word UNCHANGED when the
 * upload failed, so "it returned a string" is not success. Persisting that unchanged word is
 * the one genuinely destructive outcome available here, so every token is verified to carry a
 * remote uri and to have lost its NEW marker before it is allowed anywhere near Firestore.
 */
export const isStoredAttachmentToken = token => {
    if (typeof token !== 'string' || token.length === 0) return false

    if (token.startsWith(IMAGE_TRIGGER)) {
        const { uri, resizedUri, isNew } = getImageData(token)
        return isNew !== NEW_ATTACHMENT && uriIsRemote(uri) && uriIsRemote(resizedUri)
    }
    if (token.startsWith(VIDEO_TRIGGER)) {
        const { uri, isNew } = getVideoData(token)
        return isNew !== NEW_ATTACHMENT && uriIsRemote(uri)
    }
    if (token.startsWith(ATTACHMENT_TRIGGER)) {
        const { uri, isNew } = getAttachmentData(token)
        return isNew !== NEW_ATTACHMENT && uriIsRemote(uri)
    }
    return false
}

/**
 * Appends without touching a single character of what is already there.
 *
 * The description is a space-separated word list (see `parseFeedComment`), and every regex that
 * recognises an embed is anchored with `^`. A token therefore has to be its OWN word or it
 * renders as raw sentinel garbage — which is why the separator is "\n " and not "\n": the
 * newline stays attached to the preceding text word, exactly as CustomTextInput3 serialises an
 * embed that follows a line break.
 */
export const appendTokensToDescription = (description, tokens) => {
    const validTokens = (tokens || []).filter(token => typeof token === 'string' && token.length > 0)
    if (validTokens.length === 0) return typeof description === 'string' ? description : ''

    const appended = validTokens.join(' ')
    const base = typeof description === 'string' ? description : ''
    if (base.trim().length === 0) return appended
    if (base.endsWith('\n')) return `${base} ${appended}`
    return `${base}\n ${appended}`
}

/**
 * Uploads every dropped file and appends the results to the task description.
 *
 * Returns `{ addedCount, failedCount }`. The description write happens once, for whatever
 * uploaded successfully — a single failed file must not discard the ones that worked, and a
 * fully failed drop must not write at all.
 */
export const addDroppedFilesToTaskDescription = async ({ projectId, task, files }) => {
    const pending = []

    // Reuses the shared size gate (50 MB + the translated alert) and filename normalisation, so
    // a row drop behaves identically to a drop on the description editor.
    addFilesAsAttachments(files, (name, uri) => {
        pending.push({ token: buildNewAttachmentToken(name, uri), uri })
    })

    if (pending.length === 0) return { addedCount: 0, failedCount: 0 }

    const storedTokens = []
    let failedCount = 0

    for (const { token, uri } of pending) {
        let resolved = ''
        try {
            // Only the new word is processed — never the existing description. Re-running the
            // stored text through the uploader would be pure risk for zero gain.
            resolved = await updateNewAttachmentsData(projectId, token)
        } catch (error) {
            resolved = ''
        }

        if (isStoredAttachmentToken(resolved.trim())) {
            storedTokens.push(resolved.trim())
        } else {
            failedCount += 1
        }

        // The bytes are in Storage (or the upload failed); either way this tab no longer needs
        // to pin the file in memory.
        try {
            URL.revokeObjectURL(uri)
        } catch (error) {}
    }

    if (storedTokens.length === 0) return { addedCount: 0, failedCount }

    // Uploading a large file takes seconds, and the row's `task` prop is a snapshot from before
    // the drop. Re-reading here shrinks the window in which a description edited meanwhile (by a
    // collaborator, an assistant, or the user in the detailed view) gets overwritten by a stale
    // base. It is a read, so it resolves from the Firestore cache when offline; any failure falls
    // back to the snapshot rather than blocking the append.
    let currentTask = task
    try {
        const freshTask = await Backend.getTaskData(projectId, task.id)
        if (freshTask) currentTask = freshTask
    } catch (error) {}

    const oldDescription = typeof currentTask.description === 'string' ? currentTask.description : ''
    const description = appendTokensToDescription(oldDescription, storedTokens)

    // The shared mutation: change feed, mention follow chains, undo entry.
    await setTaskDescription(projectId, task.id, description, currentTask, oldDescription)

    return { addedCount: storedTokens.length, failedCount }
}
