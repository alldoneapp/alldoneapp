const { deleteSubTaskFromParent } = require('../Tasks/onDeleteTaskFunctions')
const {
    recursiveDeleteHelper,
    CAPACITY_NONE,
    DONE_STEP,
    OPEN_STEP,
    generateSortIndex,
} = require('../Utils/HelperFunctionsCloud')

const processChats = async (projectId, userId, admin, superAdmin) => {
    const chatsRef = admin.firestore().collection(`chatObjects/${projectId}/chats`)
    let promises = []
    promises.push(chatsRef.where('creatorId', '==', userId).get())
    promises.push(chatsRef.where('creatorId', '!=', userId).where('isPublicFor', 'array-contains-any', [userId]).get())
    promises.push(chatsRef.where('creatorId', '!=', userId).where('lastEditorId', '==', userId).get())
    promises.push(chatsRef.where('creatorId', '!=', userId).where('members', 'array-contains-any', [userId]).get())
    promises.push(
        chatsRef.where('creatorId', '!=', userId).where('usersFollowing', 'array-contains-any', [userId]).get()
    )
    promises.push(
        chatsRef.where('creatorId', '!=', userId).where('commentsData.lastCommentOwnerId', '==', userId).get()
    )
    const [
        chatDocsToDelete,
        chatDocsToUpdatePrivacy,
        chatDocsToUpdateEdition,
        chatDocsToUpdateMembers,
        chatDocsToUpdateUsersFollowing,
        chatDocsToUpdateLastCommentOwnerId,
    ] = await Promise.all(promises)

    promises = []
    chatDocsToDelete.forEach(doc => {
        promises.push(admin.firestore().doc(`chatObjects/${projectId}/chats/${doc.id}`).delete())
    })
    chatDocsToUpdatePrivacy.forEach(doc => {
        const { isPublicFor, creatorId } = doc.data()
        const chatRef = admin.firestore().doc(`chatObjects/${projectId}/chats/${doc.id}`)
        promises.push(chatRef.update({ isPublicFor: superAdmin.firestore.FieldValue.arrayRemove(userId) }))
        if (isPublicFor.length === 1) {
            promises.push(chatRef.update({ isPublicFor: superAdmin.firestore.FieldValue.arrayUnion(creatorId) }))
        }
    })
    chatDocsToUpdateEdition.forEach(doc => {
        const chatRef = admin.firestore().doc(`chatObjects/${projectId}/chats/${doc.id}`)
        promises.push(chatRef.update({ lastEditorId: '' }))
    })
    chatDocsToUpdateMembers.forEach(doc => {
        const chatRef = admin.firestore().doc(`chatObjects/${projectId}/chats/${doc.id}`)
        promises.push(chatRef.update({ members: superAdmin.firestore.FieldValue.arrayRemove(userId) }))
    })
    chatDocsToUpdateUsersFollowing.forEach(doc => {
        const chatRef = admin.firestore().doc(`chatObjects/${projectId}/chats/${doc.id}`)
        promises.push(chatRef.update({ usersFollowing: superAdmin.firestore.FieldValue.arrayRemove(userId) }))
    })
    chatDocsToUpdateLastCommentOwnerId.forEach(doc => {
        const chatRef = admin.firestore().doc(`chatObjects/${projectId}/chats/${doc.id}`)
        promises.push(chatRef.update({ ['commentsData.lastCommentOwnerId']: '' }))
    })
    await Promise.all(promises)
}

