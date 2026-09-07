import Quill from 'quill'

import { isolatePasteInHistory } from '../../../Feeds/CommentsTextInput/quillHistoryEntries'

const Parchment = Quill.import('parchment')

/**
 * AT-2469. "After a paste the caret is at the beginning of the line instead of at the end", and
 * an extra blank line appears — intermittently, and reliably when a BULLET POINT is pasted.
 *
 * The intermittency is the tell, and it is not a race. Quill 2's `Clipboard.convert` ends with:
 *
 *     if (deltaEndsWith(delta, '\n') && (delta.ops[delta.ops.length - 1].attributes == null || ...))
 *         return delta.compose(new Delta().retain(delta.length() - 1).delete(1))
 *
 * i.e. it drops the pasted content's trailing newline ONLY while that newline carries no
 * attributes. A copied paragraph therefore pastes as bare text and the caret lands after it, which
 * is why "normal" copy/paste always looked right. But a line break is where quill stores a BLOCK
 * format, so a copied bullet arrives as `insert('item') + insert('\n', { list: 'bullet' })` — the
 * attributes are exactly what makes it a bullet, so the trim is skipped and the newline is
 * inserted for real. The paste then always produces one line more than was copied, and the caret,
 * which is placed after everything that was inserted, lands at the START of that surplus line.
 * Same for a numbered list, a heading, a quote and a code block; the user hits it on bullets
 * because that is what one copies around inside a note.
 *
 * The fix keeps quill's intent and widens it: a pasted block tail should FORMAT the line the paste
 * ends in rather than open a new one. `insert('\n', blockAttributes)` becomes
 * `retain(1, blockAttributes)` over the destination line's own terminator, so nothing is added to
 * the document and the caret stops at the end of the pasted text — the same end state a paragraph
 * paste already produced.
 *
 * That rewrite is only sound at the END of a line, because the retained character has to BE the
 * line terminator: quill applies a block format to the line containing the retained range, so
 * retaining an ordinary character mid-line silently formats the wrong line (measured: the bullet
 * was dropped entirely). A mid-line paste therefore keeps quill's own splitting behaviour, and
 * only its caret is corrected, by stepping back over the newline that was genuinely inserted.
 */

/**
 * The subset of a line terminator's attributes that quill would treat as a LINE format.
 *
 * Filtering matters because ops merge: quill emits `insert('one\ntwo\n', { list: 'bullet' })` for a
 * two-item list, so the attributes reaching this function can describe a text run as much as a
 * line break. Retaining a `\n` with an inline format such as `bold` asks quill to wrap the block
 * itself, which is not what the clipboard meant. Anything the editor does not register as a block
 * format is dropped rather than guessed at.
 */
export const blockAttributesOf = (attributes, editor) => {
    if (!attributes) return null
    const scroll = editor && editor.scroll
    if (!scroll || typeof scroll.query !== 'function') return null

    const blockAttributes = {}
    let found = false
    Object.keys(attributes).forEach(name => {
        if (scroll.query(name, Parchment.Scope.BLOCK)) {
            blockAttributes[name] = attributes[name]
            found = true
        }
    })
    return found ? blockAttributes : null
}

/**
 * Rewrites the trailing newline of a pasted delta so it settles into the destination line instead
 * of adding a line after it.
 *
 * Returns the delta to apply plus `caretBackstep`, the number of characters the caret must be
 * pulled back from the end of the applied change. It is 1 only in the one case where a newline is
 * still genuinely inserted (a block pasted mid-line), and 0 everywhere else — including every case
 * this leaves untouched, so callers can apply it unconditionally.
 *
 * @param {object} pastedDelta delta of the pasted CONTENT only, with no leading retain/delete
 * @param {object} editor the quill instance being pasted into
 * @param {number} pasteEndIndex document index the paste starts at, i.e. the end of the selection
 *                               it replaces (everything inside the selection is deleted first)
 * @param {Function} Delta quill's Delta constructor
 */
export const settlePastedBlockTail = (pastedDelta, editor, pasteEndIndex, Delta) => {
    const unchanged = { delta: pastedDelta, caretBackstep: 0 }

    const ops = pastedDelta && pastedDelta.ops
    if (!ops || ops.length === 0) return unchanged

    const lastOp = ops[ops.length - 1]
    if (!lastOp || typeof lastOp.insert !== 'string' || !lastOp.insert.endsWith('\n')) return unchanged

    const blockAttributes = blockAttributesOf(lastOp.attributes, editor)

    // The destination character has to be the line's own terminator for a block format to land on
    // the right line. Mid-line, keep quill's split and correct only the caret.
    if (blockAttributes && editor.getText(pasteEndIndex, 1) !== '\n') return { delta: pastedDelta, caretBackstep: 1 }

    const head = lastOp.insert.slice(0, -1)
    const settledOps = ops.slice(0, -1)
    if (head !== '')
        settledOps.push(lastOp.attributes ? { insert: head, attributes: lastOp.attributes } : { insert: head })
    if (blockAttributes) settledOps.push({ retain: 1, attributes: blockAttributes })

    // A clipboard holding nothing but a bare line break still means "break this line".
    if (settledOps.length === 0) return unchanged

    return { delta: new Delta(settledOps), caretBackstep: 0 }
}

/**
 * Applies a pasted content delta at the current selection and leaves the caret behind it.
 *
 * The three paste pipelines in NotesEditorView (markdown, html, plain text) each ended in their
 * own copy of this arithmetic; sharing it is what keeps them from drifting apart again, and gives
 * the block-tail rule one place to live.
 *
 * The caret is derived from how much the document ACTUALLY grew rather than from the length of the
 * delta being applied, because the note editor's `text-change` listeners rewrite pasted content
 * synchronously (a pasted task URL collapses into a one-character embed). Same reasoning as
 * `GatedClipboard.onPaste` — see AT-2416.
 */
export const applyPastedDeltaToEditor = (editor, contentDelta, Delta) => {
    const selection = editor.getSelection(true) || { index: 0, length: 0 }
    const { delta, caretBackstep } = settlePastedBlockTail(
        contentDelta,
        editor,
        selection.index + selection.length,
        Delta
    )

    const ops = [...delta.ops]
    if (selection.length > 0) ops.unshift({ delete: selection.length })
    if (selection.index > 0) ops.unshift({ retain: selection.index })

    const lengthBefore = editor.getLength()
    // AT-2440: a paste is its own undo step, never merged into the typing around it.
    isolatePasteInHistory(editor, () => editor.updateContents({ ops }, 'user'))
    const inserted = editor.getLength() - lengthBefore + selection.length

    editor.setSelection(Math.max(selection.index, selection.index + inserted - caretBackstep), 0, 'user')
}
