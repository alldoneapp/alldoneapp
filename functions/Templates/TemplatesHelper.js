const moment = require('moment')
const { v4: uuidv4 } = require('uuid')
const Y = require('yjs')
const { defineString } = require('firebase-functions/params')

const { cleanGlobalFeeds } = require('../Feeds/globalFeedsHelper')

const {
    FEED_PUBLIC_FOR_ALL,
    REGEX_URL,
    REGEX_MENTION,
    MENTION_SPACE_CODE,
    CAPACITY_NONE,
    BACKLOG_MILESTONE_ID,
    BACKLOG_DATE_NUMERIC,
    OPEN_STEP,
    CURRENT_DAY_VERSION_ID,
    DYNAMIC_PERCENT,
    getTaskNameWithoutMeta,
    generateNegativeSortIndex,
} = require('../Utils/HelperFunctionsCloud')

const { getFirebaseTimestampDirectly, getId } = require('../Firestore/generalFirestoreCloud')
const { replaceIdsInUrl } = require('./TemplatesLinksHelper')
const {
    getMainOpenTasks,
    getOpenMilestones,
    getAllNotes,
    getListFollowedContacts,
    uploadMilestone,
    uploadNote,
    loadGlobalData,
    copyHashtags,
    getNotesLinkedToTemplate,
    addUnlockedKeyToCreator,
    getAssistantTasks,
    uploadAssistantTask,
} = require('../Firestore/templatesFirestore')
const { getGlobalState } = require('../GlobalState/globalState')
const {
    getGlobalAssistants,
    updateAssistantData,
    GLOBAL_PROJECT_ID,
    getProjectAssistants,
    uploadNewAssistant,
} = require('../Firestore/assistantsFirestore')
const { getAllGoalsAssignedToUser, uploadNewGoal } = require('../Goals/goalsFirestore')
const { getProjectContacts, uploadNewContact } = require('../Firestore/contactsFirestore')
const { uploadTask } = require('../Tasks/tasksFirestoreCloud')
const { getMentionData } = require('../Utils/parseTextUtils')

const selectOpenGoalsAndMilestones = (goals, milestonesByDate, templateId, creatorId) => {
    const milestones = {}
    const openGoals = []

    goals.forEach(goal => {
        const { completionMilestoneDate, progress, dynamicProgress } = goal
        const belongsToOpenMilestone = !!milestonesByDate[completionMilestoneDate]
        const belongsToBacklog =
            completionMilestoneDate === BACKLOG_DATE_NUMERIC &&
            progress !== 100 &&
            (progress !== DYNAMIC_PERCENT || dynamicProgress !== 100)
        const goalNeedToBeCopied = belongsToOpenMilestone || belongsToBacklog
        if (goalNeedToBeCopied) {
            openGoals.push(goal)
            if (belongsToOpenMilestone) milestones[completionMilestoneDate] = milestonesByDate[completionMilestoneDate]
        }
    })

    const openMilestonesWithGoals = Object.values(milestones).sort((a, b) => a.date - b.date)

    const tempMilestones = [
        ...openMilestonesWithGoals,
        { date: BACKLOG_DATE_NUMERIC, id: `${BACKLOG_MILESTONE_ID}${templateId}` },
    ]

    tempMilestones.forEach(milestone => {
        const goalsInMilestone = openGoals.filter(
            goal => goal.startingMilestoneDate <= milestone.date && goal.completionMilestoneDate >= milestone.date
        )

        goalsInMilestone.sort(
            (a, b) =>
                (b.sortIndexByMilestone[milestone.id]
                    ? b.sortIndexByMilestone[milestone.id]
                    : Number.MAX_SAFE_INTEGER) -
                (a.sortIndexByMilestone[milestone.id] ? a.sortIndexByMilestone[milestone.id] : Number.MAX_SAFE_INTEGER)
        )

        goalsInMilestone.forEach(goal => {
            if (goal.globalSortIndex === undefined) goal.globalSortIndex = generateNegativeSortIndex()
        })
    })
    openGoals.sort((a, b) => b.globalSortIndex - a.globalSortIndex)
    return { goals: openGoals, milestones: openMilestonesWithGoals }
}

const selectFollowedContacts = (contacts, followedContactsList) => {
    const followedContacts = contacts.filter(contact => !!followedContactsList[contact.uid])
    return followedContacts
}

const selectFollowedNotesAndObjectNotes = (
    creatorId,
    allNotes,
    tasksByOldId,
    goalsByOldId,
    contactsByOldId,
    assistantsByOldId
) => {
    const notes = allNotes.filter(note => {
        return (
            (!note.parentObject &&
                note.isVisibleInFollowedFor.includes(creatorId) &&
                note.isPublicFor.includes(FEED_PUBLIC_FOR_ALL)) ||
            (note.parentObject &&
                (creatorId === note.parentObject.id ||
                    tasksByOldId[note.parentObject.id] ||
                    goalsByOldId[note.parentObject.id] ||
                    contactsByOldId[note.parentObject.id] ||
                    assistantsByOldId[note.parentObject.id]))
        )
    })
    return notes
}

