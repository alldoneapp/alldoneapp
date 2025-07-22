const { FEED_PUBLIC_FOR_ALL, promiseAllAndCatch } = require('./HelperFunctions')
const { addFollower, FOLLOW_TYPE_TASKS } = require('./FollowObjectHelper')

const copyTasks = async (firebase, projectId, newProjectId, user, originTasks, includeGoals, includeNotes) => {
    const db = firebase.firestore()
    let arrayPromises = []
    let promiseIndex = 0
    const taskAmountsByGoals = includeGoals ? {} : null
    const objectNotes = []

    originTasks.forEach(task => {
        const taskData = task.data()

        if (taskData.calendarData == null) {
            registerAmountOfTaskByGoal(includeGoals, taskData, taskAmountsByGoals, taskData.parentGoalId, user.uid)

            if (taskData.noteId != null) objectNotes.push(taskData.noteId)

            const newTaskRef = db.doc(`/items/${newProjectId}/tasks/${task.id}`)
            const newTaskData = {
                ...taskData,
                isPrivate: false,
                isPublicFor: [FEED_PUBLIC_FOR_ALL, user.uid],
                userId: user.uid,
                userIds: [user.uid],
                currentReviewerId: user.uid,
                observersIds: [],
                dueDateByObserversIds: {},
                estimationsByObserverIds: {},
                stepHistory: [],
                created: Date.now(),
                creatorId: user.uid,
                dueDate: Date.now(),
                completed: null,
                inDone: false,
                lastEditorId: user.uid,
                lastEditionDate: Date.now(),
                linkBack: '',
                comments: [],
                linkedParentNotesIds: '',
                linkedParentTasksIds: '',
                linkedParentContactsIds: '',
                linkedParentProjectsIds: '',
                linkedParentGoalsIds: '',
                linkedParentSkillsIds: '',
                linkedParentAssistantIds: '',
                autoEstimation: null,
                suggestedBy: null,
                parentGoalId:
                    includeGoals &&
                    taskData &&
                    taskData.parentGoalId &&
                    taskData.parentGoalIsPublicFor.includes(FEED_PUBLIC_FOR_ALL)
                        ? taskData.parentGoalId
                        : null,
                parentGoalIsPublicFor:
                    includeGoals &&
                    taskData &&
                    taskData.parentGoalId &&
                    taskData.parentGoalIsPublicFor.includes(FEED_PUBLIC_FOR_ALL)
                        ? taskData.parentGoalIsPublicFor
                        : null,
                containerNotesIds:
                    includeNotes && taskData && taskData.containerNotesIds ? taskData.containerNotesIds : [],
            }

            if (!arrayPromises[promiseIndex]) arrayPromises[promiseIndex] = []
            arrayPromises[promiseIndex].push(newTaskRef.set(newTaskData))
            arrayPromises[promiseIndex].push(addFollower(firebase, newProjectId, user.uid, FOLLOW_TYPE_TASKS, task.id))

            if (arrayPromises[promiseIndex].length === 500) {
                promiseIndex += 2
            }
        }
    })

    for (let subArray of arrayPromises) {
        await promiseAllAndCatch(subArray, 'TASKS')
    }

    return { taskAmountsByGoals, objectNotes }
}

const registerAmountOfTaskByGoal = (includeGoals, taskData, taskAmountsByGoals, goalId, userId) => {
    if (includeGoals && taskData.parentGoalId && taskData.parentGoalIsPublicFor.includes(FEED_PUBLIC_FOR_ALL)) {
        if (!taskAmountsByGoals[goalId]) {
            taskAmountsByGoals[goalId] = { [userId]: 1 }
        } else {
            taskAmountsByGoals[goalId][userId]++
        }
    }
}

module.exports = {
    copyTasks,
}
