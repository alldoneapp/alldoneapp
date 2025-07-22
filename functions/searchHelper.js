const admin = require('firebase-admin')
const algoliasearch = require('algoliasearch')
const moment = require('moment')
const Y = require('yjs')

const {
    parseTextForSearch,
    mapTaskData,
    mapGoalData,
    mapNoteData,
    mapContactData,
    mapUserData,
    mapChatData,
    mapAssistantData,
} = require('./ParsingTextHelper')
const { mapUsersInProject, getProject } = require('./Firestore/generalFirestoreCloud')
const { checkIfObjectIsLockedForUser, DYNAMIC_PERCENT } = require('./Utils/HelperFunctionsCloud')
const { getProjectUsers } = require('./Users/usersFirestore')
const { BatchWrapper } = require('./BatchWrapper/batchWrapper')
const { getEnvFunctions } = require('./envFunctionsHelper')

const APP_ID = '????'
const ADMIN_API_KEY = '??????????'
const TASKS_INDEX_NAME_PREFIX = 'dev_tasks'
const GOALS_INDEX_NAME_PREFIX = 'dev_goals'
const NOTES_INDEX_NAME_PREFIX = 'dev_notes'
const CONTACTS_INDEX_NAME_PREFIX = 'dev_contacts'
const UPDATES_INDEX_NAME_PREFIX = 'dev_updates'

const TASKS_OBJECTS_TYPE = 'tasks'
const GOALS_OBJECTS_TYPE = 'goals'
const NOTES_OBJECTS_TYPE = 'notes'
const CONTACTS_OBJECTS_TYPE = 'contacts'
const ASSISTANTS_OBJECTS_TYPE = 'assistants'
const USERS_OBJECTS_TYPE = 'users'
const CHATS_OBJECTS_TYPE = 'chats'

const AMOUNT_OF_SEARCH_BY_PROJECT = 100

const getAlgoliaClient = () => {
    const { ALGOLIA_APP_ID, ALGOLIA_ADMIN_API_KEY } = getEnvFunctions()
    return algoliasearch(ALGOLIA_APP_ID, ALGOLIA_ADMIN_API_KEY)
}

const parseObject = (objectsType, objectId, algoliaObjectId, object, projectId, canBeInactive) => {
    if (objectsType === TASKS_OBJECTS_TYPE) {
        return mapTaskData(objectId, algoliaObjectId, object, projectId)
    } else if (objectsType === GOALS_OBJECTS_TYPE) {
        return mapGoalData(objectId, algoliaObjectId, object, projectId, canBeInactive)
    } else if (objectsType === NOTES_OBJECTS_TYPE) {
        console.log('Parsing note object for Algolia:', {
            objectId,
            title: object.title,
            hasContent: !!object.content,
            contentLength: object.content ? object.content.length : 0,
        })
        const parsedNote = mapNoteData(objectId, algoliaObjectId, object, projectId)
        console.log('Note object after parsing:', {
            objectId,
            title: parsedNote.title,
            hasContent: !!parsedNote.content,
            contentLength: parsedNote.content ? parsedNote.content.length : 0,
        })
        return parsedNote
    } else if (objectsType === CONTACTS_OBJECTS_TYPE) {
        return mapContactData(objectId, algoliaObjectId, object, projectId)
    } else if (objectsType === ASSISTANTS_OBJECTS_TYPE) {
        return mapAssistantData(algoliaObjectId, object, objectId, projectId)
    } else if (objectsType === USERS_OBJECTS_TYPE) {
        return mapUserData(objectId, object)
    } else if (objectsType === CHATS_OBJECTS_TYPE) {
        return mapChatData(objectId, algoliaObjectId, object, projectId)
    }
}

const fillRolCompanyAndDescriptionInUser = (projectsList, projectId, user) => {
    const project = getProjectFromList(projectsList, projectId)
    const { usersData } = project
    const userData = usersData && usersData[user.uid] ? usersData[user.uid] : {}
    const { extendedDescription: descriptionInProject, role: roleInProject, company: companyInProject } = userData
    const { extendedDescription: descriptionGlobal, role: roleGlobal, company: companyGlobal } = user

    user.role = roleInProject ? roleInProject : roleGlobal ? roleGlobal : ''
    user.company = companyInProject ? companyInProject : companyGlobal ? companyGlobal : ''
    const extendedDescription = descriptionInProject ? descriptionInProject : descriptionGlobal ? descriptionGlobal : ''
    user.cleanDescription = parseTextForSearch(extendedDescription, true)
}

