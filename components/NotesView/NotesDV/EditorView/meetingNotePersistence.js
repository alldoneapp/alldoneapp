import * as Y from 'yjs'

const needsLeadingSpace = (text, index) => {
    if (!index) return false
    let offset = 0
    for (const { insert } of text.toDelta()) {
        const length = typeof insert === 'string' ? insert.length : 1
        if (offset + length >= index) return typeof insert !== 'string' || !/\s/.test(insert[index - offset - 1])
        offset += length
    }
    return false
}

export function createMeetingInsertionTarget({ document, editor }) {
    if (!document || !editor) throw new Error('note-pending')
    const text = document.getText('quill')
    const range = editor.getSelection(true)
    const index = Math.max(0, Math.min(range?.index ?? editor.getLength() - 1, text.length))
    // A relative position follows edits made before the caret and can travel with queued audio.
    return Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, index))
}

// The insertion and dedup marker are one Yjs transaction, so a reload cannot restore
// one without the other. Both travel in the normal note Storage snapshot.
export function insertMeetingTranscript({ document, chunk, editor }) {
    const applied = document.getMap('meeting-transcription-chunks')
    if (applied.has(chunk.id)) return false
    const positions = document.getMap('meeting-transcription-positions')
    const selection = editor?.getSelection()
    let caret
    document.transact(() => {
        // Write through Yjs directly. Wrapping a Quill insert in an outer Yjs transaction
        // replays its own delta through y-quill's observer and duplicates text.
        if (chunk.text.trim()) {
            const text = document.getText('quill')
            const target = positions.get(chunk.sessionId) || chunk.insertionTarget
            let index = text.length
            let value
            if (target) {
                const position = Y.createAbsolutePositionFromRelativePosition(
                    Y.createRelativePositionFromJSON(target),
                    document
                )
                // Keep the audio queued until its note state is available; guessing an index
                // here would silently put a recovered recording in the wrong place again.
                if (!position || position.type !== text) throw new Error('note-pending')
                index = position.index
                const prefix = needsLeadingSpace(text, index) ? ' ' : ''
                value = `${prefix}${chunk.text.trim()} `
            } else {
                // Audio queued before cursor anchoring was introduced retains its append behavior.
                const prefix = text.length && !text.toString().endsWith('\n') ? '\n' : ''
                value = `${prefix}${chunk.text.trim()}\n`
            }
            text.insert(index, value)
            if (target) {
                positions.set(
                    chunk.sessionId,
                    Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, index + value.length, -1))
                )
            }
            if (selection?.length === 0 && selection.index === index) caret = index + value.length
        }
        applied.set(chunk.id, true)
    }, 'meeting-transcription')
    // Follow the transcript only while the user is still at its insertion point. Moving to
    // another paragraph during recording must not pull their caret or viewport back.
    if (caret !== undefined) editor.setSelection(caret, 0, 'user')
    return true
}
