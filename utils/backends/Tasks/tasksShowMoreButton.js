import moment from 'moment'

import { getDb, globalWatcherUnsub, mapGoalData, mapTaskData } from '../firestore'
import store from '../../../redux/store'
import {
    addThereAreLaterEmptyGoals,
    removeThereAreLaterEmptyGoals,
    addThereAreLaterOpenTasks,
    removeThereAreLaterOpenTasks,
    addThereAreSomedayOpenTasks,
    removeThereAreSomedayOpenTasks,
    addThereAreSomedayEmptyGoals,
    removeThereAreSomedayEmptyGoals,
} from '../../../redux/actions'
import { FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'
import { DEFAULT_WORKSTREAM_ID, isWorkstream } from '../../../components/Workstreams/WorkstreamHelper'
import { DYNAMIC_PERCENT, getOwnerId } from '../../../components/GoalsView/GoalsHelper'
import { BACKLOG_DATE_NUMERIC } from '../../../components/TaskListView/Utils/TasksHelper'

const updateLaterTasksState = (projectId, futureTasksData, checkLaterTasks, checkSomedayTasks) => {
    let stillLoading = futureTasksData.thereAreRegularTasks === null || futureTasksData.thereAreObservedTasks === null

    if (!stillLoading)
        Object.values(futureTasksData.userWorkstreamRegularTasksAmount).forEach(value => {
            if (value === null) stillLoading = true
        })
    futureTasksData.showButton =
        futureTasksData.thereAreRegularTasks ||
        futureTasksData.thereAreObservedTasks ||
        futureTasksData.userWorkstreamRegularTasksAmount.total > 0
    if (checkLaterTasks)
        store.dispatch(addThereAreLaterOpenTasks(projectId, stillLoading ? undefined : futureTasksData.showButton))
    else if (checkSomedayTasks)
        store.dispatch(addThereAreSomedayOpenTasks(projectId, stillLoading ? undefined : futureTasksData.showButton))
}

export const watchIfNeedShowLaterOpenTasksButton = (
    projectId,
    userId,
    userWorkstreamIds,
    normalWatcherKey,
    observedWatcherKey,
    userWorkstreamsWatcherKey,
    checkLaterTasks,
    checkSomedayTasks
) => {
    const { loggedUser } = store.getState()
    const { uid: loggedUserId, isAnonymous } = loggedUser

    const allowUserIds = isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]

    const futureTasksData = {
        showButton: false,
        thereAreRegularTasks: null,
        thereAreObservedTasks: isWorkstream(userId) ? false : null,
        userWorkstreamRegularTasksAmount: { total: 0 },
    }

    const endOfDay = moment().endOf('day').valueOf()

    let normalQuery = getDb()
        .collection(`items/${projectId}/tasks`)
        .where('done', '==', false)
        .where('parentId', '==', null)
        .where('currentReviewerId', '==', userId)
        .where('isPublicFor', 'array-contains-any', allowUserIds)

    if (checkLaterTasks) {
        normalQuery = normalQuery.where('dueDate', '>', endOfDay).where('dueDate', '<', BACKLOG_DATE_NUMERIC)
    } else if (checkSomedayTasks) {
        normalQuery = normalQuery.where('dueDate', '==', BACKLOG_DATE_NUMERIC)
    }

    globalWatcherUnsub[normalWatcherKey] = normalQuery.limit(1).onSnapshot(snapshot => {
        futureTasksData.thereAreRegularTasks = snapshot.docs.length > 0
        updateLaterTasksState(projectId, futureTasksData, checkLaterTasks, checkSomedayTasks)
    })

    if (!isWorkstream(userId)) {
        globalWatcherUnsub[observedWatcherKey] = getDb()
            .collection(`items/${projectId}/tasks`)
            .where('done', '==', false)
            .where('parentId', '==', null)
            .where('observersIds', 'array-contains-any', [userId])
            .orderBy('dueDate', 'asc')
            .onSnapshot(snapshot => {
                futureTasksData.thereAreObservedTasks = false
                for (let i = 0; i < snapshot.docs.length; i++) {
                    const task = mapTaskData(snapshot.docs[i].id, snapshot.docs[i].data())
                    const { isPublicFor, dueDateByObserversIds } = task
                    const isPublicForLoggedUser =
                        isPublicFor.includes(FEED_PUBLIC_FOR_ALL) ||
                        (!isAnonymous && isPublicFor.includes(loggedUserId))
                    const isLaterTask =
                        dueDateByObserversIds[userId] > endOfDay && dueDateByObserversIds[userId] < BACKLOG_DATE_NUMERIC
                    const isSomedayTask = dueDateByObserversIds[userId] === BACKLOG_DATE_NUMERIC
                    const needToCountTheTask =
                        isPublicForLoggedUser &&
                        ((checkLaterTasks && isLaterTask) || (checkSomedayTasks && isSomedayTask))
                    if (needToCountTheTask) {
                        futureTasksData.thereAreObservedTasks = true
                        break
                    }
                }

                updateLaterTasksState(projectId, futureTasksData, checkLaterTasks, checkSomedayTasks)
            })

        const allUserWorkstreamIds = [...userWorkstreamIds, DEFAULT_WORKSTREAM_ID]
        allUserWorkstreamIds.forEach(wsId => {
            futureTasksData.userWorkstreamRegularTasksAmount[wsId] = null
            let userWorkstreamsQuery = getDb()
                .collection(`items/${projectId}/tasks`)
                .where('done', '==', false)
                .where('parentId', '==', null)
                .where('userId', '==', wsId)
                .where('isPublicFor', 'array-contains-any', allowUserIds)

            if (checkLaterTasks) {
                userWorkstreamsQuery = userWorkstreamsQuery
                    .where('dueDate', '>', endOfDay)
                    .where('dueDate', '<', BACKLOG_DATE_NUMERIC)
            } else if (checkSomedayTasks) {
                userWorkstreamsQuery = userWorkstreamsQuery.where('dueDate', '==', BACKLOG_DATE_NUMERIC)
            }

            globalWatcherUnsub[userWorkstreamsWatcherKey] = userWorkstreamsQuery.onSnapshot(snapshot => {
                if (futureTasksData.userWorkstreamRegularTasksAmount[wsId]) {
                    futureTasksData.userWorkstreamRegularTasksAmount[wsId] = false
                    futureTasksData.userWorkstreamRegularTasksAmount.total -= 1
                }
                if (snapshot.docs.length > 0) {
                    futureTasksData.userWorkstreamRegularTasksAmount[wsId] = true
                    futureTasksData.userWorkstreamRegularTasksAmount.total += 1
                }
                if (futureTasksData.userWorkstreamRegularTasksAmount[wsId] === null) {
                    futureTasksData.userWorkstreamRegularTasksAmount[wsId] = false
                }
                updateLaterTasksState(projectId, futureTasksData, checkLaterTasks, checkSomedayTasks)
            })
        })
    }
}