const getProjectFromList = (projectsList, projectId) => {
    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        if (project.id === projectId) {
            return project
        }
    }
}

const getNoteContent = async (projectId, noteId) => {
    console.log(`Getting content for note ${noteId} in project ${projectId}`)
    const { defineString } = require('firebase-functions/params')
    const notesBucketName = defineString('GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET').value()
    console.log(`Using storage bucket: ${notesBucketName}`)

    const notesBucket = admin.storage().bucket(notesBucketName)
    const noteContentFile = notesBucket.file(`notesData/${projectId}/${noteId}`)
    const [exists] = await noteContentFile.exists()
    console.log(`Note content file exists: ${exists}`)

    if (!exists) {
        console.log('Note content file does not exist, returning empty string')
        return ''
    }

    console.log('Downloading note content...')
    const [noteContentData] = await noteContentFile.download()
    console.log(`Downloaded note content, size: ${noteContentData.length} bytes`)

    const ydoc = new Y.Doc()
    const update = new Uint8Array(noteContentData)

    if (update.length > 0) {
        console.log('Applying Yjs update...')
        Y.applyUpdate(ydoc, update)
    }

    const type = ydoc.getText('quill')
    const noteOps = type.toDelta()
    console.log(`Extracted ${noteOps.length} Quill delta operations`)

    // Extract text content from the Delta format
    let content = ''
    for (const op of noteOps) {
        if (typeof op.insert === 'string') {
            content += op.insert
        } else if (op.insert && typeof op.insert === 'object') {
            // Handle special inserts like mentions, hashtags, etc.
            const { mention, hashtag, email, url, taskTagFormat } = op.insert
            if (mention) content += `@${mention.name} `
            else if (hashtag) content += `#${hashtag.name} `
            else if (email) content += `${email.address} `
            else if (url) content += `${url.url} `
            else if (taskTagFormat) content += `${taskTagFormat.name} `
        }
    }

    const finalContent = content.trim()
    console.log(`Final content details:`, {
        noteId,
        contentLength: finalContent.length,
        preview: finalContent.substring(0, 100) + '...',
        containsText: finalContent.length > 0,
        firstFewWords: finalContent.split(' ').slice(0, 5).join(' ') + '...',
    })
    return finalContent
}

const processObject = async (projectId, objectId, objectsType, baseObject, usersMap, canBeInactive) => {
    const algoliaObjectId = objectId + projectId
    let object = null

    if (objectsType === TASKS_OBJECTS_TYPE) {
        object = mapTaskData(objectId, baseObject)
    } else if (objectsType === GOALS_OBJECTS_TYPE) {
        object = mapGoalData(objectId, baseObject)
    } else if (objectsType === NOTES_OBJECTS_TYPE) {
        console.log(`Processing note ${objectId} for Algolia indexing`)
        object = mapNoteData(objectId, baseObject)
        // Add note content to the Algolia record
        console.log('Getting note content...')
        object.content = await getNoteContent(projectId, objectId)
        console.log(`Note object for Algolia:`, {
            objectID: algoliaObjectId,
            title: object.title,
            contentLength: object.content ? object.content.length : 0,
        })
    } else if (objectsType === CONTACTS_OBJECTS_TYPE) {
        object = mapContactData(objectId, algoliaObjectId, baseObject, projectId)
    } else if (objectsType === ASSISTANTS_OBJECTS_TYPE) {
        object = mapAssistantData(algoliaObjectId, baseObject, objectId, projectId)
    } else if (objectsType === USERS_OBJECTS_TYPE) {
        object = mapUserData(objectId, baseObject)
    } else if (objectsType === CHATS_OBJECTS_TYPE) {
        object = mapChatData(objectId, algoliaObjectId, baseObject, projectId)
    }

    let isLocked = false
    if (objectsType === TASKS_OBJECTS_TYPE || objectsType === GOALS_OBJECTS_TYPE) {
        isLocked = checkIfObjectIsLockedForUser(object, usersMap)
    }

    const parsedObject = isLocked
        ? null
        : parseObject(objectsType, objectId, algoliaObjectId, object, projectId, canBeInactive)
    if (objectsType === NOTES_OBJECTS_TYPE && parsedObject) {
        console.log(`Final parsed note object for Algolia:`, {
            objectID: parsedObject.objectID,
            title: parsedObject.title,
            contentLength: parsedObject.content ? parsedObject.content.length : 0,
        })
    }
    return parsedObject
}

