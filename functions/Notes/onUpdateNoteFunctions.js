const admin = require('firebase-admin')

const { NOTES_OBJECTS_TYPE, updateRecord } = require('../AlgoliaGlobalSearchHelper')
const { updateEditonDataOfNoteParentObject } = require('../Utils/LastObjectEditionHelper')

const onUpdateNote = async (projectId, noteId, change) => {
    const oldNote = change.before.data()
    const newNote = change.after.data()

    const promises = []
    promises.push(updateRecord(projectId, noteId, oldNote, newNote, NOTES_OBJECTS_TYPE, admin.firestore()))

    if (oldNote.lastEditionDate !== newNote.lastEditionDate && newNote.parentObject) {
        promises.push(
            updateEditonDataOfNoteParentObject(
                projectId,
                newNote.parentObject.id,
                newNote.parentObject.type,
                newNote.lastEditorId
            )
        )
    }
    await Promise.all(promises)
}

module.exports = {
    onUpdateNote,
}