export const unwatchIfNeedShowLaterOpenTasksButton = (projectId, watcherKeys, checkLaterTasks, checkSomedayTasks) => {
    watcherKeys.forEach(watcherKey => {
        if (globalWatcherUnsub[watcherKey]) globalWatcherUnsub[watcherKey]()
    })

    if (checkLaterTasks) store.dispatch(removeThereAreLaterOpenTasks(projectId))
    else if (checkSomedayTasks) store.dispatch(removeThereAreSomedayOpenTasks(projectId))
}

export const watchIfNeedShowLaterEmptyGoalsButton = (
    projectId,
    userId,
    watcherKey,
    checkLaterGoals,
    checkSomedayGoals
) => {
    const { loggedUser } = store.getState()
    const { uid: loggedUserId, isAnonymous } = loggedUser

    const endOfDay = moment().endOf('day').valueOf()

    const ownerId = getOwnerId(projectId, userId)

    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`goals/${projectId}/items`)
        .where('progress', '!=', 100)
        .where('assigneesIds', 'array-contains-any', [userId])
        .where('ownerId', '==', ownerId)
        .onSnapshot(docs => {
            let needToShowButton = false
            docs.forEach(doc => {
                if (!needToShowButton) {
                    const goal = mapGoalData(doc.id, doc.data())
                    const { assigneesReminderDate, progress, dynamicProgress, isPublicFor } = goal
                    const isDynamicCompletedGoal = progress === DYNAMIC_PERCENT && dynamicProgress === 100
                    const isLaterGoal =
                        assigneesReminderDate[userId] > endOfDay && assigneesReminderDate[userId] < BACKLOG_DATE_NUMERIC
                    const isSomedayGoal = assigneesReminderDate[userId] === BACKLOG_DATE_NUMERIC
                    const isPublic =
                        isPublicFor.includes(FEED_PUBLIC_FOR_ALL) ||
                        (!isAnonymous && isPublicFor.includes(loggedUserId))
                    if (
                        !isDynamicCompletedGoal &&
                        ((checkLaterGoals && isLaterGoal) || (checkSomedayGoals && isSomedayGoal)) &&
                        isPublic
                    )
                        needToShowButton = true
                }
            })
            if (checkLaterGoals) store.dispatch(addThereAreLaterEmptyGoals(projectId, needToShowButton))
            else if (checkSomedayGoals) store.dispatch(addThereAreSomedayEmptyGoals(projectId, needToShowButton))
        })
}

export const unwatchIfNeedShowLaterEmptyGoalsButton = (projectId, watcherKey, checkLaterGoals, checkSomedayGoals) => {
    if (globalWatcherUnsub[watcherKey]) globalWatcherUnsub[watcherKey]()
    if (checkLaterGoals) store.dispatch(removeThereAreLaterEmptyGoals(projectId))
    else if (checkSomedayGoals) store.dispatch(removeThereAreSomedayEmptyGoals(projectId))
}
