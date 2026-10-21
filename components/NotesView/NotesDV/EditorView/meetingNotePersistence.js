// The insertion and dedup marker are one Yjs transaction, so a reload cannot restore
// one without the other. Both travel in the normal note Storage snapshot.
export function insertMeetingTranscript({ document, chunk }) {
    const applied = document.getMap('meeting-transcription-chunks')
    if (applied.has(chunk.id)) return false
    document.transact(() => {
        // Write through Yjs directly. Wrapping a Quill insert in an outer Yjs transaction
        // replays its own delta through y-quill's observer and duplicates text.
        if (chunk.text.trim()) {
            const text = document.getText('quill')
            const prefix = text.length && !text.toString().endsWith('\n') ? '\n' : ''
            text.insert(text.length, `${prefix}${chunk.text.trim()}\n`)
        }
        applied.set(chunk.id, true)
    }, 'meeting-transcription')
    return true
}
