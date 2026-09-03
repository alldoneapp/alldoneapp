const admin = require('firebase-admin')

const { NOTES_OBJECTS_TYPE, createRecord } = require('../AlgoliaGlobalSearchHelper')
const { processCreatedNoteForRevisionHistory } = require('../NotesRevisionHistory')

// The promises MUST be awaited (AT-2498). `createRecord` downloads the note body
// from Storage and upserts it into Typesense; leaving it unawaited let the Cloud
// Function return — and Cloud Run freeze the container — before that finished, so
// a new note could silently never be indexed. It also turned any indexing failure
// into an unhandled rejection instead of a failed invocation, which is how a
// production `storage.objects.get denied` on every single note went unnoticed.
// `onUpdateNote` and `onDeleteNote` have always awaited theirs.
const onCreateNote = async (projectId, note) => {
    const promises = []
    promises.push(processCreatedNoteForRevisionHistory(note, admin, projectId, note.id))
    promises.push(createRecord(projectId, note.id, note, NOTES_OBJECTS_TYPE, admin.firestore(), false, null))
    await Promise.all(promises)
}

module.exports = {
    onCreateNote,
}
