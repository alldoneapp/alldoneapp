const admin = require('firebase-admin')

const deleteNote = async (projectId, noteId, movingToOtherProjectId, admin) => {
    if (movingToOtherProjectId) await copyNoteToOtherProject(projectId, movingToOtherProjectId, noteId, admin)
    await admin.firestore().doc(`noteItems/${projectId}/notes/${noteId}`).delete()
}

const getNoteByParentId = async (projectId, parentId, admin) => {
    const docs = (
        await admin
            .firestore()
            .collection(`noteItems/${projectId}/notes`)
            .where('parentObject.id', '==', parentId)
            .get()
    ).docs
    return docs[0] ? { ...docs[0].data(), id: docs[0].id } : null
}

const copyNoteToOtherProject = async (oldProjectId, newProjectId, noteId, admin) => {
    const { defineString } = require('firebase-functions/params')
    const notesBucketName = defineString('GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET').value()

    const notesBucket = admin.storage().bucket(notesBucketName)
    const noteContentFile = notesBucket.file(`notesData/${oldProjectId}/${noteId}`)

    let promises = []
    promises.push(noteContentFile.exists())
    promises.push(admin.firestore().doc(`noteItems/${oldProjectId}/notes/${noteId}`).get())
    const [existContent, noteDoc] = await Promise.all(promises)

    if (existContent && noteDoc.exists) {
        promises = []
        promises.push(noteContentFile.copy(`gs://${notesBucketName}/notesData/${newProjectId}/${noteId}`))
        promises.push(
            admin
                .firestore()
                .doc(`noteItems/${newProjectId}/notes/${noteId}`)
                .set({ ...noteDoc.data() })
        )
        await Promise.all(promises)
    }
}

const updateNoteEditionData = async (projectId, noteId, editorId) => {
    try {
        await admin.firestore().runTransaction(async transaction => {
            const ref = admin.firestore().doc(`noteItems/${projectId}/notes/${noteId}`)
            const noteDoc = await transaction.get(ref)
            if (noteDoc.exists) transaction.update(ref, { lastEditionDate: Date.now(), lastEditorId: editorId })
        })
    } catch (e) {
        console.log('Transaction failure:', e)
    }
}

const updateNoteLastCommentData = async (projectId, noteId, lastComment, lastCommentType) => {
    try {
        await admin.firestore().runTransaction(async transaction => {
            const ref = admin.firestore().doc(`noteItems/${projectId}/notes/${noteId}`)
            const noteDoc = await transaction.get(ref)
            if (noteDoc.exists)
                transaction.update(ref, {
                    [`commentsData.lastComment`]: lastComment,
                    [`commentsData.lastCommentType`]: lastCommentType,
                    [`commentsData.amount`]: admin.firestore.FieldValue.increment(1),
                })
        })
    } catch (e) {
        console.log('Transaction failure:', e)
    }
}

module.exports = {
    deleteNote,
    getNoteByParentId,
    updateNoteEditionData,
    updateNoteLastCommentData,
}
