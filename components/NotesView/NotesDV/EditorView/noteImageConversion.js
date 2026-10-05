import Delta from 'quill-delta'

/** Replace pasted image embeds in place; never reset the document or other React roots. */
export const convertNoteImages = (editor, convert, fallbackSelection) => {
    const selection = editor.getSelection() || fallbackSelection
    const change = new Delta()
    const converted = []
    let retained = 0
    for (const op of editor.getContents().ops) {
        if (op.insert?.image) {
            change.retain(retained).delete(1)
            retained = 0
            const image = convert(op.insert.image)
            if (image) {
                change.insert(' ').insert({ customImageFormat: image }).insert(' ')
                converted.push(image)
            }
        } else retained += typeof op.insert === 'string' ? op.insert.length : 1
    }
    if (!change.ops.length) return []
    editor.updateContents(change, 'api')
    if (selection) {
        const start = change.transformPosition(selection.index, true)
        const end = change.transformPosition(selection.index + selection.length, true)
        editor.setSelection(start, end - start, 'silent')
    }
    return converted
}