const processGoals = async (projectId, userId, admin, superAdmin) => {
    const goalsRef = admin.firestore().collection(`goals/${projectId}/items`)
    let promises = []
    promises.push(goalsRef.where('creatorId', '==', userId).get())
    promises.push(goalsRef.where('creatorId', '!=', userId).where('assigneesIds', 'array-contains-any', [userId]).get())
    promises.push(goalsRef.where('creatorId', '!=', userId).where('isPublicFor', 'array-contains-any', [userId]).get())
    promises.push(goalsRef.where('creatorId', '!=', userId).where('lastEditorId', '==', userId).get())
    const [
        goalDocsToDelete,
        goalDocsToUpdateAssignee,
        goalDocsToUpdatePrivacy,
        goalDocsToUpdateEdition,
    ] = await Promise.all(promises)

    promises = []
    goalDocsToDelete.forEach(doc => {
        promises.push(admin.firestore().doc(`goals/${projectId}/items/${doc.id}`).delete())
    })
    goalDocsToUpdateAssignee.forEach(doc => {
        const { assigneesIds, creatorId } = doc.data()
        const goalRef = admin.firestore().doc(`goals/${projectId}/items/${doc.id}`)
        promises.push(
            goalRef.update({
                assigneesIds: superAdmin.firestore.FieldValue.arrayRemove(userId),
                [`assigneesCapacity.${userId}`]: superAdmin.firestore.FieldValue.delete(),
                [`assigneesReminderDate.${userId}`]: superAdmin.firestore.FieldValue.delete(),
            })
        )
        if (assigneesIds.length === 1) {
            promises.push(
                goalRef.update({
                    assigneesIds: superAdmin.firestore.FieldValue.arrayUnion(creatorId),
                    [`assigneesCapacity.${creatorId}`]: CAPACITY_NONE,
                    [`assigneesReminderDate.${creatorId}`]: Date.now(),
                    isPublicFor: superAdmin.firestore.FieldValue.arrayUnion(creatorId),
                })
            )
        }
    })
    goalDocsToUpdatePrivacy.forEach(doc => {
        const { isPublicFor, creatorId } = doc.data()
        const goalRef = admin.firestore().doc(`goals/${projectId}/items/${doc.id}`)
        promises.push(
            goalRef.update({
                isPublicFor: superAdmin.firestore.FieldValue.arrayRemove(userId),
            })
        )
        if (isPublicFor.length === 1) {
            promises.push(
                goalRef.update({
                    isPublicFor: superAdmin.firestore.FieldValue.arrayUnion(creatorId),
                })
            )
        }
    })
    goalDocsToUpdateEdition.forEach(doc => {
        promises.push(admin.firestore().doc(`goals/${projectId}/items/${doc.id}`).update({ lastEditorId: '' }))
    })
    await Promise.all(promises)
}

const tryDeleteSubTaskFromParent = async (projectId, userId, subtaskId, parentId, admin) => {
    const parentTask = (await admin.firestore().doc(`items/${projectId}/tasks/${parentId}`).get()).data()
    if (parentTask && parentTask.creatorId !== userId)
        deleteSubTaskFromParent(projectId, parentId, subtaskId, parentTask)
}

const convertSubtasksInNormalTasks = async (projectId, userId, parentId, admin, superAdmin) => {
    const subtaskDocs = await admin
        .firestore()
        .collection(`items/${projectId}/tasks`)
        .where('creatorId', '!=', userId)
        .where('parentId', '==', parentId)
        .get()
    const promises = []
    subtaskDocs.forEach(doc => {
        const { done, parentDone, userId: assigneeId, creatorId, estimations } = doc.data()
        const updateData = {
            parentDone: false,
            parentId: null,
            isSubtask: false,
            inDone: false,
        }
        if (!done || (!parentDone && done)) {
            updateData.isPublicFor = superAdmin.firestore.FieldValue.arrayUnion(creatorId)
            updateData.done = false
            updateData.inDone = false
            updateData.suggestedBy = null
            updateData.estimations = { [OPEN_STEP]: estimations[OPEN_STEP] }
            updateData.stepHistory = [OPEN_STEP]
            updateData.completed = null
            updateData.sortIndex = generateSortIndex()
            if (assigneeId === userId) {
                updateData.userId = creatorId
                updateData.userIds = [creatorId]
                updateData.currentReviewerId = creatorId
            } else {
                updateData.userIds = [assigneeId]
                updateData.currentReviewerId = assigneeId
            }
        }
        promises.push(admin.firestore().doc(`items/${projectId}/tasks/${doc.id}`).update(updateData))
    })
    await Promise.all(promises)
}

