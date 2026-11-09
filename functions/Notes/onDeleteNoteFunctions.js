const admin = require('firebase-admin')

const { NOTES_OBJECTS_TYPE, deleteRecord } = require('../AlgoliaGlobalSearchHelper')
const { removeObjectFromBacklinks } = require('../Backlinks/backlinksHelper')
const { deleteChat } = require('../Chats/chatsFirestoreCloud')
const { getProject } = require('../Firestore/generalFirestoreCloud')
const { processDeletedNoteForRevisionHistory } = require('../NotesRevisionHistory')
const { mapTaskData } = require('../Utils/MapDataFuncions')
const { deleteNote } = require('./notesFirestoreCloud')
const { FieldValue } = require('firebase-admin/firestore')

const removeNoteContent = async (projectId, noteId) => {
    const { getNotesBucketName } = require('../shared/notesStorageBucket')
    const notesBucketName = getNotesBucketName()

    const notesBucket = admin.storage().bucket(notesBucketName)
    const noteContentFile = notesBucket.file(`notesData/${projectId}/${noteId}`)
    const exist = await noteContentFile.exists()
    if (exist) await noteContentFile.delete()
}

// The daily copy (noteDailyVersionsData, default bucket) holds the body as it was before a revision
// restore. Once the note document is gone, storage.rules gives no client access to it any more,
// so nothing can use it; delete it now instead of at the next 00:00 Europe/Berlin run. A moved
// note gets this too: setNoteProject's own client-side delete races the document delete. The
// noteVersionsData snapshots keep their one-week retention (processRevisionHistoryForDeletedNotes).
const removeNoteDailyCopy = async (projectId, noteId) => {
    try {
        await admin
            .storage()
            .bucket()
            .file(`noteDailyVersionsData/${projectId}/${noteId}`)
            .delete({ ignoreNotFound: true })
    } catch (error) {
        console.warn('[onDeleteNote] could not delete the daily note copy', { projectId, noteId, error })
    }
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
            containerNotesIds: FieldValue.arrayRemove(noteId),
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
    promises.push(removeNoteDailyCopy(projectId, noteId))
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
    removeNoteDailyCopy,
}
