const Y = require('yjs')

const getNoteDelta = noteData => {
    const ydoc = new Y.Doc()
    const update = new Uint8Array(noteData)

    if (update.length > 0) {
        Y.applyUpdate(ydoc, noteData)
    }

    const type = ydoc.getText('quill')
    const contentDelta = type.toDelta()
    ydoc.destroy()
    return contentDelta
}

module.exports = {
    getNoteDelta,
}
