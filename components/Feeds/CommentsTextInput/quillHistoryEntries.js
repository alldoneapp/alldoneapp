/**
 * The shape of a quill history stack entry, and the app's own entries that live beside them.
 *
 * AT-2440. Quill 1 stored `{ undo: Delta, redo: Delta }` per stack entry; quill 2 stores
 * `{ delta, range }` and derives the opposite direction by inverting `delta` against the live
 * document. The app never noticed the change because the only code that reads the stack —
 * `beforeUndoRedo` in textInputHelper — kept indexing entries the quill-1 way
 * (`stack.undo[last].undo.type`). Under quill 2 that is `undefined.type`, i.e. a TypeError on
 * EVERY undo and redo, in every editor in the app.
 *
 * The failure was invisible rather than loud, and much worse than "undo is broken": quill calls
 * the hook from inside its keydown binding and from its `beforeinput` handler, and both of them
 * reach `event.preventDefault()` only AFTER `history.undo()` returns. A throw skipped the
 * preventDefault, so the keystroke (or the browser/OS "Undo" command, which arrives as
 * `beforeinput` with `inputType: 'historyUndo'`) fell through to the browser's OWN
 * contenteditable undo. That native stack only contains edits the browser itself performed —
 * typing — because every paste in this app is `preventDefault()`ed and applied programmatically
 * (`Clipboard.onPaste`, and the notes editor's markdown/HTML pipeline). So pressing Undo after a
 * paste reverted whatever the user had TYPED before it and left the pasted text sitting there.
 *
 * Two entry shapes therefore coexist and must be told apart before anything touches them:
 *   - quill's own `{ delta, range }`, which can be inverted, composed and transformed;
 *   - the app's `{ undo: {...}, redo: {...} }` marker entries (hashtag colour changes), which
 *     carry no document delta at all and are consumed by `beforeUndoRedo` instead.
 */

export const HASHTAG_COLOR_HISTORY_TYPE = 'hashtagColor'

/**
 * True for an entry quill created itself, i.e. one it can invert/compose/transform. Everything
 * downstream is guarded on this rather than on "is it not an app entry", so a malformed or
 * future entry shape degrades to being ignored instead of throwing inside a text-change
 * listener.
 */
export const isQuillHistoryEntry = entry =>
    !!entry && !!entry.delta && typeof entry.delta.invert === 'function' && typeof entry.delta.transform === 'function'

/** True for an app-owned marker entry: no document delta, a `{ type }` payload per direction. */
export const isAppHistoryEntry = entry => !!entry && !entry.delta && !!(entry.undo || entry.redo)

/** The payload an app entry carries for one direction, or null when the entry is not one. */
export const getAppHistoryAction = (entry, action) => {
    const payload = entry ? entry[action] : null
    return payload && typeof payload === 'object' && typeof payload.type === 'string' ? payload : null
}

export const buildHashtagColorHistoryEntry = ({ objectId, text, colorKey, previousColorKey }) => ({
    redo: { objectId, type: HASHTAG_COLOR_HISTORY_TYPE, colorKey, text },
    undo: { objectId, type: HASHTAG_COLOR_HISTORY_TYPE, colorKey: previousColorKey, text },
})

const transformRange = (range, delta) => {
    if (!range) return range
    const start = delta.transformPosition(range.index)
    const end = delta.transformPosition(range.index + range.length)
    return { index: start, length: end - start }
}

/**
 * Quill's own `transformStack` (modules/history.js) assumes every entry carries a delta, so a
 * single app marker entry anywhere in the stack turns every non-`user` change into a TypeError
 * thrown from a text-change listener — which breaks typing, not just undo. Both app editors run
 * `history: { userOnly: true }`, so this path is taken for every programmatic edit and for every
 * remote Yjs update in a shared note.
 *
 * An app entry describes no document change, so it neither transforms nor is transformed by a
 * remote delta: skip it and thread `remoteDelta` on unchanged.
 */
export const transformHistoryStack = (stack, delta) => {
    let remoteDelta = delta
    for (let i = stack.length - 1; i >= 0; i -= 1) {
        const oldItem = stack[i]
        if (!isQuillHistoryEntry(oldItem)) continue
        stack[i] = {
            delta: remoteDelta.transform(oldItem.delta, true),
            range: oldItem.range && transformRange(oldItem.range, remoteDelta),
        }
        remoteDelta = oldItem.delta.transform(remoteDelta)
        if (stack[i].delta.length() === 0) stack.splice(i, 1)
    }
}

/**
 * Makes one paste one undo step.
 *
 * Quill coalesces every change made within `history.delay` (1000ms) into a single stack entry,
 * which is right for typing and wrong for a paste: type "Hello", paste, hit undo inside the same
 * second and BOTH disappear. Native editors treat a paste as a discrete unit, and "undo the
 * paste" is the whole of what AT-2440 asks for — so cut the history before the paste (it starts
 * its own entry) and again after it (what the user types next starts another one).
 *
 * The trailing cut is safe for the autoformat rewrites that ride along with a paste — the
 * "pasted task URL becomes a chip" pass runs synchronously from the `text-change` this update
 * emits, so it has already merged into the paste's entry by the time control returns here.
 */
export const isolatePasteInHistory = (editor, applyPaste) => {
    const history = editor && editor.history
    const cutoff = () => {
        if (history && typeof history.cutoff === 'function') history.cutoff()
    }
    cutoff()
    try {
        return applyPaste()
    } finally {
        cutoff()
    }
}
