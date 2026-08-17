const { isEqual } = require('lodash')
const admin = require('firebase-admin')

const {
    mapTaskData,
    mapGoalData,
    mapNoteData,
    mapContactData,
    mapUserData,
    parseTextForSearch,
    mapChatData,
    mapAssistantData,
} = require('./ParsingTextHelper')
const {
    upsertTypesenseDocument,
    deleteTypesenseDocument,
    importTypesenseDocuments,
    deleteTypesenseProjectRecords,
} = require('./typesenseHelper')
const { getProject } = require('./Firestore/generalFirestoreCloud')
const { noteUpdateNeedsIndexing } = require('./searchNoteUpdateGate')
const { getGoalTasksAndSubtasks } = require('./Goals/goalsFirestore')
const { getGoalData } = require('./Goals/goalsFirestore')
const moment = require('moment')
const { DYNAMIC_PERCENT } = require('./Utils/HelperFunctionsCloud')
const { mapProjectData } = require('./Utils/MapDataFuncions')
const { GLOBAL_PROJECT_ID } = require('./Firestore/assistantsFirestore')

const TASKS_INDEX_NAME_PREFIX = 'dev_tasks'
const GOALS_INDEX_NAME_PREFIX = 'dev_goals'
const NOTES_INDEX_NAME_PREFIX = 'dev_notes'
const CONTACTS_INDEX_NAME_PREFIX = 'dev_contacts'
const CHATS_INDEX_NAME_PREFIX = 'dev_updates'

const TASKS_OBJECTS_TYPE = 'tasks'
const GOALS_OBJECTS_TYPE = 'goals'
const NOTES_OBJECTS_TYPE = 'notes'
const CONTACTS_OBJECTS_TYPE = 'contacts'
const ASSISTANTS_OBJECTS_TYPE = 'assistants'
const USERS_OBJECTS_TYPE = 'users'
const CHATS_OBJECTS_TYPE = 'chats'
const CHAT_COMMENTS_TO_INDEX_LIMIT = 80
const CHAT_COMMENTS_TEXT_MAX_LENGTH = 12000

// Typesense-only since Phase 5 of the search migration (TYPESENSE_MIGRATION.md) — the
// Algolia halves of these writes were removed together with the algoliasearch dependency.
const addSearchRecord = async (object, indexPrefix) => {
    await upsertTypesenseDocument(indexPrefix, object)
}

const addSearchRecords = async (objects, indexPrefix) => {
    await importTypesenseDocuments(indexPrefix, objects)
}

const deleteSearchRecord = async (searchObjectId, indexPrefix) => {
    await deleteTypesenseDocument(indexPrefix, searchObjectId)
}

const deleteSearchRecords = async (searchObjectIds, indexPrefix) => {
    await Promise.all(searchObjectIds.map(searchObjectId => deleteTypesenseDocument(indexPrefix, searchObjectId)))
}

const getPrefix = objectsType => {
    if (objectsType === TASKS_OBJECTS_TYPE) {
        return TASKS_INDEX_NAME_PREFIX
    } else if (objectsType === GOALS_OBJECTS_TYPE) {
        return GOALS_INDEX_NAME_PREFIX
    } else if (objectsType === NOTES_OBJECTS_TYPE) {
        return NOTES_INDEX_NAME_PREFIX
    } else if (
        objectsType === CONTACTS_OBJECTS_TYPE ||
        objectsType === USERS_OBJECTS_TYPE ||
        objectsType === ASSISTANTS_OBJECTS_TYPE
    ) {
        return CONTACTS_INDEX_NAME_PREFIX
    } else if (objectsType === CHATS_OBJECTS_TYPE) {
        return CHATS_INDEX_NAME_PREFIX
    }
}

const getCleanChatComments = async (db, projectId, chatId, chatType = 'topics') => {
    try {
        const commentsDocs = await db
            .collection(`chatComments/${projectId}/${chatType}/${chatId}/comments`)
            .orderBy('created', 'desc')
            .limit(CHAT_COMMENTS_TO_INDEX_LIMIT)
            .get()

        if (!commentsDocs || commentsDocs.empty) return ''

        const cleanedComments = []
        commentsDocs.forEach(doc => {
            const commentText = doc.data()?.commentText
            if (typeof commentText === 'string' && commentText.trim().length > 0) {
                cleanedComments.push(parseTextForSearch(commentText, true))
            }
        })

        return cleanedComments.join(' ').substring(0, CHAT_COMMENTS_TEXT_MAX_LENGTH)
    } catch (error) {
        console.log(`Failed to load chat comments for search indexing (${projectId}/${chatId}):`, error.message)
        return ''
    }
}

