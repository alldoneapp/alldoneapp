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
const { DYNAMIC_PERCENT } = require('./Utils/HelperFunctionsCloud')
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
const CHAT_COMMENTS_TO_INDEX_LIMIT = 80
const CHAT_COMMENTS_TEXT_MAX_LENGTH = 12000

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

const getChatCommentsForSearch = async (projectId, chatId, chatType, db) => {
    try {
        const commentsDocs = await db
            .collection(`chatComments/${projectId}/${chatType || 'topics'}/${chatId}/comments`)
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
        console.log(`Error getting chat comments for search (${projectId}/${chatId}):`, error.message)
        return ''
    }
}

const processObject = async (projectId, objectId, objectsType, baseObject, usersMap, canBeInactive, db = null) => {
    const algoliaObjectId = objectId + projectId
    let object = null

    if (objectsType === TASKS_OBJECTS_TYPE) {
        object = mapTaskData(objectId, algoliaObjectId, baseObject, projectId)
    } else if (objectsType === GOALS_OBJECTS_TYPE) {
        object = mapGoalData(objectId, algoliaObjectId, baseObject, projectId)
    } else if (objectsType === NOTES_OBJECTS_TYPE) {
        console.log(`Processing note ${objectId} for Algolia indexing`)
        // mapNoteData is (noteId, algoliaObjectId, note, projectId) — this call used to pass
        // (objectId, baseObject), so `note` was undefined and EVERY note in a bulk reindex
        // threw at `note.extendedTitle`. Pre-AT-2258 the unawaited rejection was swallowed;
        // afterwards it failed the whole notes indexation. Found by the Typesense backfill.
        object = mapNoteData(objectId, algoliaObjectId, baseObject, projectId)
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
        const cleanComments = await getChatCommentsForSearch(
            projectId,
            objectId,
            baseObject?.type,
            db || admin.firestore()
        )
        object = mapChatData(objectId, algoliaObjectId, baseObject, projectId, { cleanComments })
    }

    // NOTE: a guide-lock check used to sit here, as
    // `checkIfObjectIsLockedForUser(object, usersMap)`. Its signature is
    // `(projectId, lockKey, user)`, so the mapped object arrived as `projectId`,
    // `usersMap` as `lockKey` — always a truthy object, so the `if (lockKey)`
    // branch was always taken — and `user` as `undefined`, which the body
    // immediately destructures. It therefore threw a TypeError for EVERY task
    // and EVERY goal it ever saw. Because `processObject` is async that surfaced
    // as a rejected promise, and the callers did not await it, so it was
    // swallowed as an unhandled rejection: bulk reindexation of tasks and goals
    // silently produced nothing at all. (AT-2258 measured it: the goals creator
    // backfill reindexed 634 records and populated 0.)
    //
    // It is removed rather than repaired because there is no correct argument to
    // give it here. The check asks "is this locked for THIS user", and the bulk
    // path indexes a project once for everybody — there is no such user, only a
    // map of them. More to the point, index-time locking was never actually in
    // force: the per-object create/update path never applied it and writes
    // almost every record in production, and the client does not filter on
    // `lockKey` either. Reinstating it here would not restore a behaviour, it
    // would introduce a new one — silently changing what every user can find —
    // and that belongs in its own change.
    const parsedObject = parseObject(objectsType, objectId, algoliaObjectId, object, projectId, canBeInactive)
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
        const object = await processObject(projectId, doc.id, NOTES_OBJECTS_TYPE, baseObject, usersMap, false, db)
        if (object) objectsList.push(object)
    })

    await Promise.all(promises)
}

const addChatsToList = async (projectId, usersMap, objectsList, activeFullSearch, db) => {
    const lastEditionDate = moment().endOf('day').subtract(30, 'day').valueOf()
    const mainRef = db.collection(`chatObjects/${projectId}/chats`).where('type', '==', 'topics')
    const docs = await (activeFullSearch ? mainRef.get() : mainRef.where('lastEditionDate', '>', lastEditionDate).get())

    const tryAddChat = async doc => {
        const baseObject = doc.data()
        const object = await processObject(projectId, doc.id, CHATS_OBJECTS_TYPE, baseObject, usersMap, true, db)
        if (object) objectsList.push(object)
    }
    const promises = []
    docs.forEach(doc => {
        promises.push(tryAddChat(doc))
    })
    await Promise.all(promises)
}

// `processObject` is ASYNC (the chats branch awaits the topic's comments). A
// caller that forgets to await it pushes a PROMISE into the upload list, and
// `saveObjects` then serialises `{}` — the reindex "succeeds" and writes junk,
// or throws far away from the mistake. `addNotesToList` / `addChatsToList`
// await it; the four builders below did not, which silently broke bulk
// reindexation for tasks, goals, contacts and assistants (found via AT-2258:
// the goals creator backfill reindexed 634 records and populated none of them,
// while chats — the one type that awaits — populated 327 of 337).
//
// Collecting promises and resolving them here keeps each builder's structure
// and its `if (object)` skip for locked objects, which `processObject` returns
// as null.
const collectProcessedObjects = async (pendingObjects, objectsList) => {
    const objects = await Promise.all(pendingObjects)
    objects.forEach(object => {
        if (object) objectsList.push(object)
    })
}