const processTaskToDelete = async (projectId, userId, task, admin, superAdmin) => {
    const { subtaskIds, parentId } = task
    const promises = []
    if (parentId) promises.push(tryDeleteSubTaskFromParent(projectId, userId, task.id, parentId, admin))
    if (subtaskIds && subtaskIds.length > 0) {
        await admin.firestore().doc(`items/${projectId}/tasks/${task.id}`).update({ subtaskIds: [] })
        promises.push(convertSubtasksInNormalTasks(projectId, userId, task.id, admin, superAdmin))
    }
    promises.push(admin.firestore().doc(`items/${projectId}/tasks/${task.id}`).delete())
    await Promise.all(promises)
}

const updateTasksInFocusSortIndex = async (projectId, admin) => {
    const userDocs = await admin.firestore().collection(`users`).where('inFocusTaskProjectId', '==', projectId).get()

    let promises = []
    userDocs.forEach(doc => {
        const { inFocusTaskId } = doc.data()
        promises.push(admin.firestore().doc(`items/${projectId}/tasks/${inFocusTaskId}`).get())
    })
    const taskDocs = await Promise.all(promises)

    promises = []
    taskDocs.forEach(doc => {
        const task = doc.data()
        if (task) {
            const { sortIndex } = task
            const newSortIndex = generateSortIndex()
            if (newSortIndex > sortIndex) {
                promises.push(
                    admin.firestore().doc(`items/${projectId}/tasks/${doc.id}`).update({ sortIndex: newSortIndex })
                )
            }
        }
    })
    await Promise.all(promises)
}

