const admin = require('firebase-admin')

const { NOTES_OBJECTS_TYPE, createRecord } = require('../AlgoliaGlobalSearchHelper')
const { processCreatedNoteForRevisionHistory } = require('../NotesRevisionHistory')

const onCreateNote = async (projectId, note) => {
    const promises = []
    promises.push(processCreatedNoteForRevisionHistory(note, admin, projectId, note.id))
    promises.push(createRecord(projectId, note.id, note, NOTES_OBJECTS_TYPE, admin.firestore(), false, null))
}

module.exports = {
    onCreateNote,
}