const addAssistantsToList = async (projectId, usersMap, objectsList, db) => {
    const docs = await db.collection(`assistants/${projectId}/items`).get()

    const pendingObjects = []
    const tryAddAssistant = doc => {
        const baseObject = doc.data()
        pendingObjects.push(processObject(projectId, doc.id, ASSISTANTS_OBJECTS_TYPE, baseObject, usersMap, false))
    }

    docs.forEach(doc => {
        tryAddAssistant(doc)
    })

    await collectProcessedObjects(pendingObjects, objectsList)
}

const addContactsToList = async (projectId, usersMap, objectsList, db) => {
    const docs = await db.collection(`projectsContacts/${projectId}/contacts`).get()

    const pendingObjects = []
    const tryAddContact = doc => {
        const baseObject = doc.data()
        pendingObjects.push(processObject(projectId, doc.id, CONTACTS_OBJECTS_TYPE, baseObject, usersMap, false))
    }

    docs.forEach(doc => {
        tryAddContact(doc)
    })

    await collectProcessedObjects(pendingObjects, objectsList)
}

const addTasksToList = async (projectId, usersMap, objectsList, activeFullSearch, db) => {
    const pendingObjects = []
    const tryAddTask = (doc, canBeInactive) => {
        const baseObject = doc.data()
        pendingObjects.push(processObject(projectId, doc.id, TASKS_OBJECTS_TYPE, baseObject, usersMap, canBeInactive))
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

    await collectProcessedObjects(pendingObjects, objectsList)
}

const addGoalsToList = async (projectId, usersMap, objectsList, activeFullSearch, db) => {
    const pendingObjects = []
    const tryAddGoal = (doc, canBeInactive) => {
        const baseObject = doc.data()
        pendingObjects.push(processObject(projectId, doc.id, GOALS_OBJECTS_TYPE, baseObject, usersMap, canBeInactive))
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

    await collectProcessedObjects(pendingObjects, objectsList)
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

// Pushes each index's Algolia settings. Two things to know before adding an
// attribute to `attributesForFaceting` here (both learned from AT-2258):
//
//  1. THIS FUNCTION IS NOT CALLED BY A DEPLOY. It runs only from
//     `createAlgoliaIndexes` and the bulk-upload path, so shipping a new
//     `filterOnly(...)` line does not make that attribute filterable in
//     production — the settings have to be pushed explicitly.
//  2. DECLARING A FACET DOES NOT BACKFILL IT. Records indexed before the
//     matching `map*Data` change carry no such attribute, so they simply never
//     match. Existing objects need a reindex
//     (`startProjectIndexationInAlgolia` in AlgoliaGlobalSearchHelper.js).
//
// Both failures are silent: Algolia answers a filter that matches nothing with
// an empty result set, not an error, so the tab just renders "no results".
const configAlgoliaIndex = async (algoliaIndex, objectsType) => {
    if (objectsType === TASKS_OBJECTS_TYPE) {
        await algoliaIndex.setSettings(
            {
                searchableAttributes: ['humanReadableIdSearchable', 'humanReadableId', 'name'],
                typoTolerance: true, // Enable typo tolerance for better partial matching
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
                    'filterOnly(creatorId)',
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
                searchableAttributes: ['cleanName', 'cleanLastComment', 'cleanComments'],
                typoTolerance: false,
                ignorePlurals: false,
                customRanking: ['desc(lastEditionDate)'],
                attributesForFaceting: [
                    'filterOnly(projectId)',
                    'filterOnly(isPrivate)',
                    'filterOnly(isPublicFor)',
                    'filterOnly(creatorId)',
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
    // Dual-write (TYPESENSE_MIGRATION.md Phase 1): bulk indexation mirrors into Typesense.
    // The import never throws, so Algolia bulk uploads are unaffected by Typesense state.
    const { importTypesenseDocuments } = require('./typesenseHelper')
    promises.push(importTypesenseDocuments(indexName, objectsList))
    await Promise.all(promises)
}

//////////////////////

// The seven start*Indextion entry points, getProjectAndUsersMap and
// checkAlgoliaFullSearchIndeaxtion were removed in Phase 4 of the Typesense migration
// together with their algoliaIndexation/algoliaFullSearchIndexation triggers. Bulk
// (re)indexation is Typesense-only now: migration/backfillTypesense.js.

// Used by the Typesense backfill (migration/backfillTypesense.js): builds the per-project
// member records exactly as the retired startUsersIndextion always did.
const buildProjectUsersSearchRecords = async projectId => {
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
    return parsedUsers
}

/////////////////////

module.exports = {
    removeProjectObjectsFromAlgolia,
    getAlgoliaClient,
    getNoteContent,
    processObject,
    addNotesToList,
    addGoalsToList,
    addTasksToList,
    addContactsToList,
    addAssistantsToList,
    addChatsToList,
    buildProjectUsersSearchRecords,
    configAlgoliaIndex,
    uploadObjectsToAlgolia,
    createAlgoliaIndexes,
    getIndexName,
    GOALS_OBJECTS_TYPE,
    CHATS_OBJECTS_TYPE,
}