const addNotesToList = async (projectId, usersMap, objectsList, db) => {
    const docs = await db.collection(`noteItems/${projectId}/notes`).get()

    const promises = docs.docs.map(async doc => {
        const baseObject = doc.data()
        const object = await processObject(projectId, doc.id, NOTES_OBJECTS_TYPE, baseObject, usersMap, false)
        if (object) objectsList.push(object)
    })

    await Promise.all(promises)
}

const addChatsToList = async (projectId, usersMap, objectsList, activeFullSearch, db) => {
    const lastEditionDate = moment().endOf('day').subtract(30, 'day').valueOf()
    const mainRef = db.collection(`chatObjects/${projectId}/chats`).where('type', '==', 'topics')
    const docs = await (activeFullSearch ? mainRef.get() : mainRef.where('lastEditionDate', '>', lastEditionDate).get())

    const tryAddChat = doc => {
        const baseObject = doc.data()
        const object = processObject(projectId, doc.id, CHATS_OBJECTS_TYPE, baseObject, usersMap, true)
        if (object) objectsList.push(object)
    }

    docs.forEach(doc => {
        tryAddChat(doc)
    })
}

const addAssistantsToList = async (projectId, usersMap, objectsList, db) => {
    const docs = await db.collection(`assistants/${projectId}/items`).get()

    const tryAddAssistant = doc => {
        const baseObject = doc.data()
        const object = processObject(projectId, doc.id, ASSISTANTS_OBJECTS_TYPE, baseObject, usersMap, false)
        if (object) objectsList.push(object)
    }

    docs.forEach(doc => {
        tryAddAssistant(doc)
    })
}

const addContactsToList = async (projectId, usersMap, objectsList, db) => {
    const docs = await db.collection(`projectsContacts/${projectId}/contacts`).get()

    const tryAddContact = doc => {
        const baseObject = doc.data()
        const object = processObject(projectId, doc.id, CONTACTS_OBJECTS_TYPE, baseObject, usersMap, false)
        if (object) objectsList.push(object)
    }

    docs.forEach(doc => {
        tryAddContact(doc)
    })
}

const addTasksToList = async (projectId, usersMap, objectsList, activeFullSearch, db) => {
    const tryAddTask = (doc, canBeInactive) => {
        const baseObject = doc.data()
        const object = processObject(projectId, doc.id, TASKS_OBJECTS_TYPE, baseObject, usersMap, canBeInactive)
        if (object) objectsList.push(object)
    }

    const mainRef = db.collection(`items/${projectId}/tasks`)

    if (activeFullSearch) {
        const docs = await mainRef.get()
        docs.forEach(doc => {
            const task = doc.data()
            const { done, parentDone, isSubtask } = task

            if (!done && !isSubtask) {
                tryAddTask(doc, false)
            } else if (!parentDone && isSubtask) {
                tryAddTask(doc, false)
            } else {
                tryAddTask(doc, true)
            }
        })
    } else {
        const lastEditionDate = moment().endOf('day').subtract(30, 'day').valueOf()
        const promises = []
        promises.push(mainRef.where('done', '==', false).where('isSubtask', '==', false).get())
        promises.push(mainRef.where('parentDone', '==', false).where('isSubtask', '==', true).get())
        promises.push(
            mainRef
                .where('done', '==', true)
                .where('isSubtask', '==', false)
                .where('lastEditionDate', '>', lastEditionDate)
                .get()
        )
        promises.push(
            mainRef
                .where('parentDone', '==', true)
                .where('isSubtask', '==', true)
                .where('lastEditionDate', '>', lastEditionDate)
                .get()
        )
        const [notDoneTasksDocs, notDoneSubtasksDocs, doneTasksDocs, doneSubtasksDocs] = await Promise.all(promises)

        notDoneTasksDocs.forEach(doc => {
            tryAddTask(doc, false)
        })
        notDoneSubtasksDocs.forEach(doc => {
            tryAddTask(doc, false)
        })
        doneTasksDocs.forEach(doc => {
            tryAddTask(doc, true)
        })
        doneSubtasksDocs.forEach(doc => {
            tryAddTask(doc, true)
        })
    }
}

