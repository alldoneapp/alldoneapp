const algoliasearch = require('algoliasearch')
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
const { removeProjectObjectsFromAlgolia, getAlgoliaClient } = require('./searchHelper')
const { getProject, updateFullSearchInProject, getUserProjects } = require('./Firestore/generalFirestoreCloud')
const { getGoalTasksAndSubtasks } = require('./Goals/goalsFirestore')
const { getGoalData } = require('./Goals/goalsFirestore')
const moment = require('moment')
const { DYNAMIC_PERCENT } = require('./Utils/HelperFunctionsCloud')
const { BatchWrapper } = require('./BatchWrapper/batchWrapper')
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

const getAlgoliaIndex = indexPrefix => {
    return getAlgoliaClient().initIndex(indexPrefix)
}

const addAlgoliaRecord = async (object, indexPrefix) => {
    const algoliaIndex = getAlgoliaIndex(indexPrefix)
    await algoliaIndex.saveObject(object)
}

const addAlgoliaRecords = async (objects, indexPrefix) => {
    const algoliaIndex = getAlgoliaIndex(indexPrefix)
    await algoliaIndex.saveObjects(objects)
}

const deleteAlgoliaRecord = async (algoliaObjectId, indexPrefix) => {
    const algoliaIndex = getAlgoliaIndex(indexPrefix)
    await algoliaIndex.deleteObject(algoliaObjectId)
}

const deleteAlgoliaRecords = async (algoliaObjectIds, indexPrefix) => {
    const algoliaIndex = getAlgoliaIndex(indexPrefix)
    await algoliaIndex.deleteObjects(algoliaObjectIds)
}

const updateAlgoliaRecord = async (object, indexPrefix) => {
    const algoliaIndex = getAlgoliaIndex(indexPrefix)
    await algoliaIndex.partialUpdateObject(object)
}

const updateAlgoliaRecords = async (objects, indexPrefix) => {
    const algoliaIndex = getAlgoliaIndex(indexPrefix)
    await algoliaIndex.partialUpdateObjects(objects, {
        createIfNotExists: false,
    })
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

const mapObject = (projectId, objectId, algoliaObjectId, object, objectsType, canBeInactive) => {
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
        cleanObject = mapChatData(objectId, algoliaObjectId, object, projectId)
    }
    return cleanObject
}

const createRecord = async (projectId, objectId, item, objectsType, db, canBeInactive, paramProject) => {
    const project =
        projectId === GLOBAL_PROJECT_ID
            ? { id: GLOBAL_PROJECT_ID, activeFullSearch: true }
            : paramProject || (await getProject(projectId, admin))

    if (!project) return
    if (!project.activeFullSearch && (!project.active || project.parentTemplateId)) return

    const algoliaObjectId = objectId + projectId
    const indexPrefix = getPrefix(objectsType)

    let object = mapObject(projectId, objectId, algoliaObjectId, item, objectsType, canBeInactive)

    // If this is a note, get its content from storage
    if (objectsType === NOTES_OBJECTS_TYPE) {
        const { getNoteContent } = require('./searchHelper')
        object.content = await getNoteContent(projectId, objectId)
        console.log(`Creating Algolia record for note ${objectId}:`, {
            objectID: object.objectID,
            title: object.title,
            contentLength: object.content ? object.content.length : 0,
        })
    }

    await addAlgoliaRecord(object, indexPrefix)
}

const deleteRecord = async (objectId, projectId, objectsType) => {
    const indexPrefix = getPrefix(objectsType)
    const algoliaObjectId = objectId + projectId
    await deleteAlgoliaRecord(algoliaObjectId, indexPrefix)
}