const processTasks = async (projectId, userId, admin, superAdmin) => {
    const taskRef = admin.firestore().collection(`items/${projectId}/tasks`)
    let promises = []
    promises.push(taskRef.where('creatorId', '==', userId).get())
    promises.push(taskRef.where('creatorId', '!=', userId).where('userIds', 'array-contains-any', [userId]).get())
    promises.push(taskRef.where('creatorId', '!=', userId).where('observersIds', 'array-contains-any', [userId]).get())
    promises.push(taskRef.where('creatorId', '!=', userId).where('isPublicFor', 'array-contains-any', [userId]).get())
    promises.push(taskRef.where('creatorId', '!=', userId).where('suggestedBy', '==', userId).get())
    promises.push(
        taskRef.where('creatorId', '!=', userId).where('linkedParentContactsIds', 'array-contains-any', [userId]).get()
    )
    const [
        taskDocsToDelete,
        taskDocsToUpdateAssigneeAndWorkflowData,
        taskDocsToUpdateObservers,
        taskDocsToUpdatePrivacy,
        taskDocsToUpdateSuggestion,
        taskDocsToUpdateBacklinks,
    ] = await Promise.all(promises)

    promises = []
    taskDocsToDelete.forEach(doc => {
        promises.push(processTaskToDelete(projectId, userId, { ...doc.data(), id: doc.id }, admin, superAdmin))
    })
    await Promise.all(promises)

    promises = []
    taskDocsToUpdateAssigneeAndWorkflowData.forEach(doc => {
        const {
            creatorId,
            done,
            userIds,
            isSubtask,
            completed,
            parentDone,
            userId: assigneeId,
            estimations,
            stepHistory,
        } = doc.data()
        const taskRef = admin.firestore().doc(`items/${projectId}/tasks/${doc.id}`)
        const isDone = (isSubtask && parentDone) || (!isSubtask && done)
        if (assigneeId === userId) {
            promises.push(
                taskRef.update({
                    userId: creatorId,
                    userIds: [creatorId],
                    stepHistory: [OPEN_STEP],
                    currentReviewerId: isDone ? DONE_STEP : creatorId,
                    estimations: { [OPEN_STEP]: estimations[OPEN_STEP] },
                    completed: isDone ? completed : null,
                    inDone: isDone,
                    isPublicFor: superAdmin.firestore.FieldValue.arrayUnion(creatorId),
                    sortIndex: generateSortIndex(),
                })
            )
        } else {
            const workflowStepIds = []
            userIds.forEach((uid, index) => {
                if (uid === userId) workflowStepIds.push(stepHistory[index])
            })
            const newUserIds = userIds.filter(uid => uid !== userId)
            const updateData = {
                userIds: superAdmin.firestore.FieldValue.arrayRemove(userId),
                stepHistory: superAdmin.firestore.FieldValue.arrayRemove(...workflowStepIds),
                currentReviewerId: isDone ? DONE_STEP : newUserIds[newUserIds.length - 1],
                completed: isDone || newUserIds.length > 1 ? completed : null,
                inDone: isDone,
                sortIndex: generateSortIndex(),
            }
            workflowStepIds.forEach(stepId => {
                updateData[`estimations.${stepId}`] = superAdmin.firestore.FieldValue.delete()
            })
            promises.push(taskRef.update(updateData))
        }
    })
    taskDocsToUpdateObservers.forEach(doc => {
        const taskRef = admin.firestore().doc(`items/${projectId}/tasks/${doc.id}`)
        promises.push(
            taskRef.update({
                observersIds: superAdmin.firestore.FieldValue.arrayRemove(userId),
                [`dueDateByObserversIds.${userId}`]: superAdmin.firestore.FieldValue.delete(),
                [`estimationsByObserverIds.${userId}`]: superAdmin.firestore.FieldValue.delete(),
            })
        )
    })
    taskDocsToUpdatePrivacy.forEach(doc => {
        const { isPublicFor, creatorId } = doc.data()
        const taskRef = admin.firestore().doc(`items/${projectId}/tasks/${doc.id}`)
        promises.push(
            taskRef.update({
                isPublicFor: superAdmin.firestore.FieldValue.arrayRemove(userId),
            })
        )
        if (isPublicFor.length === 1) {
            promises.push(
                taskRef.update({
                    isPublicFor: superAdmin.firestore.FieldValue.arrayUnion(creatorId),
                })
            )
        }
    })
    taskDocsToUpdateSuggestion.forEach(doc => {
        const taskRef = admin.firestore().doc(`items/${projectId}/tasks/${doc.id}`)
        promises.push(taskRef.update({ suggestedBy: null }))
    })
    taskDocsToUpdateBacklinks.forEach(doc => {
        const taskRef = admin.firestore().doc(`items/${projectId}/tasks/${doc.id}`)
        promises.push(
            taskRef.update({
                linkedParentContactsIds: superAdmin.firestore.FieldValue.arrayRemove(userId),
            })
        )
    })
    await Promise.all(promises)

    await updateTasksInFocusSortIndex(projectId, admin)
}