const addGoalsToList = async (projectId, usersMap, objectsList, activeFullSearch, db) => {
    const tryAddGoal = (doc, canBeInactive) => {
        const baseObject = doc.data()
        const object = processObject(projectId, doc.id, GOALS_OBJECTS_TYPE, baseObject, usersMap, canBeInactive)
        if (object) objectsList.push(object)
    }

    const mainRef = db.collection(`goals/${projectId}/items`)

    const promises = []
    promises.push(
        db
            .collection(`goalsMilestones/${projectId}/milestonesItems`)
            .where('done', '==', false)
            .orderBy('date', 'asc')
            .get()
    )
    promises.push(mainRef.get())
    const [milestoneDocs, goalDocs] = await Promise.all(promises)

    const goalsDate = milestoneDocs.docs.length
        ? {
              start: milestoneDocs.docs[0].data().date,
              end: milestoneDocs.docs[milestoneDocs.docs.length - 1].data().date,
          }
        : { start: null, end: null }

    const lastEditionDate = moment().endOf('day').subtract(30, 'day').valueOf()

    goalDocs.forEach(doc => {
        const goal = doc.data()
        const { progress, dynamicProgress, completionMilestoneDate, startingMilestoneDate } = goal
        if (progress !== DYNAMIC_PERCENT && progress !== 100) {
            tryAddGoal(doc, false)
        } else if (progress === DYNAMIC_PERCENT && dynamicProgress !== 100) {
            tryAddGoal(doc, false)
        } else if (
            progress === 100 &&
            completionMilestoneDate >= goalsDate.start &&
            startingMilestoneDate <= goalsDate.end
        ) {
            tryAddGoal(doc, false)
        } else if (
            progress === DYNAMIC_PERCENT &&
            dynamicProgress === 100 &&
            completionMilestoneDate >= goalsDate.start &&
            startingMilestoneDate <= goalsDate.end
        ) {
            tryAddGoal(doc, false)
        } else if (activeFullSearch || goal.lastEditionDate > lastEditionDate) {
            tryAddGoal(doc, true)
        }
    })
}

function chunkArray(initialArray, chunkSize) {
    const myArray = [...initialArray]
    const chunks = []
    while (myArray.length) {
        chunks.push(myArray.splice(0, chunkSize))
    }
    return chunks
}

const getIndexName = objectsType => {
    let namePrefix = ''
    if (objectsType === TASKS_OBJECTS_TYPE) {
        namePrefix = TASKS_INDEX_NAME_PREFIX
    } else if (objectsType === GOALS_OBJECTS_TYPE) {
        namePrefix = GOALS_INDEX_NAME_PREFIX
    } else if (objectsType === NOTES_OBJECTS_TYPE) {
        namePrefix = NOTES_INDEX_NAME_PREFIX
    } else if (
        objectsType === CONTACTS_OBJECTS_TYPE ||
        objectsType === USERS_OBJECTS_TYPE ||
        objectsType === ASSISTANTS_OBJECTS_TYPE
    ) {
        namePrefix = CONTACTS_INDEX_NAME_PREFIX
    } else if (objectsType === CHATS_OBJECTS_TYPE) {
        namePrefix = UPDATES_INDEX_NAME_PREFIX
    }
    const indexName = namePrefix
    return indexName
}

const createAlgoliaIndexes = async () => {
    const algoliaClient = getAlgoliaClient()

    const objectTypes = [
        TASKS_OBJECTS_TYPE,
        GOALS_OBJECTS_TYPE,
        NOTES_OBJECTS_TYPE,
        CONTACTS_OBJECTS_TYPE,
        ASSISTANTS_OBJECTS_TYPE,
        USERS_OBJECTS_TYPE,
        CHATS_OBJECTS_TYPE,
    ]

    const promises = []
    objectTypes.forEach(objectType => {
        const indexName = getIndexName(objectType)
        const algoliaIndex = algoliaClient.initIndex(indexName)
        promises.push(configAlgoliaIndex(algoliaIndex, objectType))
    })

    await Promise.all(promises)
}