const mapObject = async (projectId, objectId, algoliaObjectId, object, objectsType, canBeInactive, db) => {
    let cleanObject
    if (objectsType === TASKS_OBJECTS_TYPE) {
        cleanObject = mapTaskData(objectId, algoliaObjectId, object, projectId)
    } else if (objectsType === GOALS_OBJECTS_TYPE) {
        cleanObject = mapGoalData(objectId, algoliaObjectId, object, projectId, canBeInactive)
    } else if (objectsType === NOTES_OBJECTS_TYPE) {
        cleanObject = mapNoteData(objectId, algoliaObjectId, object, projectId)
    } else if (objectsType === CONTACTS_OBJECTS_TYPE) {
        cleanObject = mapContactData(objectId, algoliaObjectId, object, projectId)
    } else if (objectsType === ASSISTANTS_OBJECTS_TYPE) {
        cleanObject = mapAssistantData(algoliaObjectId, object, objectId, projectId)
    } else if (objectsType === CHATS_OBJECTS_TYPE) {
        const cleanComments = await getCleanChatComments(db, projectId, objectId, object?.type || 'topics')
        cleanObject = mapChatData(objectId, algoliaObjectId, object, projectId, { cleanComments })
    }
    return cleanObject
}

// Since Phase 4 of the search migration there are NO eligibility gates here: every record
// is indexed regardless of project state (inactive/template/guide content is hidden from
// default results by the client's scope filters, not by index absence).
const createRecord = async (projectId, objectId, item, objectsType, db, canBeInactive, paramProject) => {
    const algoliaObjectId = objectId + projectId
    const indexPrefix = getPrefix(objectsType)

    let object = await mapObject(projectId, objectId, algoliaObjectId, item, objectsType, canBeInactive, db)

    // If this is a note, get its content from storage
    if (objectsType === NOTES_OBJECTS_TYPE) {
        const { getNoteContent } = require('./searchHelper')
        object.content = await getNoteContent(projectId, objectId)
        console.log(`Creating search record for note ${objectId}:`, {
            objectID: object.objectID,
            title: object.title,
            contentLength: object.content ? object.content.length : 0,
        })
    }

    await addSearchRecord(object, indexPrefix)
}

const deleteRecord = async (objectId, projectId, objectsType) => {
    const indexPrefix = getPrefix(objectsType)
    const algoliaObjectId = objectId + projectId
    await deleteSearchRecord(algoliaObjectId, indexPrefix)
}

