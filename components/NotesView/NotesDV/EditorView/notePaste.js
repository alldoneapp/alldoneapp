import { isolatePasteInHistory } from '../../../Feeds/CommentsTextInput/quillHistoryEntries'
import { blockAttributesOf } from '../../../Feeds/CommentsTextInput/quillBlockFormats'

// Re-exported because the copy side needs the same rule (AT-2526) and a second copy of it would
// let the two drift: what counts as a block format has to mean the same thing in both directions.
export { blockAttributesOf }

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
 *
 * AT-2519. The same report came back for text copied out of MS Teams, and the reason AT-2469 did
 * not cover it is that both quill's trim and the rewrite above remove exactly ONE terminator —
 * which is only enough while the clipboard ends in exactly one. Every rich-text app ends a copied
 * block with an empty one: Teams and Outlook append `<div><br></div>`, Word appends
 * `<p><o:p>&nbsp;</o:p></p>`, and a message with a blank line at the end simply carries it along.
 * That is `insert('Hello\n\n')`, so one removal still leaves a line break, the paste still opens a
 * line, and the caret still lands at the start of it.
 *
 * It looked fixed after AT-2469 for the same reason it looked fine before it: text copied INSIDE
 * the app carries no inline styling, so `Clipboard.convert`'s own trim applies and removes one
 * terminator before this module removes the other — two removals, and the caret lands correctly.
 * The moment the tail carries an inline attribute — `color`, `background`, `font`, which external
 * HTML always has — quill's trim is skipped, only one removal happens, and the surplus line is
 * back. Hence "it still happens when I copy + paste e.g. from MS Teams": it is the SAME defect,
 * and the deciding factor is whether the clipboard came from another application, not what was
 * copied.
 *
 * So the tail is now settled as a whole rather than one op at a time: every line terminator that
 * would only add an EMPTY line after the pasted text is dropped, and the one that terminates the
 * last line carrying content is handed to the rule above. A clipboard that is nothing but line
 * breaks is still left alone — there, the breaks ARE the content.
 */

/**
 * Clipboard text with line endings normalized to '\n'.
 *
 * Every reader of pasted text in the app splits on '\n', so a CRLF payload (any Windows source,
 * MS Teams included) leaves a '\r' at the end of each line. It is invisible, it is whitespace, and
 * `processPastedTextWithBreakLines` splits words on /\s/ — so it silently becomes a trailing space
 * on every pasted line.
 */
export const normalizePastedLineEndings = text => (typeof text === 'string' ? text.replace(/\r\n?/g, '\n') : text)

const isTextInsert = op => !!op && typeof op.insert === 'string'

const withText = (op, text) => (op.attributes ? { insert: text, attributes: op.attributes } : { insert: text })

/**
 * How many line terminators the delta ends with, and whether that run is the WHOLE delta.
 *
 * The run is counted across ops rather than inside the last one, because quill splits a tail
 * however the source markup happened to be shaped: a pasted list arrives as
 * `insert('one', {list}) + insert('\n', {list}) + insert('\n', {list})` while the same two lines
 * of styled prose arrive as the single op `insert('one\n\n', {color})`. Anything that is not a
 * text insert (an image, a task chip) ends the run: an embed is content, so nothing after the
 * point it was found is a surplus blank line.
 */
export const countTrailingLineBreaks = ops => {
    let count = 0
    for (let index = ops.length - 1; index >= 0; index--) {
        const op = ops[index]
        if (!isTextInsert(op)) return { count, isOnlyLineBreaks: false }

        const text = op.insert
        let cursor = text.length - 1
        while (cursor >= 0 && text[cursor] === '\n') {
            count++
            cursor--
        }
        if (cursor >= 0) return { count, isOnlyLineBreaks: false }
    }
    return { count, isOnlyLineBreaks: true }
}

/** Drops `amount` characters off the end of `ops`, keeping each surviving op's attributes. */
const removeTrailingCharacters = (ops, amount) => {
    const kept = [...ops]
    let remaining = amount

    while (remaining > 0 && kept.length > 0) {
        const last = kept[kept.length - 1]
        const text = last.insert
        if (text.length <= remaining) {
            remaining -= text.length
            kept.pop()
        } else {
            kept[kept.length - 1] = withText(last, text.slice(0, text.length - remaining))
            remaining = 0
        }
    }

    return kept
}