const getTemplateObjects = async (appAdmin, projectId, userId, isNewGuide, globalAssistantIds) => {
    let promises = []
    promises.push(getMainOpenTasks(appAdmin, projectId, userId))
    promises.push(getOpenMilestones(appAdmin, projectId))
    promises.push(getAllGoalsAssignedToUser(projectId, userId))
    promises.push(getAllNotes(appAdmin, projectId))
    promises.push(getProjectContacts(projectId))
    promises.push(getListFollowedContacts(appAdmin, projectId, userId))
    promises.push(getProjectAssistants(appAdmin, projectId))
    if (isNewGuide) promises.push(getGlobalAssistants(appAdmin))

    const results = await Promise.all(promises)

    const tasks = results[0]
    const milestonesByDate = results[1]
    const allGoals = results[2]
    const allNotes = results[3]
    const allContacts = results[4]
    const followedContactsList = results[5]
    const assistants = results[6]
    const globalAssistants = isNewGuide
        ? globalAssistantIds.map(assistantId => results[7].find(assistant => assistant.uid === assistantId))
        : []

    let assistantTasks = []
    if (isNewGuide && assistants.length > 0) {
        promises = []
        assistants.forEach(assistant => {
            promises.push(getAssistantTasks(appAdmin, projectId, assistant.uid))
        })
        assistantTasks = await Promise.all(promises)
    }

    const { goals, milestones } = selectOpenGoalsAndMilestones(allGoals, milestonesByDate, projectId, userId)
    const contacts = selectFollowedContacts(allContacts, followedContactsList)

    return { tasks, milestones, goals, allNotes, contacts, assistants, assistantTasks, globalAssistants }
}

const getItemsByOldIdsAndAddNewId = (items, guideId, useUidProperty, needsIdBoundedToTheTemplate) => {
    const { templateCreator } = getGlobalState()
    const itemsByOldId = {}
    items.forEach(item => {
        const oldId = item.id || item.uid
        itemsByOldId[oldId] = item
        item.id =
            !needsIdBoundedToTheTemplate || (item.parentObject && item.parentObject.id !== templateCreator.uid)
                ? getId()
                : item.parentObject && item.parentObject.id === templateCreator.uid
                ? guideId + templateCreator.uid
                : guideId + oldId

        item.oldId = oldId
        if (useUidProperty) item.uid = item.id
    })
    return itemsByOldId
}

const proccessExtendedTexts = (text, templateId, creatorId, objectsMap, guideId, userId, userName) => {
    const LINE_BREAKS_KEY = 'LNBRD573KLSJF89503DAHDK4850DKAJDFG834'
    const tmpText = text.trim().replace(/(\r\n|\n|\r)/gm, LINE_BREAKS_KEY)
    const lines = tmpText.split(LINE_BREAKS_KEY)
    let finalText = ''
    lines.forEach(line => {
        const words = line.split(' ')
        words.forEach(word => {
            if (REGEX_URL.test(word)) {
                finalText += replaceIdsInUrl(templateId, creatorId, objectsMap, word, guideId, userId)
            } else if (REGEX_MENTION.test(word)) {
                const { userId: mentionUserId } = getMentionData(word)
                const contact = objectsMap.contacts[mentionUserId]
                const mentionText =
                    creatorId === mentionUserId
                        ? `@${userName.replace(/ /g, MENTION_SPACE_CODE)}#${userId}`
                        : contact
                        ? `@${contact.displayName.replace(/ /g, MENTION_SPACE_CODE)}#${contact.id}`
                        : word
                finalText += mentionText
            } else {
                finalText += word
            }
            finalText += ' '
        })
        finalText = finalText.trim() + '\n'
    })
    finalText = finalText.trim()

    return finalText
}

const updateLinkedParentIds = (object, linkedPropertyName, linkedIds, linkedObjects) => {
    object[linkedPropertyName] = []
    if (linkedIds) {
        linkedIds.forEach(id => {
            if (linkedObjects[id]) {
                const { id: newId } = linkedObjects[id]
                object[linkedPropertyName].push(newId)
            }
        })
    }
}

const updateAllLinkedParentIds = (object, linkedParentsMap, objectsByOldIdMap, templateId, guideId) => {
    const {
        linkedParentNotesIds,
        linkedParentTasksIds,
        linkedParentContactsIds,
        linkedParentGoalsIds,
        linkedParentProjectsIds,
        linkedParentAssistantIds,
    } = linkedParentsMap

    const { notesByOldId, tasksByOldId, contactsByOldId, goalsByOldId, assistantsByOldId } = objectsByOldIdMap
    updateLinkedParentIds(object, 'linkedParentNotesIds', linkedParentNotesIds, notesByOldId)
    updateLinkedParentIds(object, 'linkedParentTasksIds', linkedParentTasksIds, tasksByOldId)
    updateLinkedParentIds(object, 'linkedParentGoalsIds', linkedParentGoalsIds, goalsByOldId)
    updateLinkedParentIds(object, 'linkedParentAssistantIds', linkedParentAssistantIds, assistantsByOldId)
    updateLinkedParentIds(object, 'linkedParentContactsIds', linkedParentContactsIds, contactsByOldId)
    object.linkedParentProjectsIds = linkedParentProjectsIds.includes(templateId) ? [guideId] : []
    object.linkedParentSkillsIds = []
}