const processNotes = async (projectId, userId, admin, superAdmin) => {
    const noteRef = admin.firestore().collection(`noteItems/${projectId}/notes`)
    let promises = []
    promises.push(noteRef.where('creatorId', '==', userId).where('parentObject', '==', null).get())
    promises.push(noteRef.where('creatorId', '!=', userId).where('isPublicFor', 'array-contains-any', [userId]).get())
    promises.push(noteRef.where('creatorId', '!=', userId).where('userId', '==', userId).get())
    promises.push(noteRef.where('creatorId', '!=', userId).where('lastEditorId', '==', userId).get())
    promises.push(noteRef.where('creatorId', '!=', userId).where('followersIds', 'array-contains-any', [userId]).get())
    promises.push(
        noteRef.where('creatorId', '!=', userId).where('linkedParentContactsIds', 'array-contains-any', [userId]).get()
    )
    promises.push(
        noteRef
            .where('creatorId', '!=', userId)
            .where('linkedParentsInContentIds.linkedParentContactsIds', 'array-contains-any', [userId])
            .get()
    )
    promises.push(
        noteRef
            .where('creatorId', '!=', userId)
            .where('linkedParentsInTitleIds.linkedParentContactsIds', 'array-contains-any', [userId])
            .get()
    )
    const [
        noteDocsToDelete,
        noteDocsToUpdatePrivacy,
        noteDocsToUpdateOwner,
        noteDocsToUpdateEdition,
        noteDocsToUpdateFollowers,
        noteDocsToUpdateBacklinks,
        noteDocsToUpdateContentBacklinks,
        noteDocsToUpdateTitleBacklinks,
    ] = await Promise.all(promises)

    promises = []
    noteDocsToDelete.forEach(doc => {
        promises.push(admin.firestore().doc(`noteItems/${projectId}/notes/${doc.id}`).delete())
    })
    noteDocsToUpdatePrivacy.forEach(doc => {
        const { isPublicFor, creatorId } = doc.data()
        const noteRef = admin.firestore().doc(`noteItems/${projectId}/notes/${doc.id}`)
        promises.push(
            noteRef.update({
                isPublicFor: superAdmin.firestore.FieldValue.arrayRemove(userId),
            })
        )
        if (isPublicFor.length === 1) {
            promises.push(
                noteRef.update({
                    isPublicFor: superAdmin.firestore.FieldValue.arrayUnion(creatorId),
                })
            )
        }
    })
    noteDocsToUpdateOwner.forEach(doc => {
        const { creatorId } = doc.data()
        const noteRef = admin.firestore().doc(`noteItems/${projectId}/notes/${doc.id}`)
        promises.push(
            noteRef.update({
                userId: creatorId,
                isPublicFor: superAdmin.firestore.FieldValue.arrayUnion(creatorId),
                followersIds: superAdmin.firestore.FieldValue.arrayUnion(creatorId),
                isVisibleInFollowedFor: superAdmin.firestore.FieldValue.arrayUnion(creatorId),
            })
        )
    })
    noteDocsToUpdateEdition.forEach(doc => {
        const noteRef = admin.firestore().doc(`noteItems/${projectId}/notes/${doc.id}`)
        promises.push(noteRef.update({ lastEditorId: '' }))
    })
    noteDocsToUpdateFollowers.forEach(doc => {
        const noteRef = admin.firestore().doc(`noteItems/${projectId}/notes/${doc.id}`)
        promises.push(
            noteRef.update({
                followersIds: superAdmin.firestore.FieldValue.arrayRemove(userId),
                isVisibleInFollowedFor: superAdmin.firestore.FieldValue.arrayRemove(userId),
            })
        )
    })
    noteDocsToUpdateBacklinks.forEach(doc => {
        const noteRef = admin.firestore().doc(`noteItems/${projectId}/notes/${doc.id}`)
        promises.push(
            noteRef.update({
                linkedParentContactsIds: superAdmin.firestore.FieldValue.arrayRemove(userId),
            })
        )
    })
    noteDocsToUpdateContentBacklinks.forEach(doc => {
        const noteRef = admin.firestore().doc(`noteItems/${projectId}/notes/${doc.id}`)
        promises.push(
            noteRef.update({
                ['linkedParentsInContentIds.linkedParentContactsIds']: superAdmin.firestore.FieldValue.arrayRemove(
                    userId
                ),
            })
        )
    })
    noteDocsToUpdateTitleBacklinks.forEach(doc => {
        const noteRef = admin.firestore().doc(`noteItems/${projectId}/notes/${doc.id}`)
        promises.push(
            noteRef.update({
                ['linkedParentsInTitleIds.linkedParentContactsIds']: superAdmin.firestore.FieldValue.arrayRemove(
                    userId
                ),
            })
        )
    })
    await Promise.all(promises)
}