const updateRecord = async (projectId, objectId, oldItem, newItem, objectsType, db) => {
    console.log(`Processing update for ${objectsType} ${objectId} in project ${projectId}`)

    // No eligibility gates or recency windows (Phase 4) — every update is indexed.
    // canBeInactive is still computed because the mapped record carries it as an attribute.
    let canBeInactive = false

    if (objectsType === CHATS_OBJECTS_TYPE) {
        canBeInactive = true
    } else if (objectsType === TASKS_OBJECTS_TYPE) {
        const { isSubtask, parentDone, done } = newItem
        canBeInactive = isSubtask ? parentDone : done
    } else if (objectsType === GOALS_OBJECTS_TYPE) {
        const milestoneDocs = await db
            .collection(`goalsMilestones/${projectId}/milestonesItems`)
            .where('done', '==', false)
            .orderBy('date', 'asc')
            .get()

        const goalsDate = milestoneDocs.docs.length
            ? {
                  start: milestoneDocs.docs[0].data().date,
                  end: milestoneDocs.docs[milestoneDocs.docs.length - 1].data().date,
              }
            : { start: null, end: null }

        const { progress, dynamicProgress, completionMilestoneDate, startingMilestoneDate } = newItem

        const isIncompleted = progress !== DYNAMIC_PERCENT && progress !== 100
        const isDynamicIncompleted = progress === DYNAMIC_PERCENT && dynamicProgress !== 100
        const isCompletedAndOpen =
            progress === 100 && completionMilestoneDate >= goalsDate.start && startingMilestoneDate <= goalsDate.end
        const isDynamicCompletedAndOpen =
            progress === DYNAMIC_PERCENT &&
            dynamicProgress === 100 &&
            completionMilestoneDate >= goalsDate.start &&
            startingMilestoneDate <= goalsDate.end

        canBeInactive = !isIncompleted && !isDynamicIncompleted && !isCompletedAndOpen && !isDynamicCompletedAndOpen
    }

    const algoliaObjectId = objectId + projectId
    const indexPrefix = getPrefix(objectsType)

    const objectBefore = await mapObject(projectId, objectId, algoliaObjectId, oldItem, objectsType, canBeInactive, db)
    let objectAfter = await mapObject(projectId, objectId, algoliaObjectId, newItem, objectsType, canBeInactive, db)

    // A note update that cannot have touched the content and changes no indexed
    // field is not worth a full note download from Storage plus a re-index
    // (AT-2340) — see `searchNoteUpdateGate.js` for why that was every backlink,
    // follower and sticky-data write.
    if (objectsType === NOTES_OBJECTS_TYPE && !noteUpdateNeedsIndexing(oldItem, newItem, objectBefore, objectAfter)) {
        console.log(`No indexed change and no content signal for note ${objectId}, skipping search update`)
        return
    }

    // If this is a note, get its content from storage
    if (objectsType === NOTES_OBJECTS_TYPE) {
        const { getNoteContent } = require('./searchHelper')
        objectAfter.content = await getNoteContent(projectId, objectId)
        console.log(`Note content state for ${objectId}:`, {
            beforeLength: objectBefore.content ? objectBefore.content.length : 0,
            afterLength: objectAfter.content ? objectAfter.content.length : 0,
            hasContentChanged: objectBefore.content !== objectAfter.content,
        })
    }

    // For notes, we want to force an update if the content has changed
    const hasContentChanged = objectsType === NOTES_OBJECTS_TYPE && objectBefore.content !== objectAfter.content

    const changes = {}
    Object.keys(objectAfter).forEach(key => {
        if (!isEqual(objectBefore[key], objectAfter[key])) {
            changes[key] = objectAfter[key]
        }
    })

    if (Object.keys(changes).length > 0 || hasContentChanged) {
        console.log(`Updating search record for ${objectsType} ${objectId} with ${Object.keys(changes).length} changes`)
        await addSearchRecord(objectAfter, indexPrefix)
    } else {
        console.log(`No significant changes detected for ${objectsType} ${objectId}, skipping update`)
    }
}

const getObjectsChanges = (objectBefore, objectAfter) => {
    if (objectBefore) {
        const changes = { objectID: objectAfter.objectID }
        const keys = Object.keys(objectAfter)
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i]
            if (!isEqual(objectAfter[key], objectBefore[key])) {
                changes[key] = objectAfter[key]
            }
        }
        return changes
    } else {
        return objectAfter
    }
}

const createUserRecord = async (userId, originalUser) => {
    const indexPrefix = getPrefix(USERS_OBJECTS_TYPE)
    const user = mapUserData(userId, originalUser)

    const projectId = user.projectIds[0]
    user.objectID = userId + projectId
    user.projectId = projectId
    await addSearchRecord(user, indexPrefix)
}

const deleteUserRecord = async (userId, user) => {
    const indexPrefix = getPrefix(USERS_OBJECTS_TYPE)

    const promises = []
    user.projectIds.forEach(projectId => {
        const algoliaObjectId = userId + projectId
        promises.push(deleteSearchRecord(algoliaObjectId, indexPrefix))
    })
    await Promise.all(promises)
}

const updateUserRecord = async (userId, change, admin) => {
    const db = admin.firestore()
    const indexPrefix = getPrefix(USERS_OBJECTS_TYPE)

    const oldUser = mapUserData(userId, change.before.data())
    const newUser = mapUserData(userId, change.after.data())

    const projectsAreTheSame = isEqual(oldUser.projectIds, newUser.projectIds)

    if (projectsAreTheSame) {
        await updateAlgoliaUserRecords(newUser.projectIds, newUser, indexPrefix, db)
    } else {
        const promises = []

        const addedProjectsIds = newUser.projectIds.filter(projectId => !oldUser.projectIds.includes(projectId))
        for (let i = 0; i < addedProjectsIds.length; i++) {
            const projectId = addedProjectsIds[i]
            const user = { ...newUser }
            user.objectID = userId + projectId
            user.projectId = projectId
            user.cleanDescription = parseTextForSearch(user.extendedDescription, true)
            promises.push(addSearchRecord(user, indexPrefix))
        }

        const deletedProjectsIds = oldUser.projectIds.filter(projectId => !newUser.projectIds.includes(projectId))
        for (let i = 0; i < deletedProjectsIds.length; i++) {
            const projectId = deletedProjectsIds[i]
            const algoliaObjectId = userId + projectId
            promises.push(deleteSearchRecord(algoliaObjectId, indexPrefix))
        }
        await Promise.all(promises)

        const staticProjectsIds = newUser.projectIds.filter(projectId => oldUser.projectIds.includes(projectId))

        await updateAlgoliaUserRecords(staticProjectsIds, newUser, indexPrefix, db)
    }
}