const generateNewTasks = (
    templateId,
    creatorId,
    objectsMap,
    guideId,
    userId,
    tasks,
    tasksByOldId,
    goalsByOldId,
    contactsByOldId,
    notesByOldId,
    assistantsByOldId,
    dateDifference,
    dateNow,
    userName,
    unlockedTemplate
) => {
    const newTasks = []
    tasks.forEach(task => {
        const {
            extendedName,
            description,
            isPublicFor,
            parentId,
            subtaskIds,
            estimations,
            linkedParentNotesIds,
            linkedParentTasksIds,
            linkedParentContactsIds,
            linkedParentGoalsIds,
            linkedParentAssistantIds,
            linkedParentProjectsIds,
            parentGoalId,
            parentGoalIsPublicFor,
            noteId,
            containerNotesIds,
            dueDate,
            assistantId,
        } = task
        const newTask = { ...task }

        newTask.assistantId =
            assistantId && objectsMap.assistants[assistantId]
                ? objectsMap.assistants[assistantId].isGlobal
                    ? assistantId
                    : guideId + assistantId
                : ''
        newTask.extendedName = proccessExtendedTexts(
            extendedName,
            templateId,
            creatorId,
            objectsMap,
            guideId,
            userId,
            userName
        )
        newTask.name = getTaskNameWithoutMeta(newTask.extendedName)
        newTask.description = proccessExtendedTexts(
            description,
            templateId,
            creatorId,
            objectsMap,
            guideId,
            userId,
            userName
        )
        newTask.userId = userId
        newTask.userIds = [userId]
        newTask.currentReviewerId = userId
        newTask.created = dateNow
        newTask.creatorId = userId
        newTask.dueDate = dueDate === BACKLOG_DATE_NUMERIC ? BACKLOG_DATE_NUMERIC : dueDate + dateDifference
        newTask.lastEditorId = userId
        newTask.lastEditionDate = dateNow
        newTask.observersIds = []
        newTask.dueDateByObserversIds = {}
        newTask.estimationsByObserverIds = {}
        newTask.stepHistory = [OPEN_STEP]
        newTask.linkBack = ''
        newTask.comments = []
        newTask.timesPostponed = 0
        newTask.timesFollowed = 0
        newTask.timesDoneInExpectedDay = 0
        newTask.timesDone = 0
        newTask.estimations = { [OPEN_STEP]: estimations[OPEN_STEP] }
        newTask.isPublicFor = isPublicFor.includes(FEED_PUBLIC_FOR_ALL) ? [FEED_PUBLIC_FOR_ALL] : [userId]
        newTask.sortIndex = generateNegativeSortIndex()
        updateAllLinkedParentIds(
            newTask,
            {
                linkedParentNotesIds,
                linkedParentTasksIds,
                linkedParentContactsIds,
                linkedParentGoalsIds,
                linkedParentProjectsIds,
                linkedParentAssistantIds,
            },
            { notesByOldId, tasksByOldId, contactsByOldId, goalsByOldId, assistantsByOldId },
            templateId,
            guideId
        )

        newTask.parentId = tasksByOldId[parentId] ? tasksByOldId[parentId].id : null
        newTask.subtaskIds = []
        newTask.subtaskNames = []
        subtaskIds.forEach(id => {
            if (tasksByOldId[id]) {
                const { id: newId, extendedName } = tasksByOldId[id]
                newTask.subtaskIds.push(newId)
                newTask.subtaskNames.push(
                    proccessExtendedTexts(extendedName, templateId, creatorId, objectsMap, guideId, userId, userName)
                )
            }
        })

        newTask.lockKey = !unlockedTemplate && goalsByOldId[parentGoalId] ? parentGoalId : ''
        newTask.parentGoalId = goalsByOldId[parentGoalId] ? goalsByOldId[parentGoalId].id : null
        newTask.parentGoalIsPublicFor =
            goalsByOldId[parentGoalId] && parentGoalIsPublicFor
                ? parentGoalIsPublicFor.includes(FEED_PUBLIC_FOR_ALL)
                    ? [FEED_PUBLIC_FOR_ALL]
                    : [userId]
                : null

        newTask.noteId = notesByOldId[noteId] ? notesByOldId[noteId].id : null
        newTask.containerNotesIds = []
        containerNotesIds.forEach(id => {
            if (notesByOldId[id]) {
                const { id: newId } = notesByOldId[id]
                newTask.containerNotesIds.push(newId)
            }
        })

        newTasks.push(newTask)
    })
    return newTasks
}

