import Quill from 'quill'

const Parchment = Quill.import('parchment')

/**
 * The subset of a set of attributes that the editor registers as a LINE (block) format.
 *
 * Filtering matters because ops merge: quill emits `insert('one\ntwo\n', { list: 'bullet' })` for a
 * two-item list, so the attributes reaching this function can describe a text run as much as a
 * line break. Treating an inline format such as `bold` as a block format asks quill to wrap the
 * block itself, which is not what the clipboard meant. Anything the editor does not register as a
 * block format is dropped rather than guessed at — which is also what keeps this inert in the chat
 * and comment composers, whose format whitelist has no `list` at all.
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

const endsWithLineBreak = ops => {
    if (!ops || ops.length === 0) return false
    const last = ops[ops.length - 1]
    return typeof last.insert === 'string' && last.insert.endsWith('\n')
}

const spansSeveralLines = ops => !!ops && ops.some(op => typeof op.insert === 'string' && op.insert.includes('\n'))

/**
 * AT-2526. "If I copy + paste a list of bullet points into a note, the last bullet point sometimes
 * loses its bullet point formatting and is just pasted as plain text."
 *
 * A block format is not stored on the line's text — it is stored on the line's TERMINATING newline,
 * which is what makes `\n` the only character in a quill document that can carry `list`, `header`
 * or `blockquote`. `editor.getContents(index, length)` returns the selected range and nothing else,
 * so the moment a selection stops at the end of the last line's text, that line's terminator — and
 * with it the only record that the line was a bullet — is OUTSIDE the copied delta. The last op is
 * then bare text, `QuillDeltaToHtmlConverter` renders it `<p>three</p>` after the `</ul>`, and the
 * clipboard itself now says the last item is a paragraph. Nothing downstream is at fault: Alldone's
 * own paste pipeline, Word, Teams and Gmail all correctly honour what they were given.
 *
 * That is the whole "sometimes". Whether the terminator falls inside the selection is decided by
 * where the drag stopped, and the user cannot see the character they are missing:
 *
 *   - drag to the end of the last bullet's text, or press cmd/ctrl+A     -> terminator excluded, lost
 *   - drag PAST the last bullet into the line below                      -> terminator included, fine
 *
 * and select-all is not a matter of luck at all — quill clamps a selection to `getLength() - 1`, so
 * a list that ends the note can NEVER have its last terminator selected and always loses the bullet.
 *
 * The fix restores the missing terminator from the source document rather than guessing from the
 * markup, so a copy describes the same lines the note does. Two limits keep it from doing anything
 * else:
 *
 *   - Only when the copied ops do not already end in a line break. A selection that included the
 *     terminator already carries its own block format, and appending a second one would add a line.
 *   - Only when the selection spans more than one line. Copying a fragment out of a single bullet is
 *     an INLINE fragment — pasting "two words" into a paragraph must not turn that paragraph into a
 *     bullet, which is both today's behaviour and the only reading that survives being pasted into
 *     an arbitrary destination.
 *
 * A last line with no block format (ordinary prose, the overwhelmingly common copy) resolves to
 * `null` here and the clipboard is byte-identical to before.
 *
 * @param {object} editor the quill instance being copied FROM, read before any cut deletes it
 * @param {number} index start of the selection
 * @param {number} length length of the selection
 * @param {object[]} copiedOps ops of the copied delta, i.e. `editor.getContents(index, length).ops`
 * @returns {object|null} the terminator op to append, or null to leave the copy untouched
 */
export const resolveCopiedBlockTail = (editor, index, length, copiedOps) => {
    if (!editor || !length || typeof editor.getFormat !== 'function') return null
    if (endsWithLineBreak(copiedOps) || !spansSeveralLines(copiedOps)) return null

    let lineFormats = null
    try {
        lineFormats = editor.getFormat(index + length, 0)
    } catch (error) {
        return null
    }

    const blockAttributes = blockAttributesOf(lineFormats, editor)
    return blockAttributes ? { insert: '\n', attributes: blockAttributes } : null
}
