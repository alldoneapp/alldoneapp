import Quill from 'quill'
import v4 from 'uuid/v4'

import {
    addFilesAsAttachments,
    eventContainsFiles,
    getDroppedFiles,
} from '../../../Feeds/CommentsTextInput/attachmentFileUtils'
import { insertAttachmentInsideEditor, LOADING_MODE } from '../../../Feeds/CommentsTextInput/textInputHelper'
import { updateNewAttachmentsDataInNotes } from '../../../Feeds/Utils/HelperFunctions'
import { checkIsLimitedByTraffic } from '../../../Premium/PremiumHelper'

/**
 * Multi-file drag & drop for the notes editor (AT-2365).
 *
 * What this replaces, and why a bespoke handler rather than a tweak:
 *
 * 1. `quill-drag-and-drop-module` called its `onDrop` once per file but in PARALLEL, and
 *    the app's handler awaited a full `getFileDataUrl(file)` base64 read (whose result it
 *    then discarded — the embed uses `URL.createObjectURL`) BEFORE computing its insertion
 *    index. So the index was resolved after an await whose duration scales with file size:
 *    dropping three images inserted them in FileReader-completion order (roughly smallest
 *    first), and because every racer read the same stale `editor.getSelection()`, they
 *    stacked on one index and came out REVERSED. Order was therefore a function of file
 *    size, which is why it looked random.
 * 2. Quill 2 ships its own `uploader` module, enabled by default, which ALSO listens for
 *    `drop` on the editor root and inserts png/jpeg as base64 `image` embeds. Both
 *    listeners sit on the same node, so `stopPropagation` in one cannot stop the other:
 *    every dropped png/jpeg was inserted TWICE (once as a base64 image that
 *    `replaceQuillImagesByCustomImagesFormat` then converted and uploaded, once as the
 *    module's own embed). `EditorToolbar` disables it with `uploader: false`; paste is
 *    unaffected because the uploader only handles drop.
 *
 * The handler below inserts every placeholder SYNCHRONOUSLY inside the drop event, in
 * `dataTransfer.files` order, walking a local cursor forward — nothing about ordering
 * depends on how fast a file reads or uploads. Uploads then run afterwards with bounded
 * concurrency.
 */

// `insertAttachmentInsideEditor` writes ' ', the embed, ' ' — three document positions.
export const NOTE_ATTACHMENT_EMBED_LENGTH = 3

// Dropping a folder of screenshots should not open 20 parallel resize + double-upload
// chains; placeholders are visible immediately either way, so the only thing serializing
// costs is how soon the LAST image finishes.
export const NOTE_ATTACHMENT_UPLOAD_CONCURRENCY = 3

const clampIndex = (editor, index) => {
    const length = editor.getLength()
    if (!Number.isFinite(index) || index < 0) return length
    return Math.min(index, length)
}

/**
 * Resolve the caret the pointer was released over, so a drop lands where the user aimed
 * instead of at the end of the note. Mirrors what Quill's own uploader does
 * (`caretRangeFromPoint` → `selection.normalizeNative` → `normalizedToRange`) so the two
 * agree on what "the drop point" means.
 *
 * Every uncertain case falls back rather than guessing: an unresolvable point uses the
 * live selection, and no selection appends at the end — which is exactly the old
 * behaviour, so a browser without these APIs is no worse off than before.
 */
export const resolveDropIndex = (editor, event) => {
    const fallback = () => {
        const selection = editor.getSelection()
        return clampIndex(editor, selection ? selection.index + selection.length : editor.getLength())
    }

    const x = event?.clientX
    const y = event?.clientY
    if (!Number.isFinite(x) || !Number.isFinite(y)) return fallback()

    let nativeRange = null
    try {
        if (document.caretRangeFromPoint) {
            nativeRange = document.caretRangeFromPoint(x, y)
        } else if (document.caretPositionFromPoint) {
            const position = document.caretPositionFromPoint(x, y)
            if (position) {
                nativeRange = document.createRange()
                nativeRange.setStart(position.offsetNode, position.offset)
                nativeRange.setEnd(position.offsetNode, position.offset)
            }
        }
    } catch (error) {
        nativeRange = null
    }

    if (!nativeRange) return fallback()

    try {
        const normalized = editor.selection.normalizeNative(nativeRange)
        const range = normalized && editor.selection.normalizedToRange(normalized)
        if (range && Number.isFinite(range.index)) return clampIndex(editor, range.index)
    } catch (error) {
        // Fall through: a drop over chrome that is inside the container but outside the
        // document (the padding below the last line) normalizes to nothing.
    }

    return fallback()
}

const isAtLineStart = (editor, index) => {
    if (index <= 0) return true
    try {
        return editor.getText(index - 1, 1) === '\n'
    } catch (error) {
        return false
    }
}