const updateRecord = async (projectId, objectId, oldItem, newItem, objectsType, db) => {
    const lastEditionDate = moment().endOf('day').subtract(30, 'day').valueOf()
    console.log(`Processing update for ${objectsType} ${objectId} in project ${projectId}`)

    const project =
        projectId === GLOBAL_PROJECT_ID
            ? { id: GLOBAL_PROJECT_ID, activeFullSearch: true }
            : await getProject(projectId, admin)

    if (!project) {
        console.log(`Project not found for ${objectId}, skipping update`)
        return
    }
    if (!project.activeFullSearch && (!project.active || project.parentTemplateId)) {
        console.log(`Project ${projectId} not eligible for search indexing, skipping update`)
        return
    }

    const objectIsInactive = !project.activeFullSearch && newItem.lastEditionDate <= lastEditionDate
    let canBeInactive = false

    if (objectsType === CHATS_OBJECTS_TYPE) {
        if (objectIsInactive) {
            console.log(`Chat ${objectId} is inactive, skipping update`)
            return
        }
        canBeInactive = true
    } else if (objectsType === TASKS_OBJECTS_TYPE) {
        const { isSubtask, parentDone, done } = newItem
        const isDone = isSubtask ? parentDone : done
        if (isDone && objectIsInactive) {
            console.log(`Task ${objectId} is done and inactive, skipping update`)
            return
        }
        canBeInactive = isDone
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

        if (
            !isIncompleted &&
            !isDynamicIncompleted &&
            !isCompletedAndOpen &&
            !isDynamicCompletedAndOpen &&
            objectIsInactive
        ) {
            console.log(`Goal ${objectId} is complete and inactive, skipping update`)
            return
        }
        canBeInactive = !isIncompleted && !isDynamicIncompleted && !isCompletedAndOpen && !isDynamicCompletedAndOpen
    }

    const algoliaObjectId = objectId + projectId
    const indexPrefix = getPrefix(objectsType)

    const objectBefore = mapObject(projectId, objectId, algoliaObjectId, oldItem, objectsType, canBeInactive)
    let objectAfter = mapObject(projectId, objectId, algoliaObjectId, newItem, objectsType, canBeInactive)

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

    if (Object.keys(changes).length > 1 || hasContentChanged) {
        console.log(
            `Updating Algolia record for ${objectsType} ${objectId} with ${Object.keys(changes).length} changes`
        )
        await addAlgoliaRecord(objectAfter, indexPrefix)
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
    await addAlgoliaRecord(user, indexPrefix)
}

const deleteUserRecord = async (userId, user) => {
    const indexPrefix = getPrefix(USERS_OBJECTS_TYPE)

    const promises = []
    user.projectIds.forEach(projectId => {
        const algoliaObjectId = userId + projectId
        promises.push(deleteAlgoliaRecord(algoliaObjectId, indexPrefix))
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
            promises.push(addAlgoliaRecord(user, indexPrefix))
        }

        const deletedProjectsIds = oldUser.projectIds.filter(projectId => !newUser.projectIds.includes(projectId))
        for (let i = 0; i < deletedProjectsIds.length; i++) {
            const projectId = deletedProjectsIds[i]
            const algoliaObjectId = userId + projectId
            promises.push(deleteAlgoliaRecord(algoliaObjectId, indexPrefix))
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

        if (project.activeFullSearch || (project.active && !project.parentTemplateId)) {
            const projectId = projectDoc.id
            const user = { ...userAfter }
            user.objectID = user.uid + projectId
            user.projectId = projectId
            fillRolCompanyAndDescriptionInUser(project, user)
            promises.push(addAlgoliaRecord(user, indexPrefix))
        }
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

const removeAlgoliaRecordsInProject = async projectId => {
    const filters = `projectId:${projectId}`
    const promises = []
    promises.push(removeProjectObjectsFromAlgolia(TASKS_OBJECTS_TYPE, filters))
    promises.push(removeProjectObjectsFromAlgolia(GOALS_OBJECTS_TYPE, filters))
    promises.push(removeProjectObjectsFromAlgolia(NOTES_OBJECTS_TYPE, filters))
    promises.push(removeProjectObjectsFromAlgolia(USERS_OBJECTS_TYPE, filters))
    promises.push(removeProjectObjectsFromAlgolia(CHATS_OBJECTS_TYPE, filters))
    await Promise.all(promises)
}

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
        promises.push(removeAlgoliaRecordsInProject(doc.id))
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

const checkAndRemoveInactiveObjectsFromAlgolia = async () => {
    const client = getAlgoliaClient()
    const chatsIndex = client.initIndex(CHATS_INDEX_NAME_PREFIX)
    const notesIndex = client.initIndex(NOTES_INDEX_NAME_PREFIX)
    const tasksIndex = client.initIndex(TASKS_INDEX_NAME_PREFIX)
    const goalsIndex = client.initIndex(GOALS_INDEX_NAME_PREFIX)
    const contactsIndex = client.initIndex(CONTACTS_INDEX_NAME_PREFIX)

    const activeFullSearchLimit = moment().endOf('day').subtract(14, 'day').valueOf()

    let promises = []
    promises.push(
        admin
            .firestore()
            .collection(`users`)
            .where('activeFullSearchDate', '<', activeFullSearchLimit)
            .where('activeFullSearchDate', '!=', null)
            .get()
    )
    promises.push(admin.firestore().collection(`projects`).where('activeFullSearch', '!=', null).get())

    const [userDocs, projectDocs] = await Promise.all(promises)

    const projectIdsWithFullSearch = []
    const notSearchableProjectsThatLostFullSearch = []
    promises = []
    userDocs.forEach(doc => {
        promises.push(admin.firestore().doc(`users/${doc.id}`).update({ activeFullSearchDate: null }))
    })
    projectDocs.forEach(doc => {
        const project = mapProjectData(doc.id, doc.data(), {})
        if (project.activeFullSearch !== 'indexing') {
            if (project.activeFullSearch > activeFullSearchLimit) {
                projectIdsWithFullSearch.push(doc.id)
            } else {
                if (!project.active || project.parentTemplateId) notSearchableProjectsThatLostFullSearch.push(doc.id)
                promises.push(admin.firestore().doc(`projects/${doc.id}`).update({ activeFullSearch: null }))
            }
        }
    })

    let fullSearchProjectsIdsFilter = ''
    if (projectIdsWithFullSearch.length === 1) {
        fullSearchProjectsIdsFilter = `NOT projectId:${projectIdsWithFullSearch[0]}`
    } else {
        for (let i = 0; i < projectIdsWithFullSearch.length; i++) {
            const id = projectIdsWithFullSearch[i]
            i === 0
                ? (fullSearchProjectsIdsFilter = `NOT projectId:${id}`)
                : (fullSearchProjectsIdsFilter += ` AND NOT projectId:${id}`)
        }
    }

    let notSearchableProjectIdsFilter = ''
    if (notSearchableProjectsThatLostFullSearch.length === 1) {
        notSearchableProjectIdsFilter = `projectId:${notSearchableProjectsThatLostFullSearch[0]}`
    } else {
        for (let i = 0; i < notSearchableProjectsThatLostFullSearch.length; i++) {
            const id = notSearchableProjectsThatLostFullSearch[i]
            i === 0
                ? (notSearchableProjectIdsFilter = `projectId:${id}`)
                : (notSearchableProjectIdsFilter += ` OR projectId:${id}`)
        }
    }

    const lastEditionDate = moment().endOf('day').subtract(30, 'day').valueOf()

    const chatsFilter = fullSearchProjectsIdsFilter
        ? `(${fullSearchProjectsIdsFilter}) AND lastEditionDate <= ${lastEditionDate}`
        : `lastEditionDate <= ${lastEditionDate}`
    promises.push(chatsIndex.deleteBy({ filters: chatsFilter }))
    if (notSearchableProjectIdsFilter) promises.push(chatsIndex.deleteBy({ filters: notSearchableProjectIdsFilter }))

    const tasksFilter = fullSearchProjectsIdsFilter
        ? `(${fullSearchProjectsIdsFilter}) AND done:true AND lastEditionDate <= ${lastEditionDate}`
        : `done:true AND lastEditionDate <= ${lastEditionDate}`
    promises.push(tasksIndex.deleteBy({ filters: tasksFilter }))
    if (notSearchableProjectIdsFilter) promises.push(tasksIndex.deleteBy({ filters: notSearchableProjectIdsFilter }))

    const goalsFilter = fullSearchProjectsIdsFilter
        ? `(${fullSearchProjectsIdsFilter}) AND canBeInactive:true AND lastEditionDate <= ${lastEditionDate}`
        : `canBeInactive:true AND lastEditionDate <= ${lastEditionDate}`
    promises.push(goalsIndex.deleteBy({ filters: goalsFilter }))
    if (notSearchableProjectIdsFilter) promises.push(goalsIndex.deleteBy({ filters: notSearchableProjectIdsFilter }))

    if (notSearchableProjectIdsFilter) promises.push(notesIndex.deleteBy({ filters: notSearchableProjectIdsFilter }))
    if (notSearchableProjectIdsFilter) promises.push(contactsIndex.deleteBy({ filters: notSearchableProjectIdsFilter }))

    await Promise.all(promises)
}

const startProjectIndexationInAlgolia = async (projects, activeFullSearchDate) => {
    const batch = new BatchWrapper(admin.firestore())
    projects.forEach(project => {
        batch.set(admin.firestore().doc(`algoliaIndexation/${project.id}/objectTypes/tasks`), {
            activeFullSearchDate,
        })
        batch.set(admin.firestore().doc(`algoliaIndexation/${project.id}/objectTypes/goals`), {
            activeFullSearchDate,
        })
        batch.set(admin.firestore().doc(`algoliaIndexation/${project.id}/objectTypes/notes`), {
            activeFullSearchDate,
        })
        batch.set(admin.firestore().doc(`algoliaIndexation/${project.id}/objectTypes/users`), {
            activeFullSearchDate,
        })
        batch.set(admin.firestore().doc(`algoliaIndexation/${project.id}/objectTypes/contacts`), {
            activeFullSearchDate,
        })
        batch.set(admin.firestore().doc(`algoliaIndexation/${project.id}/objectTypes/chats`), {
            activeFullSearchDate,
        })
        batch.set(admin.firestore().doc(`algoliaIndexation/${project.id}/objectTypes/assistants`), {
            activeFullSearchDate,
        })
    })
    await batch.commit(true)
}

const indexProjectsRecordsInAlgolia = async userId => {
    const projects = await getUserProjects(userId, admin)
    const activeFullSearchDate = Date.now()

    const batch = new BatchWrapper(admin.firestore())
    batch.update(admin.firestore().doc(`users/${userId}`), { activeFullSearchDate })
    projects.forEach(project => {
        if (project.activeFullSearch) {
            if (project.activeFullSearch !== 'indexing')
                updateFullSearchInProject(project.id, activeFullSearchDate, admin.firestore(), batch)
        } else {
            updateFullSearchInProject(project.id, 'indexing', admin.firestore(), batch)
        }
    })
    await batch.commit()
    await startProjectIndexationInAlgolia(projects, activeFullSearchDate)
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
    checkAndRemoveInactiveObjectsFromAlgolia,
    indexProjectsRecordsInAlgolia,
    startProjectIndexationInAlgolia,
    checkAndRemoveProjectsWithoutActivityFromAlgolia,
}
