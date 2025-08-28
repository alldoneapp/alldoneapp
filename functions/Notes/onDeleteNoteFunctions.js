const admin = require('firebase-admin')

const { NOTES_OBJECTS_TYPE, deleteRecord } = require('../AlgoliaGlobalSearchHelper')
const { removeObjectFromBacklinks } = require('../Backlinks/backlinksHelper')
const { deleteChat } = require('../Chats/chatsFirestoreCloud')
const { getProject } = require('../Firestore/generalFirestoreCloud')
const { processDeletedNoteForRevisionHistory } = require('../NotesRevisionHistory')
const { mapTaskData } = require('../Utils/MapDataFuncions')
const { deleteNote } = require('./notesFirestoreCloud')

const removeNoteContent = async (projectId, noteId) => {
    const { defineString } = require('firebase-functions/params')
    const notesBucketName = defineString('GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET').value()

    const notesBucket = admin.storage().bucket(notesBucketName)
    const noteContentFile = notesBucket.file(`notesData/${projectId}/${noteId}`)
    const exist = await noteContentFile.exists()
    if (exist) await noteContentFile.delete()
}

const getNoteInnerTasks = async (projectId, noteId) => {
    const tasksDocs = (
        await admin
            .firestore()
            .collection(`items/${projectId}/tasks`)
            .where('containerNotesIds', 'array-contains-any', [noteId])
            .get()
    ).docs

    const tasks = []
    tasksDocs.forEach(doc => {
        tasks.push(mapTaskData(doc.id, doc.data()))
    })
    return tasks
}

const removeNoteFromInnerTasks = async (projectId, taskId, noteId) => {
    await admin
        .firestore()
        .doc(`items/${projectId}/tasks/${taskId}`)
        .update({
            containerNotesIds: admin.firestore.FieldValue.arrayRemove(noteId),
        })
}

const removeNotesFromInnerTasks = async (projectId, noteId) => {
    const tasks = await getNoteInnerTasks(projectId, noteId)
    const promises = []
    tasks.forEach(task => {
        promises.push(removeNoteFromInnerTasks(projectId, task.id, noteId))
    })
    await Promise.all(promises)
}

async function deleteLinkedGuidesNotesIfProjectIsTemplate(projectId, note) {
    const project = await getProject(projectId, admin)
    if (project) {
        const { guideProjectIds, templateCreatorId, isTemplate } = project
        const { parentObject, isVisibleInFollowedFor } = note

        const isTemplateCreatorObjectNote = parentObject && parentObject.id === templateCreatorId
        const isTemplateParentNote =
            isTemplate &&
            (!parentObject || isTemplateCreatorObjectNote) &&
            isVisibleInFollowedFor.includes(templateCreatorId)
        if (isTemplateParentNote) {
            const promises = []
            guideProjectIds.forEach(guideId => {
                const guideNoteId = isTemplateCreatorObjectNote ? guideId + templateCreatorId : guideId + note.id
                promises.push(deleteNote(guideId, guideNoteId, '', admin))
            })
            await Promise.all(promises)
        }
    }
}

const deleteStickyData = async noteId => {
    await admin.firestore().doc(`stickyNotesData/${noteId}`).delete()
}

const onDeleteNote = async (projectId, note) => {
    const { id: noteId, movingToOtherProjectId } = note

    const promises = []
    promises.push(deleteChat(admin, projectId, noteId))
    promises.push(removeNoteContent(projectId, noteId))
    promises.push(removeNotesFromInnerTasks(projectId, noteId))
    promises.push(deleteLinkedGuidesNotesIfProjectIsTemplate(projectId, note))
    promises.push(processDeletedNoteForRevisionHistory(admin, projectId, noteId))
    promises.push(deleteStickyData(noteId))
    if (!movingToOtherProjectId)
        promises.push(removeObjectFromBacklinks(projectId, 'linkedParentNotesIds', noteId, admin))
    promises.push(deleteRecord(noteId, projectId, NOTES_OBJECTS_TYPE))
    await Promise.all(promises)
}

module.exports = {
    onDeleteNote,
}