const configAlgoliaIndex = async (algoliaIndex, objectsType) => {
    if (objectsType === TASKS_OBJECTS_TYPE) {
        await algoliaIndex.setSettings(
            {
                searchableAttributes: ['name'],
                typoTolerance: false,
                ignorePlurals: false,
                customRanking: ['desc(created)'],
                attributesForFaceting: [
                    'filterOnly(projectId)',
                    'filterOnly(done)',
                    'filterOnly(isPrivate)',
                    'filterOnly(isPublicFor)',
                    'filterOnly(userId)',
                    'filterOnly(lockKey)',
                    'filterOnly(lastEditionDate)',
                ],
                hitsPerPage: AMOUNT_OF_SEARCH_BY_PROJECT,
            },
            {
                forwardToReplicas: true,
            }
        )
    } else if (objectsType === GOALS_OBJECTS_TYPE) {
        await algoliaIndex.setSettings(
            {
                searchableAttributes: ['name'],
                typoTolerance: false,
                ignorePlurals: false,
                customRanking: ['desc(created)'],
                attributesForFaceting: [
                    'filterOnly(projectId)',
                    'filterOnly(id)',
                    'filterOnly(isPublicFor)',
                    'filterOnly(ownerId)',
                    'filterOnly(lockKey)',
                    'filterOnly(lastEditionDate)',
                    'filterOnly(canBeInactive)',
                ],
                hitsPerPage: AMOUNT_OF_SEARCH_BY_PROJECT,
            },
            {
                forwardToReplicas: true,
            }
        )
    } else if (objectsType === NOTES_OBJECTS_TYPE) {
        console.log('Configuring Algolia index for notes with searchable attributes:', ['title', 'content'])
        await algoliaIndex.setSettings(
            {
                searchableAttributes: ['title', 'content'],
                typoTolerance: true,
                ignorePlurals: true,
                customRanking: ['desc(lastEditionDate)'],
                attributesForFaceting: [
                    'filterOnly(projectId)',
                    'filterOnly(isPrivate)',
                    'filterOnly(isPublicFor)',
                    'filterOnly(userId)',
                    'filterOnly(lastEditionDate)',
                ],
                hitsPerPage: AMOUNT_OF_SEARCH_BY_PROJECT,
            },
            {
                forwardToReplicas: true,
            }
        )
        // Verify the settings were applied
        const settings = await algoliaIndex.getSettings()
        console.log('Verified notes index settings:', settings)
    } else if (
        objectsType === CONTACTS_OBJECTS_TYPE ||
        objectsType === USERS_OBJECTS_TYPE ||
        objectsType === ASSISTANTS_OBJECTS_TYPE
    ) {
        await algoliaIndex.setSettings(
            {
                searchableAttributes: ['displayName', 'cleanDescription', 'role', 'company'],
                typoTolerance: false,
                ignorePlurals: false,
                customRanking: ['desc(lastEditionDate)'],
                attributesForFaceting: [
                    'filterOnly(projectId)',
                    'filterOnly(isPrivate)',
                    'filterOnly(isPublicFor)',
                    'filterOnly(uid)',
                    'filterOnly(recorderUserId)',
                    'filterOnly(isAssistant)',
                ],
                hitsPerPage: AMOUNT_OF_SEARCH_BY_PROJECT,
            },
            {
                forwardToReplicas: true,
            }
        )
    } else if (objectsType === CHATS_OBJECTS_TYPE) {
        await algoliaIndex.setSettings(
            {
                searchableAttributes: ['cleanName'],
                typoTolerance: false,
                ignorePlurals: false,
                customRanking: ['desc(lastEditionDate)'],
                attributesForFaceting: [
                    'filterOnly(projectId)',
                    'filterOnly(isPrivate)',
                    'filterOnly(isPublicFor)',
                    'filterOnly(lastEditionDate)',
                ],
                hitsPerPage: AMOUNT_OF_SEARCH_BY_PROJECT,
            },
            {
                forwardToReplicas: true,
            }
        )
    }
}

