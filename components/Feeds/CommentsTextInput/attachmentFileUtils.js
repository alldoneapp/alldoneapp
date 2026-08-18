import { translate } from '../../../i18n/TranslationService'

export const ATTACHMENT_FILE_SIZE_LIMIT_MB = 50

export const normalizeAttachmentFileName = fileName => fileName.replaceAll(/\s/g, '_')

// These two live here rather than in AttachmentDropZone so a drop target that is not an editor
// (AT-2363: the task list row, AT-2365: the notes editor's own Quill-root listener) can share
// them without importing the whole Quill/redux tree. AttachmentDropZone re-exports them, so its
// existing importers are unaffected.
export const getDroppedFiles = event => {
    const dataTransfer = event?.dataTransfer || event?.nativeEvent?.dataTransfer
    return Array.from(dataTransfer?.files || [])
}

export const eventContainsFiles = event => {
    const dataTransfer = event?.dataTransfer || event?.nativeEvent?.dataTransfer
    return Array.from(dataTransfer?.types || []).includes('Files')
}

/**
 * Open the hidden `<input type="file">` a surface renders, configured for one or several
 * files (AT-2365).
 *
 * `multiple` is opt-in per surface rather than global: `addFilesAsAttachments` loops, but
 * the caller's `addAttachmentTag` has to advance its own cursor between calls for the
 * selection order to survive. Several surfaces close over a React state
 * `inputCursorIndex`, so every file picked in one tick would land on the same index and
 * come out reversed. Only surfaces that re-read the live editor selection (notes) or track
 * the cursor themselves may pass `multiple: true`.
 */
export const openAttachmentFilePicker = ({ inputId = 'file-input', multiple = false, onFiles }) => {
    const fileInput = typeof document !== 'undefined' ? document.getElementById(inputId) : null
    if (!fileInput) return false

    // Set explicitly on every open: the input is a shared, long-lived node, so leaving a
    // previous surface's value on it would silently hand multi-select to a surface that
    // cannot order it.
    fileInput.multiple = !!multiple
    fileInput.onchange = event => onFiles(event.target.files)
    fileInput.click()
    return true
}

export const addFilesAsAttachments = (files, addAttachmentTag) => {
    const addedFiles = []

    Array.from(files || []).forEach(file => {
        const fileSize = file.size / 1024 / 1024
        if (fileSize > ATTACHMENT_FILE_SIZE_LIMIT_MB) {
            alert(
                translate('File size exceeds', {
                    limit: ATTACHMENT_FILE_SIZE_LIMIT_MB,
                    size: fileSize.toFixed(2),
                })
            )
            return
        }

        const name = normalizeAttachmentFileName(file.name)
        const uri = URL.createObjectURL(file)
        addAttachmentTag(name, uri)
        addedFiles.push(file)
    })

    return addedFiles
}
