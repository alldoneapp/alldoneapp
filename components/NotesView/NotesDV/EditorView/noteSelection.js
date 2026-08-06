/**
 * Selection resolution for the note editor.
 *
 * The note editor keeps a cached copy of the last Quill selection in
 * mentionsHelper (`activeSelection`), maintained from Quill's `selection-change`
 * events. That cache is fine for the mention popup, which reacts to those very
 * events, but it is NOT a reliable snapshot for actions triggered from the
 * toolbar: pressing a toolbar button moves DOM focus out of the contenteditable,
 * and from that moment Quill reports `null` for `getSelection()`. Whatever the
 * cache happens to hold is then the only thing the create-task popup can read,
 * and a cache that was never written (or was written with a collapsed range)
 * silently degrades to "nothing was selected".
 *
 * Quill itself keeps the authoritative answer: `selection.savedRange` is the
 * last non-null range the editor had, preserved across blur. Resolving live
 * range -> savedRange -> cached copy makes the answer independent of focus
 * timing, which is what the toolbar actions need.
 *
 * Kept free of app dependencies on purpose so it stays directly unit testable.
 */

export const EMPTY_SELECTION = { index: 0, length: 0 }

const isValidSelection = selection =>
    !!selection &&
    typeof selection.index === 'number' &&
    Number.isFinite(selection.index) &&
    selection.index >= 0 &&
    typeof selection.length === 'number' &&
    Number.isFinite(selection.length) &&
    selection.length >= 0

/**
 * Returns a plain `{ index, length }` copy, or null when the input is not a
 * usable Quill range.
 */
export const normalizeSelection = selection =>
    isValidSelection(selection) ? { index: selection.index, length: selection.length } : null

const readLiveSelection = editor => {
    try {
        return normalizeSelection(editor.getSelection())
    } catch (error) {
        // getSelection() touches the DOM and throws on a torn-down editor.
        return null
    }
}

const readSavedSelection = editor => {
    try {
        return normalizeSelection(editor.selection ? editor.selection.savedRange : null)
    } catch (error) {
        return null
    }
}

/**
 * Best available selection for `editor`:
 *   1. the live range, when the editor still owns the DOM selection
 *   2. Quill's `savedRange`, i.e. the last range it had before losing focus
 *   3. the caller's cached range (mentionsHelper's `activeSelection`)
 *   4. an empty selection at the start of the document
 */
export const resolveEditorSelection = (editor, fallbackSelection) => {
    if (editor) {
        const liveSelection = readLiveSelection(editor)
        if (liveSelection) return liveSelection

        const savedSelection = readSavedSelection(editor)
        if (savedSelection) return savedSelection
    }

    return normalizeSelection(fallbackSelection) || { ...EMPTY_SELECTION }
}