const generateNewGoals = (
    templateId,
    creatorId,
    objectsMap,
    guideId,
    userId,
    goals,
    notesByOldId,
    dateDifference,
    dateNow,
    userName,
    milestonesByOldId,
    unlockedTemplate
) => {
    const oldMilestonesIds = Object.keys(milestonesByOldId)
    const putGoalsInBacklog = oldMilestonesIds.length === 0

    const newGoals = []

    goals.forEach(goal => {
        const {
            extendedName,
            description,
            assigneesCapacity,
            isPublicFor,
            noteId,
            progress,
            assigneesReminderDate,
            completionMilestoneDate,
            startingMilestoneDate,
            oldId,
            assistantId,
        } = goal
        const newGoal = { ...goal }

        newGoal.assistantId == assistantId && objectsMap.assistants[assistantId]
            ? objectsMap.assistants[assistantId].isGlobal
                ? assistantId
                : guideId + assistantId
            : ''
        newGoal.extendedName = proccessExtendedTexts(
            extendedName,
            templateId,
            creatorId,
            objectsMap,
            guideId,
            userId,
            userName
        )
        newGoal.name = getTaskNameWithoutMeta(newGoal.extendedName)
        newGoal.description = proccessExtendedTexts(
            description,
            templateId,
            creatorId,
            objectsMap,
            guideId,
            userId,
            userName
        )
        newGoal.created = dateNow
        newGoal.creatorId = userId
        newGoal.progress = progress === DYNAMIC_PERCENT ? DYNAMIC_PERCENT : 0
        newGoal.dynamicProgress = 0
        newGoal.assigneesIds = [userId]
        newGoal.assigneesCapacity = { [userId]: assigneesCapacity[creatorId] || CAPACITY_NONE }
        newGoal.assigneesReminderDate = {
            [userId]:
                assigneesReminderDate[creatorId] === BACKLOG_DATE_NUMERIC
                    ? BACKLOG_DATE_NUMERIC
                    : assigneesReminderDate[creatorId] + dateDifference,
        }
        newGoal.lastEditionDate = dateNow
        newGoal.lastEditorId = userId
        newGoal.startingMilestoneDate = putGoalsInBacklog
            ? BACKLOG_DATE_NUMERIC
            : startingMilestoneDate === BACKLOG_DATE_NUMERIC
            ? BACKLOG_DATE_NUMERIC
            : startingMilestoneDate + dateDifference
        newGoal.completionMilestoneDate = putGoalsInBacklog
            ? BACKLOG_DATE_NUMERIC
            : completionMilestoneDate === BACKLOG_DATE_NUMERIC
            ? BACKLOG_DATE_NUMERIC
            : completionMilestoneDate + dateDifference
        newGoal.parentDoneMilestoneIds = []
        newGoal.progressByDoneMilestone = {}
        newGoal.dateByDoneMilestone = {}
        newGoal.isPublicFor = isPublicFor.includes(FEED_PUBLIC_FOR_ALL) ? [FEED_PUBLIC_FOR_ALL] : [userId]
        newGoal.noteId = notesByOldId[noteId] ? notesByOldId[noteId].id : null
        newGoal.ownerId = userId
        newGoal.lockKey = unlockedTemplate ? '' : oldId

        newGoal.sortIndexByMilestone = {}
        if (putGoalsInBacklog) {
            const newBacklogId = `${BACKLOG_MILESTONE_ID}${guideId}`
            newGoal.sortIndexByMilestone[newBacklogId] = newGoal.globalSortIndex
        } else {
            const oldMilestoneId = oldMilestonesIds[0]
            const newMilestoneId = milestonesByOldId[oldMilestoneId].id
            newGoal.sortIndexByMilestone[newMilestoneId] = newGoal.globalSortIndex
        }

        newGoals.push(newGoal)
    })
    return newGoals
}

const generateNewMilestones = (
    templateId,
    creatorId,
    objectsMap,
    guideId,
    userId,
    milestones,
    dateMiddleOfDay,
    dateDifference,
    dateNow,
    userName
) => {
    const newMilestones = []
    milestones.forEach(milestone => {
        const { extendedName, date } = milestone
        const newMilestone = { ...milestone }

        newMilestone.extendedName = proccessExtendedTexts(
            extendedName,
            templateId,
            creatorId,
            objectsMap,
            guideId,
            userId,
            userName
        )
        newMilestone.created = dateNow
        newMilestone.date = date + dateDifference
        newMilestone.assigneesCapacityDates = {}
        newMilestone.doneDate = dateMiddleOfDay
        newMilestone.ownerId = userId

        newMilestones.push(newMilestone)
    })
    return newMilestones
}