const processUsers = async (projectId, userId, admin, superAdmin) => {
    const usersRef = admin.firestore().collection(`users`)
    let promises = []
    promises.push(usersRef.where(`lastVisitBoard.${projectId}.${userId}`, '>=', 0).get())
    promises.push(usersRef.where(`lastVisitBoardInGoals.${projectId}.${userId}`, '>=', 0).get())
    promises.push(usersRef.where(`statisticsSelectedUsersIds.${projectId}`, 'array-contains-any', [userId]).get())
    const [
        userDocsToUpdateLastVisitBoard,
        userDocsToUpdateLastVisitBoardInGoals,
        userDocsToUpdatestatisticsSelectedUsersIds,
    ] = await Promise.all(promises)

    promises = []
    userDocsToUpdateLastVisitBoard.forEach(doc => {
        const userRef = admin.firestore().doc(`users/${doc.id}`)
        promises.push(
            userRef.update({ [`lastVisitBoard.${projectId}.${userId}`]: superAdmin.firestore.FieldValue.delete() })
        )
    })
    userDocsToUpdateLastVisitBoardInGoals.forEach(doc => {
        const userRef = admin.firestore().doc(`users/${doc.id}`)
        promises.push(
            userRef.update({
                [`lastVisitBoardInGoals.${projectId}.${userId}`]: superAdmin.firestore.FieldValue.delete(),
            })
        )
    })
    userDocsToUpdatestatisticsSelectedUsersIds.forEach(doc => {
        const userRef = admin.firestore().doc(`users/${doc.id}`)
        promises.push(
            userRef.update({
                [`statisticsSelectedUsersIds.${projectId}`]: superAdmin.firestore.FieldValue.arrayRemove(userId),
            })
        )
    })
    await Promise.all(promises)
}

const processContacts = async (projectId, userId, admin, superAdmin) => {
    const contactRef = admin.firestore().collection(`projectsContacts/${projectId}/contacts`)
    let promises = []
    promises.push(contactRef.where('recorderUserId', '==', userId).get())
    promises.push(contactRef.where(`lastVisitBoard.${projectId}.${userId}`, '>=', 0).get())
    promises.push(contactRef.where(`lastVisitBoardInGoals.${projectId}.${userId}`, '>=', 0).get())
    promises.push(
        contactRef.where('recorderUserId', '!=', userId).where('isPublicFor', 'array-contains-any', [userId]).get()
    )
    promises.push(contactRef.where('recorderUserId', '!=', userId).where('lastEditorId', '==', userId).get())
    const [
        contactDocsToDelete,
        contactsDocsToUpdateLastVisitBoard,
        contactsDocsToUpdateLastVisitBoardInGoals,
        contactDocsToUpdatePrivacy,
        contactDocsToUpdateEdition,
    ] = await Promise.all(promises)

    promises = []
    contactDocsToDelete.forEach(doc => {
        promises.push(admin.firestore().doc(`projectsContacts/${projectId}/contacts/${doc.id}`).delete())
    })
    contactsDocsToUpdateLastVisitBoard.forEach(doc => {
        if (doc.data().recorderUserId !== userId) {
            const contactRef = admin.firestore().doc(`projectsContacts/${projectId}/contacts/${doc.id}`)
            promises.push(
                contactRef.update({
                    [`lastVisitBoard.${projectId}.${userId}`]: superAdmin.firestore.FieldValue.delete(),
                })
            )
        }
    })
    contactsDocsToUpdateLastVisitBoardInGoals.forEach(doc => {
        if (doc.data().recorderUserId !== userId) {
            const contactRef = admin.firestore().doc(`projectsContacts/${projectId}/contacts/${doc.id}`)
            promises.push(
                contactRef.update({
                    [`lastVisitBoardInGoals.${projectId}.${userId}`]: superAdmin.firestore.FieldValue.delete(),
                })
            )
        }
    })
    contactDocsToUpdatePrivacy.forEach(doc => {
        const { isPublicFor, recorderUserId } = doc.data()
        const contactRef = admin.firestore().doc(`projectsContacts/${projectId}/contacts/${doc.id}`)
        promises.push(
            contactRef.update({
                isPublicFor: superAdmin.firestore.FieldValue.arrayRemove(userId),
            })
        )
        if (isPublicFor.length === 1) {
            promises.push(
                contactRef.update({
                    isPublicFor: superAdmin.firestore.FieldValue.arrayUnion(recorderUserId),
                })
            )
        }
    })
    contactDocsToUpdateEdition.forEach(doc => {
        const { recorderUserId } = doc.data()
        const contactRef = admin.firestore().doc(`projectsContacts/${projectId}/contacts/${doc.id}`)
        promises.push(contactRef.update({ lastEditorId: recorderUserId }))
    })
    await Promise.all(promises)
}