const insertLineBreak = (editor, index) => {
    const Delta = editor.constructor.import('delta')
    editor.updateContents(new Delta().retain(index).insert('\n'), 'user')
    return 1
}

/**
 * Insert one placeholder embed per dropped file, in drop order, each on its own line.
 *
 * Synchronous by construction: the running `index` is the only source of truth for
 * placement, so ordering cannot be perturbed by upload or read timings. Returns the
 * descriptors the upload pass needs.
 */
export const insertDroppedFilesInNote = ({ editor, files, startIndex }) => {
    const inserted = []
    let index = clampIndex(editor, startIndex)
    // Only the FIRST file may need a leading break — after that the cursor is always
    // sitting on a fresh line this function just created.
    let needsLeadingBreak = !isAtLineStart(editor, index)

    // Reused from the comment/chat drop zone so notes get the same 50 MB per-file guard,
    // the same translated warning and the same whitespace-stripped file names.
    addFilesAsAttachments(files, (name, uri) => {
        if (needsLeadingBreak) {
            index += insertLineBreak(editor, index)
            needsLeadingBreak = false
        }

        const id = v4()
        insertAttachmentInsideEditor(index, editor, name, uri, id, LOADING_MODE)
        index += NOTE_ATTACHMENT_EMBED_LENGTH
        index += insertLineBreak(editor, index)

        inserted.push({ id, name, uri })
    })

    if (inserted.length > 0) {
        editor.setSelection(index, 0, 'user')
    }

    return inserted
}

/**
 * Run the real uploads a few at a time. A failed upload must not abort its neighbours —
 * the embed simply stays on its loading placeholder, which is what a single failed drop
 * already does today.
 */
export const uploadDroppedNoteAttachments = async (
    editor,
    items,
    { concurrency = NOTE_ATTACHMENT_UPLOAD_CONCURRENCY, upload = updateNewAttachmentsDataInNotes } = {}
) => {
    const queue = [...(items || [])]
    if (queue.length === 0) return

    const workerCount = Math.max(1, Math.min(concurrency, queue.length))
    const runWorker = async () => {
        while (queue.length > 0) {
            const { id, name, uri } = queue.shift()
            try {
                await upload(editor, id, name, uri, 'user')
            } catch (error) {
                console.warn('Note attachment upload failed', error)
            }
        }
    }

    await Promise.all(Array.from({ length: workerCount }, runWorker))
}

export const handleNoteFilesDrop = ({ editor, files, event, projectId, uploadOptions }) => {
    if (!editor || !files || files.length === 0) return []

    // A note the user cannot write to (no access, or the offline read-only gate) must not
    // take the drop — the embed would be inserted locally and never saved.
    if (typeof editor.isEnabled === 'function' && !editor.isEnabled()) return []

    // Same gate the toolbar's attachment button uses; `checkIsLimitedByTraffic` also
    // raises the quota modal, so the user is told why nothing happened.
    if (checkIsLimitedByTraffic(projectId)) return []

    const startIndex = resolveDropIndex(editor, event)
    const inserted = insertDroppedFilesInNote({ editor, files, startIndex })

    if (inserted.length > 0) {
        uploadDroppedNoteAttachments(editor, inserted, uploadOptions)
    }

    return inserted
}

/**
 * Quill module wrapper. Registered rather than wired from the React tree so the listeners
 * live and die with the editor instance, exactly as the module it replaces did.
 */
export default class NoteAttachmentDropModule {
    constructor(quill, options = {}) {
        this.quill = quill
        this.options = options
        this.container = options.container || quill.root

        this.onDragOver = event => {
            if (!eventContainsFiles(event)) return
            // Without this the browser refuses the drop (and would navigate to the file).
            event.preventDefault()
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
        }

        this.onDrop = event => {
            const files = getDroppedFiles(event)
            if (files.length === 0) return

            event.preventDefault()
            event.stopPropagation()

            handleNoteFilesDrop({
                editor: this.quill,
                files,
                event,
                projectId: this.resolveProjectId(),
                uploadOptions: options.uploadOptions,
            })
        }

        this.container.addEventListener('dragover', this.onDragOver, false)
        this.container.addEventListener('drop', this.onDrop, false)
    }

    resolveProjectId() {
        const { getProjectId } = this.options
        try {
            return typeof getProjectId === 'function' ? getProjectId(this.quill) : undefined
        } catch (error) {
            return undefined
        }
    }

    destroy() {
        this.container.removeEventListener('dragover', this.onDragOver, false)
        this.container.removeEventListener('drop', this.onDrop, false)
    }
}

Quill.register('modules/noteAttachmentDrop', NoteAttachmentDropModule)
