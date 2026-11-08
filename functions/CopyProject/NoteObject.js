const { FEED_PUBLIC_FOR_ALL, promiseAllAndCatch } = require('./HelperFunctions')
const { addFollower, FOLLOW_TYPE_NOTES } = require('./FollowObjectHelper')
const { getBucketsAndDb } = require('./NoteHandlerHelper')

const CURRENT_DAY_VERSION_ID = '-1'

const copyNotes = async (firebase, projectId, newProjectId, user, originNotes, dismissObjectNotes = true) => {
    const db = firebase.firestore()
    let arrayPromises = []
    let promiseIndex = 0

    originNotes.forEach(note => {
        const noteData = note.data()

        if (noteData.parentObject == null || !dismissObjectNotes) {
            const newNoteRef = db.doc(`/noteItems/${newProjectId}/notes/${note.id}`)
            const newNoteData = {
                ...noteData,
                isPrivate: false,
                isPublicFor: [FEED_PUBLIC_FOR_ALL, user.uid],
                created: Date.now(),
                lastEditorId: user.uid,
                lastEditionDate: Date.now(),
                views: 0,
                creatorId: user.uid,
                userId: user.uid,
                stickyData: { stickyEndDate: 0, days: 0 },
                linkedParentNotesIds: '',
                linkedParentTasksIds: '',
                linkedParentContactsIds: '',
                linkedParentProjectsIds: '',
                linkedParentGoalsIds: '',
                linkedParentSkillsIds: '',
                linkedParentAsistantIds: '',
                linkedParentsInContentIds: '',
                linkedParentsInTitleIds: '',
                versionId: CURRENT_DAY_VERSION_ID,
                isVisibleInFollowedFor: [user.uid],
                followersIds: user.uid,
            }

            if (!arrayPromises[promiseIndex]) arrayPromises[promiseIndex] = []
            arrayPromises[promiseIndex].push(newNoteRef.set(newNoteData))
            arrayPromises[promiseIndex].push(copyNoteData(firebase, projectId, newProjectId, note.id))
            arrayPromises[promiseIndex].push(addFollower(firebase, newProjectId, user.uid, FOLLOW_TYPE_NOTES, note.id))

            if (arrayPromises[promiseIndex].length === 500) {
                promiseIndex += 3
            }
        }
    })

    for (let subArray of arrayPromises) {
        await promiseAllAndCatch(subArray, 'NOTES')
    }

    return true
}

const copyNoteData = async (firebase, projectId, newProjectId, noteId) => {
    const { notesBucket } = getBucketsAndDb(firebase)

    const noteContentFile = notesBucket.file(`notesData/${projectId}/${noteId}`)
    const noteExists = await noteContentFile.exists()

    const noteContentDestiny = `gs://${notesBucket.name}/notesData/${newProjectId}/${noteId}`
    if (noteExists) {
        await noteContentFile.copy(noteContentDestiny)
    } else {
        const emptyNote = new Uint8Array()
        const blob = notesBucket.file(noteContentDestiny)
        const blobStream = blob.createWriteStream({
            resumable: false,
        })

        blobStream.end(emptyNote)
    }
}

const copyObjectNotes = async (firebase, projectId, newProjectId, user, objectNoteIds) => {
    const db = firebase.firestore()
    let arrayPromises = []
    let promiseResults = []
    let promiseIndex = 0

    for (let noteId of objectNoteIds) {
        const noteRef = db.doc(`/noteItems/${projectId}/notes/${noteId}`)

        if (!arrayPromises[promiseIndex]) arrayPromises[promiseIndex] = []
        arrayPromises[promiseIndex].push(noteRef.get())

        if (arrayPromises[promiseIndex].length === 500) {
            promiseIndex++
        }
    }

    for (let subArray of arrayPromises) {
        const results = await promiseAllAndCatch(subArray, 'OBJECT NOTES')
        promiseResults.push(...results)
    }

    await copyNotes(firebase, projectId, newProjectId, user, promiseResults, false)
}

module.exports = {
    CURRENT_DAY_VERSION_ID,
    copyNotes,
    copyObjectNotes,
}