const updateAlgoliaUserRecords = async (projectIds, userAfter, indexPrefix, db) => {
    const projectsDocs = await geUserProjectsDocs(projectIds, db)

    const promises = []
    projectsDocs.forEach(projectDoc => {
        const project = mapProjectData(projectDoc.id, projectDoc.data(), {})

        // No eligibility gate since Phase 4 of the Typesense migration — member records
        // are indexed for every project the user belongs to.
        const projectId = projectDoc.id
        const user = { ...userAfter }
        user.objectID = user.uid + projectId
        user.projectId = projectId
        fillRolCompanyAndDescriptionInUser(project, user)
        promises.push(addSearchRecord(user, indexPrefix))
    })
    await Promise.all(promises)
}

const geUserProjectsDocs = async (projectIds, db) => {
    const promises = []
    for (let i = 0; i < projectIds.length; i++) {
        const projectId = projectIds[i]
        if (projectId) {
            promises.push(db.doc(`projects/${projectId}`).get())
        }
    }

    const projectsDocs = await Promise.all(promises)
    return projectsDocs
}

const fillRolCompanyAndDescriptionInUser = (project, user) => {
    const { usersData } = project
    const userData = usersData[user.uid] ? usersData[user.uid] : {}
    const { extendedDescription: descriptionInProject, role: roleInProject, company: companyInProject } = userData
    const { extendedDescription: descriptionGlobal, role: roleGlobal, company: companyGlobal } = user

    user.role = roleInProject ? roleInProject : roleGlobal ? roleGlobal : ''
    user.company = companyInProject ? companyInProject : companyGlobal ? companyGlobal : ''
    const extendedDescription = descriptionInProject ? descriptionInProject : descriptionGlobal ? descriptionGlobal : ''
    user.cleanDescription = parseTextForSearch(extendedDescription, true)
}

// Real project deletion: clear the project's records from the search index.
const removeAlgoliaRecordsInProject = async projectId => {
    await deleteTypesenseProjectRecords(projectId)
}

// Deactivates projects nobody opened in 30 days. Since Phase 4 of the Typesense migration
// it only flips projects.active — search records are KEPT in both stores (Typesense keeps
// everything by design; deleting from Algolia would degrade it as the rollback target).
// The query shape (including the vestigial activeFullSearch clause) is deliberately
// unchanged: it matches the existing composite index, and firestore.indexes.json must not
// be touched casually (see CLAUDE.md).
const checkAndRemoveProjectsWithoutActivityFromAlgolia = async () => {
    const date = moment().subtract(30, 'day').valueOf()
    const projectDocs = (
        await admin
            .firestore()
            .collection(`projects`)
            .where('lastLoggedUserDate', '<', date)
            .where('active', '==', true)
            .where('activeFullSearch', '==', null)
            .get()
    ).docs

    const promises = []
    projectDocs.forEach(doc => {
        promises.push(admin.firestore().doc(`projects/${doc.id}`).update({ active: false }))
    })
    await Promise.all(promises)
}

const proccessAlgoliaRecordsWhenUnlockGoal = async (projectId, goalId, admin) => {
    let promises = []
    promises.push(getGoalData(projectId, goalId))
    promises.push(getGoalTasksAndSubtasks(projectId, goalId))
    promises.push(getProject(projectId, admin))

    const [goal, tasks, project] = await Promise.all(promises)

    promises.push(createRecord(projectId, goalId, goal, GOALS_OBJECTS_TYPE, admin.firestore(), false, project))

    tasks.forEach(task => {
        promises.push(createRecord(projectId, task.id, task, TASKS_OBJECTS_TYPE, admin.firestore(), false, project))
    })

    await Promise.all(promises)
}

module.exports = {
    removeAlgoliaRecordsInProject,
    TASKS_OBJECTS_TYPE,
    GOALS_OBJECTS_TYPE,
    NOTES_OBJECTS_TYPE,
    CONTACTS_OBJECTS_TYPE,
    ASSISTANTS_OBJECTS_TYPE,
    CHATS_OBJECTS_TYPE,
    createUserRecord,
    deleteUserRecord,
    updateUserRecord,
    createRecord,
    deleteRecord,
    updateRecord,
    proccessAlgoliaRecordsWhenUnlockGoal,
    checkAndRemoveProjectsWithoutActivityFromAlgolia,
}
