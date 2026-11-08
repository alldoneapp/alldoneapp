const admin = require('firebase-admin')

const { removeAlgoliaRecordsInProject } = require('../AlgoliaGlobalSearchHelper')
const { recursiveDeleteHelper } = require('../Utils/HelperFunctionsCloud')
const {
    deleteHeartbeatSchedulesForProject,
    safelySyncHeartbeatSchedules,
} = require('../Assistant/assistantHeartbeatSchedule')

const removeProjectData = async (projectId, admin) => {
    const basePaths = [
        // Each artifact's delete trigger removes its versions' bytes from Storage.
        'artifactItems',
        'assistantTasks',
        'assistants',
        'chatComments',
        'chatNotifications',
        'chatObjects',
        'events',
        'feedsCount',
        'feedsObjectsLastStates',
        'feedsStore',
        'followers',
        'goals',
        'goalsMilestones',
        'invoiceData',
        'items',
        'noteItems',
        'noteItemsDailyVersions',
        'noteItemsVersions',
        'projectsContacts',
        'projectsFeeds',
        'projectsInnerFeeds',
        'projectsInvitation',
        'projectsWorkstreams',
        'skills',
        'skillsDefaultPrivacy',
        'statistics',
        'tagsColors',
        'usersFollowing',
        // security audit 2026-11 (NV-26): every other root keyed by the project id. A root left
        // here outlives the project and is inherited by whoever registers the id next (which the
        // `deletedProjects` tombstone now prevents) or read by a stale member's client.
        'artifactUploadIndex',
        'assistantSkillImports',
        'assistantSkills',
        'chatFollowers',
        'firestoreAccessProjectionJobs',
        'knowledgeBases',
        'notesCollab',
        'okrs',
        'oldFeeds',
        'projectHappiness',
        'vmGoldens',
        'workstreams',
    ]

    const deletePromises = []

    basePaths.forEach(basePath => {
        const path = `${basePath}/${projectId}`
        deletePromises.push(recursiveDeleteHelper(path))
    })

    const getPromises = []
    getPromises.push(admin.firestore().collection(`notesDeleted`).where('projectId', '==', projectId).get())
    getPromises.push(admin.firestore().collection(`stickyNotesData`).where('projectId', '==', projectId).get())
    // Keyed `${projectId}__${objectId}`, with the project id also stored as a field.
    getPromises.push(admin.firestore().collection('vmSessions').where('projectId', '==', projectId).get())
    const [notesDeletedDocs, stickyNotesDataDocs, vmSessionDocs] = await Promise.all(getPromises)

    vmSessionDocs.forEach(doc => {
        deletePromises.push(doc.ref.delete())
    })

    // Note bodies live in the notes bucket, keyed by project (storage.notes.rules lets a member read
    // a body whose note document does not exist, so a body left behind is readable by a re-created
    // project's members). Best effort: a failure here must not stop the Firestore cleanup.
    deletePromises.push(
        (async () => {
            const { getNotesBucketName } = require('../shared/notesStorageBucket')
            await admin
                .storage()
                .bucket(getNotesBucketName())
                .deleteFiles({ prefix: `notesData/${projectId}/` })
        })().catch(error =>
            console.warn('onDeleteProject: note bodies not removed', { projectId, error: error.message })
        )
    )

    notesDeletedDocs.forEach(doc => {
        deletePromises.push(admin.firestore().doc(`notesDeleted/${doc.id}`).delete())
    })

    stickyNotesDataDocs.forEach(doc => {
        deletePromises.push(admin.firestore().doc(`stickyNotesData/${doc.id}`).delete())
    })

    await Promise.all(deletePromises)
}

const DELETED_PROJECTS_COLLECTION = 'deletedProjects'

/**
 * A deleted project id is never handed out again: firestore.rules refuses to create
 * `projects/{projectId}` while `deletedProjects/{projectId}` exists. Without it, anybody who knew
 * the id (a removed member, a viewer of a link-shared project) could register it and become the
 * only member of everything the cleanup missed or has not reached yet. Server-only collection
 * (no client rule). Written FIRST, so the window before the cleanup finishes is closed too.
 */
const writeDeletedProjectTombstone = async (projectId, db = admin.firestore()) => {
    await db
        .collection(DELETED_PROJECTS_COLLECTION)
        .doc(projectId)
        .set({ projectId, deletedAt: Date.now() }, { merge: true })
}

const onDeleteProject = async projectId => {
    await writeDeletedProjectTombstone(projectId)
    const promises = []
    promises.push(removeProjectData(projectId, admin))
    promises.push(removeAlgoliaRecordsInProject(projectId, { alsoRemoveFromTypesense: true }))
    promises.push(
        safelySyncHeartbeatSchedules(() => deleteHeartbeatSchedulesForProject(projectId), {
            source: 'project_deleted',
            projectId,
        })
    )
    await Promise.all(promises)
}

module.exports = { DELETED_PROJECTS_COLLECTION, onDeleteProject, removeProjectData, writeDeletedProjectTombstone }