/**
 * Removes the line terminators that would only add EMPTY lines after the pasted text, keeping the
 * one that terminates the last line carrying content — that one still describes the block format
 * of that line (`list`, `header`, `blockquote`) and is settled separately by
 * `settlePastedBlockTail`.
 *
 * Returns the input untouched when there is at most one terminator, and when the clipboard holds
 * nothing BUT line breaks: pasting a bare line break means "break this line", and there is no
 * content for the breaks to be surplus to.
 */
export const dropSurplusTrailingLineBreaks = ops => {
    const { count, isOnlyLineBreaks } = countTrailingLineBreaks(ops)
    if (isOnlyLineBreaks || count < 2) return ops
    return removeTrailingCharacters(ops, count - 1)
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

    const originalOps = pastedDelta && pastedDelta.ops
    if (!originalOps || originalOps.length === 0) return unchanged

    // AT-2519: everything past the last line that carries content is a blank line the clipboard
    // brought along, never something the paste should open.
    const ops = dropSurplusTrailingLineBreaks(originalOps)
    const trimmedOnly = ops === originalOps ? unchanged : { delta: new Delta(ops), caretBackstep: 0 }

    const lastOp = ops[ops.length - 1]
    if (!lastOp || typeof lastOp.insert !== 'string' || !lastOp.insert.endsWith('\n')) return trimmedOnly

    const blockAttributes = blockAttributesOf(lastOp.attributes, editor)

    // The destination character has to be the line's own terminator for a block format to land on
    // the right line. Mid-line, keep quill's split and correct only the caret.
    if (blockAttributes && editor.getText(pasteEndIndex, 1) !== '\n')
        return { delta: trimmedOnly.delta, caretBackstep: 1 }

    const head = lastOp.insert.slice(0, -1)
    const settledOps = ops.slice(0, -1)
    if (head !== '') settledOps.push(withText(lastOp, head))
    if (blockAttributes) settledOps.push({ retain: 1, attributes: blockAttributes })

    // A clipboard holding nothing but a bare line break still means "break this line".
    if (settledOps.length === 0) return trimmedOnly

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

/**
 * Whether the notes editor should take this paste over from the browser.
 *
 * Two cases hand it back, and both used to be swallowed instead (AT-2519).
 *
 * A clipboard carrying no text and no HTML is an image or a file. The handler has never had
 * anything to contribute there, and quill's uploader is what picks those up.
 *
 * A DISABLED editor is the one that mattered. `readOnly` on the component is only one of the five
 * reasons the editor is disabled — loading, the inactivity modal, revoked access and unavailable
 * offline content are the others, and the paste listener's ref tracks only the first. Quill ignores
 * a `user` update on a disabled editor (`modify()` returns an empty delta) and reports success, so
 * the pipeline would run, insert nothing, measure no growth, leave the caret where it was and then
 * consume the event: a paste that silently does nothing. A disabled editor is not contenteditable
 * either, so declining costs nothing.
 */
export const noteEditorOwnsPaste = ({ readOnly, editor, textData, htmlData }) => {
    if (readOnly || !editor) return false
    if (typeof editor.isEnabled === 'function' && !editor.isEnabled()) return false
    return !!(textData || htmlData)
}

/**
 * Converts a clipboard payload with `convert` and applies it, degrading to the plain text when the
 * conversion fails.
 *
 * AT-2519, and the reason the caller must `preventDefault()` BEFORE calling this: the notes handler
 * used to call it at the end of each branch, so anything that threw on the way there handed the
 * paste back to the BROWSER. The browser then inserts the clipboard's raw HTML into the
 * contenteditable itself, and none of the app's caret placement runs — the user watches the text
 * arrive and the cursor stay exactly where the paste began. That reads as a caret bug and is really
 * a swallowed exception, which is why it must not be possible: the clipboard is the least
 * predictable input this editor has, and the conversion walks user-authored URLs, e-mail addresses,
 * mentions and embeds on the way through.
 *
 * Degrading to the plain text rather than to nothing keeps the paste useful and keeps the caret
 * correct; the failure is reported rather than left to look like a cursor problem.
 */
export const applyPastedClipboard = (editor, { textData, htmlData }, convert, Delta) => {
    try {
        applyPastedDeltaToEditor(editor, convert(editor, textData, htmlData), Delta)
        return 'converted'
    } catch (error) {
        console.error('[notes paste] conversion failed, falling back to plain text', error)
        if (!textData) return 'failed'
        applyPastedDeltaToEditor(editor, new Delta().insert(textData), Delta)
        return 'plain-text-fallback'
    }
}
