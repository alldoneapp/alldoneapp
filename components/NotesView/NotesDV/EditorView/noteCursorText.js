/** Quill positions count embeds as one. getText omits them; retain that position. */
export const readCursorText = (editor, index, length) => {
    if (!editor || length <= 0) return ''
    return editor
        .getContents(Math.max(0, index), length)
        .ops.map(op => (typeof op.insert === 'string' ? op.insert : '&'))
        .join('')
}

export const findMentionStart = (editor, index) => {
    const start = Math.max(0, index - 3)
    const text = readCursorText(editor, start, index - start + 1)
    const at = offset => text[index - start + offset]
    const boundary = char => !char || /\s|&/.test(char)
    if (at(-1) === '@' && boundary(at(-2))) return index
    if (at(0) === '@' && boundary(at(-1))) return index + 1
    if (at(-1) && !/[@\s&]/.test(at(-1)) && at(-2) === '@' && boundary(at(-3))) return index - 1
    return null
}

// Read only the token, in small chunks. No arbitrary mention-name length limit.
export const findMentionEnd = (editor, start) => {
    const length = editor.getLength()
    let end = start
    while (end < length) {
        const text = readCursorText(editor, end, Math.min(64, length - end))
        const stop = text.search(/\s|&/)
        if (stop >= 0) return end + stop
        if (!text.length) break
        end += text.length
    }
    return end
}
