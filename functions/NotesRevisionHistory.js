const { v4: uuidv4 } = require('uuid')
const moment = require('moment')
const { getNoteDelta } = require('./QuillHelper')
const { isEqual } = require('lodash')
const { getBucketsAndDb } = require('./CopyProject/NoteHandlerHelper')

const CURRENT_DAY_VERSION_ID = '-1'

const notesPaths = {
    noteItems: 'noteItems',
    notesData: 'notesData',
    noteItemsVersions: 'noteItemsVersions',
    noteVersionsData: 'noteVersionsData',
    noteItemsDailyVersions: 'noteItemsDailyVersions',
    noteDailyVersionsData: 'noteDailyVersionsData',
}

const processCreatedNoteForRevisionHistory = async (noteMetaData, admin, projectId, noteId) => {
    const { db, versionsBucket, notesBucket } = getBucketsAndDb(admin)

    await processCopy(projectId, noteId, db, notesBucket, versionsBucket, noteMetaData, notesPaths)
}

const processDeletedNoteForRevisionHistory = async (admin, projectId, noteId) => {
    const db = admin.firestore()

    const deletedNotesDataDocs = (
        await db.collection('notesDeleted').where('projectId', '==', projectId).where('noteId', '==', noteId).get()
    ).docs

    if (deletedNotesDataDocs.length > 0) {
        const promises = []
        deletedNotesDataDocs.forEach(doc => {
            promises.push(db.doc(`notesDeleted/${doc.id}`).delete())
        })
        await Promise.all(promises)
    }

    const deletedDate = Date.now()
    await db.doc(`notesDeleted/${uuidv4()}`).set({ projectId, noteId, deletedDate })
}

const processCopy = async (projectId, noteId, db, notesBucket, versionsBucket, noteMetaData, paths) => {
    const noteContentFile = notesBucket.file(`${paths.notesData}/${projectId}/${noteId}`)

    const promises = []

    promises.push(
        versionsBucket.getFiles({
            prefix: `${paths.noteVersionsData}/${projectId}/${noteId}/`,
        })
    )
    promises.push(noteContentFile.exists())

    const promisesResult = await Promise.all(promises)
    const [versionsContentFiles] = promisesResult[0]
    const [noteContentFileExist] = promisesResult[1]

    if (noteContentFileExist) {
        if (versionsContentFiles.length > 0) {
            const { oldestContentFile, newerContentFile } = getOldestAndNewerCopies(versionsContentFiles)

            const isNeededCreateNewCopy = await checkIfIsNeededCreateNewCopy(
                db,
                projectId,
                noteId,
                noteMetaData,
                newerContentFile,
                noteContentFile,
                paths
            )

            if (isNeededCreateNewCopy) {
                const promises = []
                promises.push(removeOldestCopy(projectId, noteId, versionsContentFiles, db, oldestContentFile, paths))
                promises.push(createCopy(versionsBucket, projectId, noteId, noteMetaData, noteContentFile, db, paths))
                await Promise.all(promises)
            }
        } else {
            await createCopy(versionsBucket, projectId, noteId, noteMetaData, noteContentFile, db, paths)
        }
    }
}

const checkIfIsNeededCreateNewCopy = async (
    db,
    projectId,
    noteId,
    noteMetaData,
    newerContentFile,
    noteContentFile,
    paths
) => {
    const promises = []
    promises.push(getNewerCopyMetaData(projectId, noteId, db, newerContentFile, paths))
    promises.push(newerContentFile.download())
    promises.push(noteContentFile.download())

    const promisesResults = await Promise.all(promises)

    const newerMetaData = promisesResults[0]
    const [newerContentData] = promisesResults[1]
    const [noteContentData] = promisesResults[2]

    if (!newerMetaData) {
        return true
    }

    const noteOps = getNoteDelta(noteContentData)
    const versionOps = getNoteDelta(newerContentData)

    return noteMetaData.extendedTitle !== newerMetaData.extendedTitle || opsAreDifferents(noteOps, versionOps)
}

const opsAreDifferents = (ops1, ops2) => {
    if (ops1.length === 0) {
        ops1.push({ insert: '\n' })
    }
    if (ops2.length === 0) {
        ops2.push({ insert: '\n' })
    }
    return !isEqual(ops1, ops2)
}