const generateNewContacts = (
    templateId,
    creatorId,
    objectsMap,
    guideId,
    userId,
    contacts,
    notesByOldId,
    dateNow,
    userName
) => {
    const newContacts = []
    contacts.forEach(contact => {
        const { displayName, description, extendedDescription, noteId, isPublicFor, assistantId } = contact
        const newContact = { ...contact }

        newContact.assistantId =
            assistantId && objectsMap.assistants[assistantId]
                ? objectsMap.assistants[assistantId].isGlobal
                    ? assistantId
                    : guideId + assistantId
                : ''
        newContact.displayName = proccessExtendedTexts(
            displayName,
            templateId,
            creatorId,
            objectsMap,
            guideId,
            userId,
            userName
        )
        newContact.description = proccessExtendedTexts(
            description,
            templateId,
            creatorId,
            objectsMap,
            guideId,
            userId,
            userName
        )
        newContact.extendedDescription = proccessExtendedTexts(
            extendedDescription,
            templateId,
            creatorId,
            objectsMap,
            guideId,
            userId,
            userName
        )
        newContact.isPublicFor = isPublicFor.includes(FEED_PUBLIC_FOR_ALL) ? [FEED_PUBLIC_FOR_ALL] : [userId]
        newContact.recorderUserId = userId
        newContact.lastEditorId = userId
        newContact.noteId = notesByOldId[noteId] ? notesByOldId[noteId].id : null
        newContact.lastEditionDate = dateNow

        newContacts.push(newContact)
    })
    return newContacts
}

const generateNewAssistants = (creatorId, assistants, dateNow, templateId, guideId, notesByOldId) => {
    const newAssistants = []
    assistants.forEach(assistant => {
        const { noteIdsByProject } = assistant
        const newAssistant = { ...assistant }

        newAssistant.fromTemplate = true
        newAssistant.lastEditorId = creatorId
        newAssistant.lastEditionDate = dateNow
        newAssistant.creatorId = creatorId
        newAssistant.createdDate = dateNow
        newAssistant.lastVisitBoard = {}
        newAssistant.noteIdsByProject = {}
        if (noteIdsByProject[templateId])
            newAssistant.noteIdsByProject[guideId] = notesByOldId[noteIdsByProject[templateId]].id

        newAssistants.push(newAssistant)
    })
    return newAssistants
}

const generateNewAssistantTasks = assistantTasks => {
    const newAssistantTasks = []
    assistantTasks.forEach(tasks => {
        newAssistantTasks.push([])
        tasks.forEach(assistantTask => {
            newAssistantTasks[newAssistantTasks.length - 1].push(assistantTask)
        })
    })
    return newAssistantTasks
}

const generateNewNotes = (
    templateId,
    objectsMap,
    guideId,
    userId,
    notes,
    tasksByOldId,
    goalsByOldId,
    contactsByOldId,
    notesByOldId,
    assistantsByOldId,
    userName,
    userPhotoUrl,
    serverTime,
    dateNow,
    notesLinkedToTemplate
) => {
    const { users, templateCreator } = getGlobalState()

    const newNotes = []
    notes.forEach(templateNote => {
        const {
            extendedTitle,
            preview,
            linkedParentNotesIds,
            linkedParentTasksIds,
            linkedParentContactsIds,
            linkedParentGoalsIds,
            linkedParentAssistantIds,
            linkedParentProjectsIds,
            linkedParentsInTitleIds,
            linkedParentsInContentIds,
            stickyData,
            parentObject,
            isPublicFor,
            assistantId,
        } = templateNote

        const newNote = { ...templateNote }
        const oldNote = notesLinkedToTemplate[templateNote.id]

        const isObjectNote = !!templateNote.parentObject && templateCreator.uid !== parentObject.id
        const followerIds = isObjectNote ? [userId] : users.map(user => user.uid)

        newNote.assistantId =
            assistantId && objectsMap.assistants[assistantId]
                ? objectsMap.assistants[assistantId].isGlobal
                    ? assistantId
                    : guideId + assistantId
                : ''
        newNote.extendedTitle = proccessExtendedTexts(
            extendedTitle,
            templateId,
            templateCreator.uid,
            objectsMap,
            guideId,
            userId,
            userName
        )
        newNote.title = getTaskNameWithoutMeta(newNote.extendedTitle)
        newNote.preview = proccessExtendedTexts(
            preview,
            templateId,
            templateCreator.uid,
            objectsMap,
            guideId,
            userId,
            userName
        )

        newNote.linkedToTemplate = isObjectNote ? false : true
        newNote.lastEditorId = isObjectNote ? userId : templateCreator.uid
        newNote.lastEditionDate = serverTime

        newNote.creatorId = isObjectNote ? userId : templateCreator.uid
        newNote.userId = isObjectNote ? userId : templateCreator.uid
        newNote.isVisibleInFollowedFor = followerIds
        newNote.followersIds = followerIds

        newNote.created = oldNote ? oldNote.created : dateNow
        newNote.views = oldNote ? oldNote.views : 0

        newNote.isPublicFor = isPublicFor.includes(FEED_PUBLIC_FOR_ALL) ? [FEED_PUBLIC_FOR_ALL] : [userId]

        newNote.versionId = CURRENT_DAY_VERSION_ID

        newNote.stickyData = {
            ...stickyData,
            stickyEndDate: stickyData.days > 0 ? moment().add(stickyData.days, 'days').valueOf() : 0,
        }
        newNote.parentObject = isObjectNote
            ? {
                  ...parentObject,
                  id: objectsMap[parentObject.type][parentObject.id].id,
              }
            : null

        updateAllLinkedParentIds(
            newNote,
            {
                linkedParentNotesIds,
                linkedParentTasksIds,
                linkedParentContactsIds,
                linkedParentGoalsIds,
                linkedParentProjectsIds,
                linkedParentAssistantIds,
            },
            { notesByOldId, tasksByOldId, contactsByOldId, goalsByOldId, assistantsByOldId },
            templateId,
            guideId
        )

        newNote.linkedParentsInTitleIds = {
            linkedParentNotesIds: [],
            linkedParentTasksIds: [],
            linkedParentContactsIds: [],
            linkedParentGoalsIds: [],
            linkedParentAssistantIds: [],
            linkedParentProjectsIds: [],
            linkedParentSkillsIds: [],
        }

        updateAllLinkedParentIds(
            newNote.linkedParentsInTitleIds,
            {
                linkedParentNotesIds: linkedParentsInTitleIds.linkedParentNotesIds || [],
                linkedParentTasksIds: linkedParentsInTitleIds.linkedParentTasksIds || [],
                linkedParentContactsIds: linkedParentsInTitleIds.linkedParentContactsIds || [],
                linkedParentGoalsIds: linkedParentsInTitleIds.linkedParentGoalsIds || [],
                linkedParentProjectsIds: linkedParentsInTitleIds.linkedParentProjectsIds || [],
                linkedParentAssistantIds: linkedParentsInTitleIds.linkedParentAssistantIds || [],
            },
            { notesByOldId, tasksByOldId, contactsByOldId, goalsByOldId, assistantsByOldId },
            templateId,
            guideId
        )

        newNote.linkedParentsInContentIds = {
            linkedParentNotesIds: [],
            linkedParentTasksIds: [],
            linkedParentContactsIds: [],
            linkedParentGoalsIds: [],
            linkedParentProjectsIds: [],
            linkedParentSkillsIds: [],
            linkedParentAssistantIds: [],
        }

        updateAllLinkedParentIds(
            newNote.linkedParentsInContentIds,
            {
                linkedParentNotesIds: linkedParentsInContentIds.linkedParentNotesIds || [],
                linkedParentTasksIds: linkedParentsInContentIds.linkedParentTasksIds || [],
                linkedParentContactsIds: linkedParentsInContentIds.linkedParentContactsIds || [],
                linkedParentGoalsIds: linkedParentsInContentIds.linkedParentGoalsIds || [],
                linkedParentProjectsIds: linkedParentsInContentIds.linkedParentProjectsIds || [],
                linkedParentAssistantIds: linkedParentsInContentIds.linkedParentAssistantIds || [],
            },
            { notesByOldId, tasksByOldId, contactsByOldId, goalsByOldId, assistantsByOldId },
            templateId,
            guideId
        )

        newNotes.push(newNote)
    })
    return newNotes
}

