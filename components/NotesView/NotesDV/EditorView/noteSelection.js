/**
 * Selection resolution for the note editor.
 *
 * The note editor keeps a cached copy of the last Quill selection in
 * mentionsHelper (`activeSelection`), maintained from Quill's `selection-change`
 * events. That cache is fine for the mention popup, which reacts to those very
 * events, but it is NOT a reliable snapshot for actions triggered from the
 * toolbar: pressing a toolbar button can move DOM focus out of the
 * contenteditable, and from that moment Quill reports `null` for
 * `getSelection()`.
 *
 * Quill keeps a second answer of its own: `selection.savedRange`, the last range
 * it had. The important detail - and the reason an earlier version of this
 * module did not fix AT-2178 - is that **`savedRange` is never null**. Quill
 * initialises it in the Selection constructor:
 *
 *     // savedRange is last non-null range
 *     this.lastRange = this.savedRange = new Range(0, 0)
 *
 * So "the editor never had a selection" and "the editor's selection is the very
 * start of the document" are the same value, and any resolution order that puts
 * `savedRange` ahead of the caller's own snapshot can never reach that snapshot.
 * The press-time capture became unreachable code, and the popup kept opening
 * empty whenever the live range was gone.
 *
 * The order below therefore distinguishes two situations:
 *
 *   - the editor CAN answer (`getSelection()` returned a range): that is the
 *     current truth, collapsed caret included, and it wins outright.
 *   - the editor CANNOT answer (blurred, torn down): every remaining source is
 *     a guess, so the first guess that describes a real (non-empty) selection
 *     wins over one that is merely the `{index: 0, length: 0}` default.
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

/** A selection that actually covers text, as opposed to a bare caret. */
export const isNonEmptySelection = selection => !!selection && selection.length > 0

/**
 * First candidate that describes real selected text; otherwise the first usable
 * candidate; otherwise an empty selection. Used only where every candidate is a
 * guess, i.e. where the editor itself can no longer tell us the answer.
 */
export const pickBestSelection = candidates => {
    const usable = candidates.map(normalizeSelection).filter(Boolean)
    return usable.find(isNonEmptySelection) || usable[0] || { ...EMPTY_SELECTION }
}

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
 *   2. otherwise the best of Quill's `savedRange` and the caller's cached range
 *   3. otherwise an empty selection at the start of the document
 */
export const resolveEditorSelection = (editor, fallbackSelection) => {
    if (editor) {
        const liveSelection = readLiveSelection(editor)
        if (liveSelection) return liveSelection

        return pickBestSelection([readSavedSelection(editor), fallbackSelection])
    }

    return pickBestSelection([fallbackSelection])
}

/**
 * The selection an action that works on "the text I had selected when I pressed
 * the button" should use.
 *
 * `snapshotSelection` is what was read at press time, which is the moment the
 * user expressed the intent and the last moment the editor is guaranteed to
 * still be able to answer. It outranks anything read later: by the time the
 * create-task popup is constructed the modal's own editor may already own the
 * DOM selection, and `savedRange` may have been reset by unrelated editor work.
 *
 * A press-time snapshot of a bare caret does not veto a later reading, so
 * "pressed Task without selecting anything" still resolves to empty and the
 * popup falls back to its normal initial text.
 */
export const resolveActionSelection = (editor, snapshotSelection, fallbackSelection) =>
    pickBestSelection([snapshotSelection, readLiveSelection(editor), readSavedSelection(editor), fallbackSelection])

// --- press-time snapshot ----------------------------------------------------
//
// Single-use on purpose. The snapshot exists to carry one user gesture across
// the render that mounts the popup; it must never survive to pre-fill an
// unrelated task created later from the same note (via a mention, say). It is
// consumed by the first popup that asks for it and is dropped if the editor it
// was taken from is not the editor asking.

let pressSnapshot = null

/**
 * Records what is selected right now, before the popup mounts and focus moves.
 * Returns the resolved selection.
 */
export const captureNoteSelectionSnapshot = (editor, fallbackSelection) => {
    const selection = resolveEditorSelection(editor, fallbackSelection)
    pressSnapshot = editor ? { editor, selection } : null
    return selection
}

/**
 * Returns the press-time selection once, then forgets it. Null when there is
 * nothing recorded, or when it belongs to a different editor.
 */
export const consumeNoteSelectionSnapshot = editor => {
    const snapshot = pressSnapshot
    pressSnapshot = null
    if (!snapshot || !editor || snapshot.editor !== editor) return null
    return snapshot.selection
}

export const clearNoteSelectionSnapshot = () => {
    pressSnapshot = null
}