const removeProjectObjectsFromAlgolia = async (objectsType, filters) => {
    const algoliaClient = getAlgoliaClient()
    const indexName = getIndexName(objectsType)
    const algoliaIndex = algoliaClient.initIndex(indexName)

    let matchingRecordIds = []
    await algoliaIndex.browseObjects({
        batch: hits => {
            const hitIds = hits.map(hit => hit.objectID)
            matchingRecordIds = matchingRecordIds.concat(hitIds)
        },
        query: '',
        attributesToRetrieve: ['objectID'],
        filters: filters,
    })
    await algoliaIndex.deleteObjects(matchingRecordIds)
}

const uploadObjectsToAlgolia = async (algoliaClient, objectsList, objectsType) => {
    const indexName = getIndexName(objectsType)
    const algoliaIndex = algoliaClient.initIndex(indexName)
    await configAlgoliaIndex(algoliaIndex, objectsType)

    const objectsGroups = chunkArray(objectsList, 500)

    const promises = []
    objectsGroups.forEach(group => {
        promises.push(algoliaIndex.saveObjects(group))
    })
    await Promise.all(promises)
}

//////////////////////

const getProjectAndUsersMap = async projectId => {
    const usersMap = {}

    const promises = []
    promises.push(getProject(projectId, admin))
    promises.push(mapUsersInProject(projectId, admin.firestore(), usersMap))
    const [project] = await Promise.all(promises)

    return { project, usersMap }
}

const startTasksIndextion = async (projectId, activeFullSearchDate) => {
    const algoliaClient = getAlgoliaClient()

    const { project, usersMap } = await getProjectAndUsersMap(projectId)

    const tasks = []
    await addTasksToList(projectId, usersMap, tasks, !!project.activeFullSearch, admin.firestore())
    await uploadObjectsToAlgolia(algoliaClient, tasks, TASKS_OBJECTS_TYPE)
    await admin.firestore().doc(`algoliaIndexation/${projectId}/objectTypes/tasks`).delete()
    if (activeFullSearchDate) {
        await admin
            .firestore()
            .doc(`algoliaFullSearchIndexation/${projectId}`)
            .set({ tasksFullSearchIndexed: true, activeFullSearchDate }, { merge: true })
    }
}

const startGoalsIndextion = async (projectId, activeFullSearchDate) => {
    const algoliaClient = getAlgoliaClient()

    const { project, usersMap } = await getProjectAndUsersMap(projectId)

    const goals = []
    await addGoalsToList(projectId, usersMap, goals, !!project.activeFullSearch, admin.firestore())
    await uploadObjectsToAlgolia(algoliaClient, goals, GOALS_OBJECTS_TYPE)
    await admin.firestore().doc(`algoliaIndexation/${projectId}/objectTypes/goals`).delete()
    if (activeFullSearchDate) {
        await admin
            .firestore()
            .doc(`algoliaFullSearchIndexation/${projectId}`)
            .set({ goalsFullSearchIndexed: true, activeFullSearchDate }, { merge: true })
    }
}

const startNotesIndextion = async (projectId, activeFullSearchDate) => {
    console.log(`Starting notes indexation for project ${projectId}`)
    const algoliaClient = getAlgoliaClient()

    const notes = []
    console.log('Fetching notes from Firestore...')
    await addNotesToList(projectId, {}, notes, admin.firestore())
    console.log(`Found ${notes.length} notes to index`)

    console.log('Uploading notes to Algolia...')
    await uploadObjectsToAlgolia(algoliaClient, notes, NOTES_OBJECTS_TYPE)
    console.log('Notes uploaded to Algolia')

    await admin.firestore().doc(`algoliaIndexation/${projectId}/objectTypes/notes`).delete()
    if (activeFullSearchDate) {
        await admin
            .firestore()
            .doc(`algoliaFullSearchIndexation/${projectId}`)
            .set({ notesFullSearchIndexed: true, activeFullSearchDate }, { merge: true })
    }
    console.log('Notes indexation completed')
}

const startChatsIndextion = async (projectId, activeFullSearchDate) => {
    const algoliaClient = getAlgoliaClient()

    const project = await getProject(projectId, admin)

    const chats = []
    await addChatsToList(projectId, {}, chats, !!project.activeFullSearch, admin.firestore())
    await uploadObjectsToAlgolia(algoliaClient, chats, CHATS_OBJECTS_TYPE)
    await admin.firestore().doc(`algoliaIndexation/${projectId}/objectTypes/chats`).delete()
    if (activeFullSearchDate) {
        await admin
            .firestore()
            .doc(`algoliaFullSearchIndexation/${projectId}`)
            .set({ chatsFullSearchIndexed: true, activeFullSearchDate }, { merge: true })
    }
}