const processWorkstreams = async (projectId, userId, admin, superAdmin) => {
    const workstreamRef = admin.firestore().collection(`projectsWorkstreams/${projectId}/workstreams`)
    let promises = []
    promises.push(workstreamRef.where('creatorId', '==', userId).get())
    promises.push(workstreamRef.where(`lastVisitBoard.${projectId}.${userId}`, '>=', 0).get())
    promises.push(workstreamRef.where(`lastVisitBoardInGoals.${projectId}.${userId}`, '>=', 0).get())
    const [
        workstreamDocsToChangeCreator,
        workstreamDocsToUpdateLastVisitBoard,
        workstreamDocsToUpdateLastVisitBoardInGoals,
    ] = await Promise.all(promises)

    promises = []
    workstreamDocsToChangeCreator.forEach(doc => {
        const contactRef = admin.firestore().doc(`projectsWorkstreams/${projectId}/workstreams/${doc.id}`)
        promises.push(contactRef.update({ creatorId: '' }))
    })
    workstreamDocsToUpdateLastVisitBoard.forEach(doc => {
        const contactRef = admin.firestore().doc(`projectsWorkstreams/${projectId}/workstreams/${doc.id}`)
        promises.push(
            contactRef.update({ [`lastVisitBoard.${projectId}.${userId}`]: superAdmin.firestore.FieldValue.delete() })
        )
    })
    workstreamDocsToUpdateLastVisitBoardInGoals.forEach(doc => {
        const contactRef = admin.firestore().doc(`projectsWorkstreams/${projectId}/workstreams/${doc.id}`)
        promises.push(
            contactRef.update({
                [`lastVisitBoardInGoals.${projectId}.${userId}`]: superAdmin.firestore.FieldValue.delete(),
            })
        )
    })
    await Promise.all(promises)
}

const processSkills = async (projectId, userId, admin, superAdmin) => {
    const skillRef = admin.firestore().collection(`skills/${projectId}/items`)
    let promises = []
    promises.push(skillRef.where('userId', '==', userId).get())
    promises.push(skillRef.where('userId', '!=', userId).where('isPublicFor', 'array-contains-any', [userId]).get())
    promises.push(skillRef.where('userId', '!=', userId).where('lastEditorId', '==', userId).get())
    const [skillDocsToDelete, skillDocsToUpdatePrivacy, skillDocsToUpdateEdition] = await Promise.all(promises)

    promises = []
    skillDocsToDelete.forEach(doc => {
        promises.push(admin.firestore().doc(`skills/${projectId}/items/${doc.id}`).delete())
    })
    skillDocsToUpdatePrivacy.forEach(doc => {
        const { isPublicFor, userId } = doc.data()
        const skillRef = admin.firestore().doc(`skills/${projectId}/items/${doc.id}`)
        promises.push(
            skillRef.update({
                isPublicFor: superAdmin.firestore.FieldValue.arrayRemove(userId),
            })
        )
        if (isPublicFor.length === 1) {
            promises.push(
                skillRef.update({
                    isPublicFor: superAdmin.firestore.FieldValue.arrayUnion(userId),
                })
            )
        }
    })
    skillDocsToUpdateEdition.forEach(doc => {
        const contactRef = admin.firestore().doc(`skills/${projectId}/items/${doc.id}`)
        promises.push(contactRef.update({ lastEditorId: '' }))
    })
    await Promise.all(promises)
}