const getNewerCopyMetaData = async (projectId, noteId, db, newerContentFile, paths) => {
    const versionId = newerContentFile.metadata.name.split('/').slice(-1).toString()
    const newerMetaData = await db.doc(`${paths.noteItemsVersions}/${projectId}/${noteId}/${versionId}`).get()
    return newerMetaData.data()
}

const getOldestAndNewerCopies = versionsContentFiles => {
    let oldestContentFile
    let newerContentFile
    for (let i = 0; i < versionsContentFiles.length; i++) {
        const file = versionsContentFiles[i]
        if (!oldestContentFile || oldestContentFile.metadata.updated > file.metadata.updated) {
            oldestContentFile = file
        }
        if (!newerContentFile || newerContentFile.metadata.updated < file.metadata.updated) {
            newerContentFile = file
        }
    }
    return { oldestContentFile, newerContentFile }
}

const removeOldestCopy = async (projectId, noteId, versionsContentFiles, db, oldestContentFile, paths) => {
    const MAX_AMOUNT_OF_VERSIONS = 10
    if (versionsContentFiles.length === MAX_AMOUNT_OF_VERSIONS) {
        const versionId = oldestContentFile.metadata.name.split('/').slice(-1).toString()
        const promises = []
        const olderNoteMetaDataRef = db.doc(`${paths.noteItemsVersions}/${projectId}/${noteId}/${versionId}`)
        const olderNoteMetaData = await olderNoteMetaDataRef.get()
        if (olderNoteMetaData.data()) {
            promises.push(olderNoteMetaDataRef.delete())
        }
        promises.push(oldestContentFile.delete())
        await Promise.all(promises)
    }
}

const createCopy = async (versionsBucket, projectId, noteId, noteMetaData, noteContentFile, db, paths) => {
    const versionId = uuidv4()
    const versionPath = `gs://${versionsBucket.name}/${paths.noteVersionsData}/${projectId}/${noteId}/${versionId}`
    const versionDate = Date.now()
    const promises = []
    promises.push(noteContentFile.copy(versionPath))
    promises.push(
        db.doc(`${paths.noteItemsVersions}/${projectId}/${noteId}/${versionId}`).set({ ...noteMetaData, versionDate })
    )
    await Promise.all(promises)
}

const createDataGroups = notesDataDocs => {
    const MAX_GROUP_AMOUNT = 50
    const notesDataGroups = [[]]

    notesDataDocs.forEach(element => {
        let lastGorupIndex = notesDataGroups.length - 1
        const lastGroupAmount = notesDataGroups[lastGorupIndex].length
        if (lastGroupAmount === MAX_GROUP_AMOUNT) {
            notesDataGroups.push([])
            lastGorupIndex++
        }
        notesDataGroups[lastGorupIndex].push({ ...element.data(), id: element.id })
    })
    return notesDataGroups
}

const processEditedNotesForRevisionHistory = async admin => {
    const { db, versionsBucket, notesBucket } = getBucketsAndDb(admin)

    const editedNotesDataDocs = (await db.collection(`notesEditedDaily`).get()).docs
    const editedNotesDataGroups = createDataGroups(editedNotesDataDocs)

    for (let i = 0; i < editedNotesDataGroups.length; i++) {
        const group = editedNotesDataGroups[i]
        const promises = []
        for (let n = 0; n < group.length; n++) {
            const editedNoteData = group[n]
            promises.push(processEditedNotes(db, notesBucket, versionsBucket, editedNoteData))
        }
        await Promise.all(promises)
    }
}