const copyContactPhotosAndUpdateUrls = async (appAdmin, contact, templateId, guideId) => {
    const { oldId: templateContactId, id: guideContactId } = contact

    const bucket = appAdmin.storage().bucket()
    const [templatePhotos] = await bucket.getFiles({
        prefix: `projectsContacts/${templateId}/${templateContactId}/`,
    })

    let promises = []
    templatePhotos.forEach((photo, index) => {
        promises.push(photo.copy(`projectsContacts/${guideId}/${guideContactId}/file${index}`))
    })
    const newPhotos = (await Promise.all(promises)).map(item => item[0])

    promises = []
    newPhotos.forEach(photo => promises.push(photo.makePublic()))
    await Promise.all(promises)

    const urlList = []
    newPhotos.forEach(photo => urlList.push(photo.publicUrl()))

    contact.photoURL = urlList[0]
    contact.photoURL300 = urlList[1]
    contact.photoURL50 = urlList[2]
}

const generateNewContactsPhotos = async (appAdmin, newContacts, templateId, guideId) => {
    const promises = []
    newContacts.forEach(contact => {
        const { photoURL, photoURL300, photoURL50 } = contact
        if (photoURL || photoURL300 || photoURL50)
            promises.push(copyContactPhotosAndUpdateUrls(appAdmin, contact, templateId, guideId))
    })
    await Promise.all(promises)
}

const generateNewNotesContent = async (
    appAdmin,
    templateId,
    creatorId,
    guideId,
    userId,
    objectsMap,
    newNotes,
    userName
) => {
    const promises = []
    newNotes.forEach(note => {
        promises.push(
            updateNoteContent(appAdmin, templateId, creatorId, guideId, userId, objectsMap, note.oldId, userName)
        )
    })
    await Promise.all(promises)
}