const startContactsIndextion = async (projectId, activeFullSearchDate) => {
    const algoliaClient = getAlgoliaClient()

    const contacts = []
    await addContactsToList(projectId, {}, contacts, admin.firestore())
    await uploadObjectsToAlgolia(algoliaClient, contacts, CONTACTS_OBJECTS_TYPE)
    await admin.firestore().doc(`algoliaIndexation/${projectId}/objectTypes/contacts`).delete()
    if (activeFullSearchDate) {
        await admin
            .firestore()
            .doc(`algoliaFullSearchIndexation/${projectId}`)
            .set({ contactsFullSearchIndexed: true, activeFullSearchDate }, { merge: true })
    }
}

const startAssistantsIndextion = async (projectId, activeFullSearchDate) => {
    const algoliaClient = getAlgoliaClient()

    const assistants = []
    await addAssistantsToList(projectId, {}, assistants, admin.firestore())
    await uploadObjectsToAlgolia(algoliaClient, assistants, ASSISTANTS_OBJECTS_TYPE)
    await admin.firestore().doc(`algoliaIndexation/${projectId}/objectTypes/assistants`).delete()
    if (activeFullSearchDate) {
        await admin
            .firestore()
            .doc(`algoliaFullSearchIndexation/${projectId}`)
            .set({ assistantsFullSearchIndexed: true, activeFullSearchDate }, { merge: true })
    }
}

const startUsersIndextion = async (projectId, activeFullSearchDate) => {
    const algoliaClient = getAlgoliaClient()

    const promises = []
    promises.push(getProject(projectId, admin))
    promises.push(getProjectUsers(projectId, false))
    const [project, users] = await Promise.all(promises)

    const parsedUsers = []
    users.forEach(user => {
        const userInProject = parseObject(USERS_OBJECTS_TYPE, user.uid, null, user, '', false)
        userInProject.objectID = user.uid + projectId
        userInProject.projectId = projectId
        fillRolCompanyAndDescriptionInUser([project], projectId, userInProject)
        parsedUsers.push(userInProject)
    })

    await uploadObjectsToAlgolia(algoliaClient, parsedUsers, USERS_OBJECTS_TYPE)
    await admin.firestore().doc(`algoliaIndexation/${projectId}/objectTypes/users`).delete()
    if (activeFullSearchDate) {
        await admin
            .firestore()
            .doc(`algoliaFullSearchIndexation/${projectId}`)
            .set({ usersFullSearchIndexed: true, activeFullSearchDate }, { merge: true })
    }
}

const checkAlgoliaFullSearchIndeaxtion = async (projectId, fullSearchIndeaxtion) => {
    const {
        tasksFullSearchIndexed,
        goalsFullSearchIndexed,
        notesFullSearchIndexed,
        chatsFullSearchIndexed,
        contactsFullSearchIndexed,
        assistantsFullSearchIndexed,
        usersFullSearchIndexed,
        activeFullSearchDate,
    } = fullSearchIndeaxtion

    if (
        tasksFullSearchIndexed &&
        goalsFullSearchIndexed &&
        notesFullSearchIndexed &&
        chatsFullSearchIndexed &&
        contactsFullSearchIndexed &&
        assistantsFullSearchIndexed &&
        usersFullSearchIndexed
    ) {
        const batch = new BatchWrapper(admin.firestore())
        batch.delete(admin.firestore().doc(`algoliaFullSearchIndexation/${projectId}`))
        batch.update(admin.firestore().doc(`projects/${projectId}`), { activeFullSearch: activeFullSearchDate })
        await batch.commit()
    }
}

/////////////////////

module.exports = {
    removeProjectObjectsFromAlgolia,
    startTasksIndextion,
    startGoalsIndextion,
    startNotesIndextion,
    startContactsIndextion,
    startAssistantsIndextion,
    startChatsIndextion,
    startUsersIndextion,
    checkAlgoliaFullSearchIndeaxtion,
    getAlgoliaClient,
    getNoteContent,
    processObject,
    addNotesToList,
    configAlgoliaIndex,
    uploadObjectsToAlgolia,
    createAlgoliaIndexes,
}