const processEditedNotes = async (db, notesBucket, versionsBucket, editedNoteData) => {
    const { projectId, id: noteId } = editedNoteData

    const noteDailyVersionsData = versionsBucket.file(`${notesPaths.noteDailyVersionsData}/${projectId}/${noteId}`)
    let promises = []
    const noteMetaDataRef = db.doc(`${notesPaths.noteItems}/${projectId}/notes/${noteId}`)
    promises.push(noteMetaDataRef.get())
    const noteDailyVersionsMetaDataRef = db.doc(`${notesPaths.noteItemsDailyVersions}/${projectId}/notes/${noteId}`)
    promises.push(noteDailyVersionsMetaDataRef.get())
    promises.push(noteDailyVersionsData.exists())
    promises.push(db.doc(`notesEditedDaily/${noteId}`).delete())
    const results = await Promise.all(promises)
    const noteMetaData = results[0].data()
    const noteDailyVersionsMetaData = results[1]
    const [existNoteDailyVersionsData] = results[2]

    promises = []

    if (noteDailyVersionsMetaData) {
        promises.push(noteDailyVersionsMetaDataRef.delete())
    }
    if (existNoteDailyVersionsData) {
        promises.push(noteDailyVersionsData.delete())
    }
    if (noteMetaData) {
        promises.push(processCopy(projectId, noteId, db, notesBucket, versionsBucket, noteMetaData, notesPaths))
        if (noteMetaData.versionId !== CURRENT_DAY_VERSION_ID) {
            promises.push(noteMetaDataRef.update({ versionId: CURRENT_DAY_VERSION_ID }))
        }
    }
    await Promise.all(promises)
}

const processRevisionHistoryForDeletedNotes = async admin => {
    const { db, versionsBucket } = getBucketsAndDb(admin)

    const deletedNotesDataDocs = (await db.collection('notesDeleted').get()).docs
    const deletedNotesDataGroups = createDataGroups(deletedNotesDataDocs)

    for (let i = 0; i < deletedNotesDataGroups.length; i++) {
        const group = deletedNotesDataGroups[i]
        const promises = []
        for (let n = 0; n < group.length; n++) {
            const deletedNoteData = group[n]
            promises.push(deletedNoteRevisionHistoryData(db, versionsBucket, deletedNoteData))
        }
        await Promise.all(promises)
    }
}

const deletedNoteRevisionHistoryData = async (db, versionsBucket, deletedNoteData) => {
    const { deletedDate, projectId, noteId, id: deleteNoteDataId } = deletedNoteData

    const noteDoc = await db.doc(`${notesPaths.noteItems}/${projectId}/notes/${noteId}`).get()
    const deletedDateEdge = moment().subtract(1, 'weeks').valueOf()

    if (noteDoc.data()) {
        await db.doc(`notesDeleted/${deleteNoteDataId}`).delete()
    } else if (deletedDateEdge > deletedDate) {
        const noteItemDailyVersionContent = versionsBucket.file(
            `${notesPaths.noteDailyVersionsData}/${projectId}/${noteId}`
        )
        let promises = []
        promises.push(db.collection(`${notesPaths.noteItemsVersions}/${projectId}/${noteId}`).get())
        const noteItemDailyVersionRef = db.doc(`${notesPaths.noteItemsDailyVersions}/${projectId}/notes/${noteId}`)
        promises.push(noteItemDailyVersionRef.get())
        promises.push(noteItemDailyVersionContent.exists())

        const promisesResults = await Promise.all(promises)
        const noteItemsVersionsDocs = promisesResults[0].docs
        const noteItemDailyVersion = promisesResults[1].data()
        const [existNoteItemDailyVersionContent] = promisesResults[2]

        promises = []
        promises.push(db.doc(`notesDeleted/${deleteNoteDataId}`).delete())
        noteItemsVersionsDocs.forEach(doc => {
            promises.push(db.doc(`${notesPaths.noteItemsVersions}/${projectId}/${noteId}/${doc.id}`).delete())
        })
        promises.push(
            versionsBucket.deleteFiles({
                force: true,
                prefix: `${notesPaths.noteVersionsData}/${projectId}/${noteId}/`,
            })
        )
        if (noteItemDailyVersion) {
            promises.push(noteItemDailyVersionRef.delete())
        }
        if (existNoteItemDailyVersionContent) {
            promises.push(noteItemDailyVersionContent.delete())
        }
        await Promise.all(promises)
    }
}

module.exports = {
    processEditedNotesForRevisionHistory,
    processRevisionHistoryForDeletedNotes,
    processCreatedNoteForRevisionHistory,
    processDeletedNoteForRevisionHistory,
}