const updateNoteContent = async (appAdmin, templateId, creatorId, guideId, userId, objectsMap, noteId, userName) => {
    const notesBucketName = defineString('GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET').value()

    const notesBucket = appAdmin.storage().bucket(notesBucketName)

    const noteContentFile = notesBucket.file(`notesData/${templateId}/${noteId}`)
    const [existNote] = await noteContentFile.exists()

    if (existNote) {
        const [noteContentData] = await noteContentFile.download()

        const ydoc = new Y.Doc()
        const update = new Uint8Array(noteContentData)

        if (update.length > 0) {
            Y.applyUpdate(ydoc, noteContentData)
        }

        const type = ydoc.getText('quill')
        const noteOps = type.toDelta()

        noteOps.forEach(op => {
            const {
                mention,
                hashtag,
                email,
                url,
                taskTagFormat,
                attachment,
                customImageFormat,
                videoFormat,
            } = op.insert

            const tagData =
                mention || hashtag || email || url || taskTagFormat || attachment || customImageFormat || videoFormat

            if (tagData) {
                tagData.id = uuidv4()
                tagData.editorId = objectsMap.notes[noteId].id
            }

            if (mention) {
                const { userId: mentionUserId } = mention
                const contact = objectsMap.contacts[mentionUserId]
                if (creatorId === mentionUserId) {
                    mention.userId = userId
                    mention.text = userName.replace(/ /g, MENTION_SPACE_CODE)
                } else if (contact) {
                    mention.userId = contact.id
                    mention.text = contact.displayName.replace(/ /g, MENTION_SPACE_CODE)
                }
            } else if (url) {
                const { url: link } = url
                url.url = replaceIdsInUrl(templateId, creatorId, objectsMap, link, guideId, userId)
            } else if (taskTagFormat) {
                const { taskId, objectUrl } = taskTagFormat
                if (objectUrl)
                    taskTagFormat.objectUrl = replaceIdsInUrl(
                        templateId,
                        creatorId,
                        objectsMap,
                        objectUrl,
                        guideId,
                        userId
                    )
                if (objectsMap.tasks[taskId]) taskTagFormat.taskId = objectsMap.tasks[taskId].id
            }
        })

        const stateUpdate = Y.encodeStateAsUpdate(ydoc)

        const file = notesBucket.file(`notesData/${guideId}/${objectsMap.notes[noteId].id}`)

        await file.save(stateUpdate, { resumable: false })
        ydoc.destroy()
    }
}

const generateNewObjects = (
    templateId,
    creatorId,
    guideId,
    userId,
    userName,
    userPhotoUrl,
    dateMiddleOfDay,
    dateDifference,
    dateNow,
    serverTime,
    objectsMap,
    tasks,
    goals,
    milestones,
    contacts,
    notes,
    notesLinkedToTemplate,
    assistants,
    assistantTasks,
    unlockedTemplate
) => {
    const {
        tasks: tasksByOldId,
        goals: goalsByOldId,
        milestones: milestonesByOldId,
        contacts: contactsByOldId,
        notes: notesByOldId,
        assistants: assistantsByOldId,
        assistantTasks: assistantTasksByOldId,
    } = objectsMap

    const newTasks = generateNewTasks(
        templateId,
        creatorId,
        objectsMap,
        guideId,
        userId,
        tasks,
        tasksByOldId,
        goalsByOldId,
        contactsByOldId,
        notesByOldId,
        assistantsByOldId,
        dateDifference,
        dateNow,
        userName,
        unlockedTemplate
    )

    const newGoals = generateNewGoals(
        templateId,
        creatorId,
        objectsMap,
        guideId,
        userId,
        goals,
        notesByOldId,
        dateDifference,
        dateNow,
        userName,
        milestonesByOldId,
        unlockedTemplate
    )

    const newMilestones = generateNewMilestones(
        templateId,
        creatorId,
        objectsMap,
        guideId,
        userId,
        milestones,
        dateMiddleOfDay,
        dateDifference,
        dateNow,
        userName
    )

    const newContacts = generateNewContacts(
        templateId,
        creatorId,
        objectsMap,
        guideId,
        userId,
        contacts,
        notesByOldId,
        dateNow,
        userName
    )

    const newAssistants = generateNewAssistants(creatorId, assistants, dateNow, templateId, guideId, notesByOldId)

    const newAssistantTasks = generateNewAssistantTasks(assistantTasks)

    const newNotes = generateNewNotes(
        templateId,
        objectsMap,
        guideId,
        userId,
        notes,
        tasksByOldId,
        goalsByOldId,
        contactsByOldId,
        notesByOldId,
        assistantsByOldId,
        userName,
        userPhotoUrl,
        serverTime,
        dateNow,
        notesLinkedToTemplate
    )

    return { newTasks, newGoals, newMilestones, newContacts, newNotes, newAssistants, newAssistantTasks }
}

