const { DEFAULT_WORKSTREAM_ID } = require('../Workstreams/WorkstreamHelper')
const { promiseAllAndCatch, FEED_PUBLIC_FOR_ALL } = require('./HelperFunctions')
const { addFollower, FOLLOW_TYPE_GOALS } = require('./FollowObjectHelper')

const BACKLOG_DATE_NUMERIC = Number.MAX_SAFE_INTEGER

const copyGoals = async (firebase, projectId, newProjectId, user, originGoals, taskAmountsByGoals) => {
    const db = firebase.firestore()
    let arrayPromises = []
    let promiseIndex = 0
    const objectNotes = []

    originGoals.forEach(goal => {
        const goalData = goal.data()
        if (goalData.noteId != null) objectNotes.push(goalData.noteId)

        const newGoalRef = db.doc(`/goals/${newProjectId}/items/${goal.id}`)
        const newGoalData = {
            ...goalData,
            created: Date.now(),
            creatorId: user.uid,
            progress: 0,
            assigneesIds: [],
            assigneesCapacity: {},
            assigneesReminderDate: {},
            lastEditionDate: Date.now(),
            lastEditorId: user.uid,
            startingMilestoneDate: BACKLOG_DATE_NUMERIC,
            completionMilestoneDate: BACKLOG_DATE_NUMERIC,
            parentDoneMilestoneIds: [],
            progressByDoneMilestone: {},
            dateByDoneMilestone: {},
            sortIndexByMilestone: {},
            isPublicFor: [FEED_PUBLIC_FOR_ALL],
        }

        if (!arrayPromises[promiseIndex]) arrayPromises[promiseIndex] = []
        arrayPromises[promiseIndex].push(newGoalRef.set(newGoalData))
        arrayPromises[promiseIndex].push(addFollower(firebase, newProjectId, user.uid, FOLLOW_TYPE_GOALS, goal.id))

        if (arrayPromises[promiseIndex].length === 500) {
            promiseIndex += 2
        }
    })

    for (let subArray of arrayPromises) {
        await promiseAllAndCatch(subArray, 'GOALS')
    }

    return objectNotes
}

module.exports = {
    BACKLOG_DATE_NUMERIC,
    copyGoals,
}