const processSkillsDefaultPrivacy = async (projectId, userId, admin, superAdmin) => {
    const docsToUpdatePrivacy = await admin
        .firestore()
        .collection(`skillsDefaultPrivacy/${projectId}/items`)
        .where('isPublicFor', 'array-contains-any', [userId])
        .get()
    const promises = []
    promises.push(admin.firestore().doc(`skillsDefaultPrivacy/${projectId}/items/${userId}`).delete())
    docsToUpdatePrivacy.forEach(doc => {
        if (doc.id !== userId)
            promises.push(
                admin
                    .firestore()
                    .doc(`skillsDefaultPrivacy/${projectId}/items/${doc.id}`)
                    .update({
                        isPublicFor: superAdmin.firestore.FieldValue.arrayRemove(userId),
                    })
            )
    })
    await Promise.all(promises)
}

const processAssistants = async (projectId, userId, admin) => {
    const assistantRef = admin.firestore().collection(`assistants/${projectId}/items`)
    let promises = []
    promises.push(assistantRef.where('creatorId', '==', userId).get())
    promises.push(assistantRef.where('creatorId', '!=', userId).where('lastEditorId', '==', userId).get())
    const [assistantDocsToDelete, assistantDocsToUpdateEdition] = await Promise.all(promises)

    promises = []
    assistantDocsToDelete.forEach(doc => {
        promises.push(admin.firestore().doc(`assistants/${projectId}/items/${doc.id}`).delete())
    })
    assistantDocsToUpdateEdition.forEach(doc => {
        promises.push(admin.firestore().doc(`assistants/${projectId}/items/${doc.id}`).update({ lastEditorId: '' }))
    })
    await Promise.all(promises)
}

const processKarma = async (projectId, userId, admin, superAdmin) => {
    const karmaData = (await admin.firestore().doc(`karmaPoints/${userId}`).get()).data()
    if (karmaData) {
        await admin
            .firestore()
            .doc(`karmaPoints/${userId}`)
            .update({ [`projectsKarma.${projectId}`]: superAdmin.firestore.FieldValue.delete() })
    }
}

const processProjectInvitations = async (projectId, userId, admin) => {
    const docsToUpdate = await admin
        .firestore()
        .collection(`projectsInvitation/${projectId}/invitations`)
        .where('inviterId', '==', userId)
        .get()

    promises = []
    docsToUpdate.forEach(doc => {
        promises.push(
            admin.firestore().doc(`projectsInvitation/${projectId}/invitations/${doc.id}`).update({ inviterId: '' })
        )
    })
    await Promise.all(promises)
}

const removeUserDataFromProject = async (projectId, userId, admin, firebase_tools, process, superAdmin) => {
    const { GCLOUD_PROJECT } = process.env

    const promises = []
    promises.push(processChats(projectId, userId, admin, superAdmin))
    promises.push(processGoals(projectId, userId, admin, superAdmin))
    promises.push(processTasks(projectId, userId, admin, superAdmin))
    promises.push(processNotes(projectId, userId, admin, superAdmin))
    promises.push(processContacts(projectId, userId, admin, superAdmin))
    promises.push(processSkills(projectId, userId, admin, superAdmin))
    promises.push(processWorkstreams(projectId, userId, admin, superAdmin))
    promises.push(processUsers(projectId, userId, admin, superAdmin))
    promises.push(processAssistants(projectId, userId, admin))

    promises.push(processSkillsDefaultPrivacy(projectId, userId, admin, superAdmin))
    promises.push(processKarma(projectId, userId, admin, superAdmin))
    promises.push(processProjectInvitations(projectId, userId, admin))

    promises.push(recursiveDeleteHelper(firebase_tools, GCLOUD_PROJECT, `statistics/${projectId}/${userId}`))
    promises.push(recursiveDeleteHelper(firebase_tools, GCLOUD_PROJECT, `feedsCount/${projectId}/${userId}`))
    promises.push(recursiveDeleteHelper(firebase_tools, GCLOUD_PROJECT, `invoiceData/${projectId}/${userId}`))
    promises.push(recursiveDeleteHelper(firebase_tools, GCLOUD_PROJECT, `chatNotifications/${projectId}/${userId}`))

    await Promise.all(promises)
}

module.exports = { removeUserDataFromProject }
