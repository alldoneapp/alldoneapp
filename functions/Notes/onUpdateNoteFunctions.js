const admin = require('firebase-admin')

const { NOTES_OBJECTS_TYPE, updateRecord } = require('../AlgoliaGlobalSearchHelper')
const { updateEditonDataOfNoteParentObject } = require('../Utils/LastObjectEditionHelper')

const getNoteChatTitle = note => note.extendedTitle || note.title || ''

const syncNoteChatTitle = async (projectId, noteId, oldNote, newNote, db = admin.firestore()) => {
    const oldTitle = getNoteChatTitle(oldNote)
    const newTitle = getNoteChatTitle(newNote)
    if (oldTitle === newTitle) return

    const chatRef = db.doc(`chatObjects/${projectId}/chats/${noteId}`)
    const chatDoc = await chatRef.get()
    if (!chatDoc.exists) return

    const chat = chatDoc.data()
    if (chat.type !== 'notes' || chat.title === newTitle) return

    await chatRef.update({ title: newTitle })
}

const onUpdateNote = async (projectId, noteId, change) => {
    const oldNote = change.before.data()
    const newNote = change.after.data()

    const promises = []
    promises.push(updateRecord(projectId, noteId, oldNote, newNote, NOTES_OBJECTS_TYPE, admin.firestore()))
    promises.push(syncNoteChatTitle(projectId, noteId, oldNote, newNote))

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
    getNoteChatTitle,
    syncNoteChatTitle,
    onUpdateNote,
}