const copyDataFromTemplateToGuide = async (
    admin,
    appAdmin,
    templateId,
    creatorId,
    guideId,
    userId,
    userName,
    userPhotoUrl,
    dateMiddleOfDay,
    dateNow,
    unlockedTemplate,
    isNewGuide,
    globalAssistantIds
) => {
    const dateServerMiddleOfDay = moment().startOf('day').hour(12).minute(0).valueOf()
    const dateDifference = dateMiddleOfDay - dateServerMiddleOfDay

    let promises = []
    promises.push(getTemplateObjects(appAdmin, templateId, creatorId, isNewGuide, globalAssistantIds))
    promises.push(getFirebaseTimestampDirectly(admin, appAdmin))
    promises.push(getNotesLinkedToTemplate(appAdmin, guideId))
    promises.push(loadGlobalData(admin, appAdmin, guideId, userId, creatorId))

    const results = await Promise.all(promises)
    const { tasks, milestones, goals, allNotes, contacts, assistants, assistantTasks, globalAssistants } = results[0]

    const serverTime = results[1]
    const notesLinkedToTemplate = results[2]

    const userBoughtGuide = true
    if (!unlockedTemplate && userBoughtGuide) unlockedTemplate = true

    const tasksByOldId = getItemsByOldIdsAndAddNewId(tasks, guideId, false, false)
    const milestonesByOldId = getItemsByOldIdsAndAddNewId(milestones, guideId, false, false)
    const goalsByOldId = getItemsByOldIdsAndAddNewId(goals, guideId, false, false)
    const contactsByOldId = getItemsByOldIdsAndAddNewId(contacts, guideId, true, false)

    const assistantsByOldId = getItemsByOldIdsAndAddNewId(assistants, guideId, true, true)
    globalAssistantIds.forEach(globalAssistantId => {
        assistantsByOldId[globalAssistantId] = { id: globalAssistantId, isGlobal: true }
    })

    const notes = selectFollowedNotesAndObjectNotes(
        creatorId,
        allNotes,
        tasksByOldId,
        goalsByOldId,
        contactsByOldId,
        assistantsByOldId
    )
    const notesByOldId = getItemsByOldIdsAndAddNewId(notes, guideId, false, true)

    const assistantTasksByOldId = []
    assistantTasks.forEach(tasks => {
        assistantTasksByOldId.push(getItemsByOldIdsAndAddNewId(tasks, guideId, false, true))
    })

    const objectsMap = {
        tasks: tasksByOldId,
        milestones: milestonesByOldId,
        goals: goalsByOldId,
        notes: notesByOldId,
        contacts: contactsByOldId,
        assistants: assistantsByOldId,
        assistantTasks: assistantTasksByOldId,
    }

    const {
        newTasks,
        newGoals,
        newMilestones,
        newContacts,
        newNotes,
        newAssistants,
        newAssistantTasks,
    } = generateNewObjects(
        templateId,
        creatorId,
        guideId,
        userId,
        userName,
        userPhotoUrl,
        dateMiddleOfDay,
        dateDifference,
        dateNow,
        serverTime,
        objectsMap,
        tasks,
        goals,
        milestones,
        contacts,
        notes,
        notesLinkedToTemplate,
        isNewGuide ? assistants : [],
        assistantTasks,
        unlockedTemplate
    )

    promises = []
    promises.push(
        generateNewNotesContent(appAdmin, templateId, creatorId, guideId, userId, objectsMap, newNotes, userName)
    )
    promises.push(generateNewContactsPhotos(appAdmin, newContacts, templateId, guideId))
    promises.push(copyHashtags(appAdmin, templateId, guideId))
    await Promise.all(promises)

    if (!unlockedTemplate && newGoals.length > 0) {
        await addUnlockedKeyToCreator(appAdmin, guideId, userId, newGoals[0].lockKey)
    }

    promises = []
    newTasks.forEach(task => {
        delete task.oldId
        promises.push(uploadTask(appAdmin, guideId, task))
    })
    await Promise.all(promises)

    promises = []
    newMilestones.forEach(milestone => {
        promises.push(uploadMilestone(appAdmin, guideId, milestone))
    })
    await Promise.all(promises)

    promises = []
    newGoals.forEach(goal => {
        delete goal.oldId
        delete goal.globalSortIndex
        promises.push(uploadNewGoal(guideId, goal))
    })
    await Promise.all(promises)

    promises = []
    newContacts.forEach(contact => {
        delete contact.id
        delete contact.oldId
        promises.push(uploadNewContact(guideId, contact))
    })
    await Promise.all(promises)

    promises = []
    newAssistants.forEach(assistant => {
        delete assistant.oldId
        delete assistant.globalSortIndex
        delete assistant.id
        promises.push(uploadNewAssistant(appAdmin, guideId, assistant, true))
    })
    globalAssistants.forEach(assistant => {
        if (assistant.noteIdsByProject[templateId]) {
            promises.push(
                updateAssistantData(appAdmin, GLOBAL_PROJECT_ID, assistant.uid, {
                    [`noteIdsByProject.${guideId}`]: notesByOldId[assistant.noteIdsByProject[templateId]].id,
                })
            )
        }
    })
    await Promise.all(promises)

    promises = []
    newAssistantTasks.forEach((tasks, index) => {
        const assistantId = newAssistants[index].uid
        tasks.forEach(assistantTask => {
            promises.push(uploadAssistantTask(appAdmin, guideId, assistantId, assistantTask))
        })
    })
    await Promise.all(promises)

    promises = []
    newNotes.forEach(note => {
        promises.push(uploadNote(guideId, note, notesLinkedToTemplate[note.id]))
    })
    await Promise.all(promises)

    await cleanGlobalFeeds(guideId)
}

module.exports = { copyDataFromTemplateToGuide }
