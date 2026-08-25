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
    clearOpenTasksShowMoreDataInProject,
    setOpenTasksShowMoreDataInProject,
} from '../../../redux/actions'
import { FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'
import { DEFAULT_WORKSTREAM_ID, isWorkstream } from '../../../components/Workstreams/WorkstreamHelper'
import { DYNAMIC_PERCENT, getOwnerId } from '../../../components/GoalsView/GoalsHelper'
import { BACKLOG_DATE_NUMERIC } from '../../../components/TaskListView/Utils/TasksHelper'
import {
    GOALS_MY_DAY_TYPE,
    OBSERVED_TASKS_MY_DAY_TYPE,
    TO_ATTEND_TASKS_MY_DAY_TYPE,
    WORKSTREAM_TASKS_MY_DAY_TYPE,
} from './myDayTasks'
import {
    classifyShowMoreDueDates,
    combineShowMoreAvailability,
    EMPTY_SHOW_MORE_AVAILABILITY,
} from './taskShowMoreAvailability'

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
        const userWorkstreamUnsubscribes = []
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

            userWorkstreamUnsubscribes.push(
                userWorkstreamsQuery.onSnapshot(snapshot => {
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
            )
        })
        // One caller key represents the whole workstream group. Storing every
        // listener under that composite unsubscribe prevents earlier handles
        // from being overwritten (and leaked) when the user belongs to more
        // than the default workstream.
        globalWatcherUnsub[userWorkstreamsWatcherKey] = () => {
            userWorkstreamUnsubscribes.forEach(unsubscribe => unsubscribe())
        }
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

const timeFields = ['tomorrow', 'future', 'someday']

const snapshotDocs = snapshot => {
    const docs = []
    snapshot.forEach(doc => docs.push(doc))
    return docs
}

/**
 * Show-more availability with shared broad queries for observed tasks and
 * goals, plus bounded `limit(1)` queries for assigned/workstream date buckets.
 * Selected-project views keep these live; All Projects uses one-shot reads so
 * every visible project does not permanently add another listener fan-out.
 */
export const watchOpenTasksShowMoreAvailability = ({
    projectId,
    userId,
    userWorkstreamIds = [],
    isAnonymous = false,
    watcherKey,
    live = true,
}) => {
    const { loggedUser } = store.getState()
    const loggedUserId = loggedUser.uid
    const allowUserIds = isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]
    const endOfDay = moment().endOf('day').valueOf()
    const endOfTomorrow = moment().endOf('day').add(1, 'day').valueOf()
    const allWorkstreamIds = isWorkstream(userId)
        ? []
        : Array.from(new Set([...(userWorkstreamIds || []), DEFAULT_WORKSTREAM_ID]))
    const sources = {
        assigned: { remaining: 3, value: { ...EMPTY_SHOW_MORE_AVAILABILITY } },
        observed: { remaining: isWorkstream(userId) ? 0 : 1, value: { ...EMPTY_SHOW_MORE_AVAILABILITY } },
        workstreams: Object.fromEntries(
            allWorkstreamIds.map(workstreamId => [
                workstreamId,
                { remaining: 2, value: { ...EMPTY_SHOW_MORE_AVAILABILITY } },
            ])
        ),
        goals: { remaining: 1, value: { ...EMPTY_SHOW_MORE_AVAILABILITY } },
    }
    const published = new Map()
    let publishedTaskAvailability = null
    let publishedGoalAvailability = null
    const unsubscribes = []
    let disposed = false

    const publishCategory = (actions, key, tasksType, workstreamId, value) => {
        const previous = published.get(key)
        if (previous && timeFields.every(field => previous[field] === value[field])) return

        published.set(key, { ...value })
        timeFields.forEach(field => {
            actions.push(
                setOpenTasksShowMoreDataInProject(
                    projectId,
                    tasksType,
                    workstreamId,
                    field === 'someday',
                    !!value[field],
                    field === 'tomorrow'
                )
            )
        })
    }

    const publish = () => {
        if (disposed) return
        const actions = []

        if (sources.assigned.remaining === 0)
            publishCategory(actions, 'assigned', TO_ATTEND_TASKS_MY_DAY_TYPE, null, sources.assigned.value)
        if (sources.observed.remaining === 0)
            publishCategory(actions, 'observed', OBSERVED_TASKS_MY_DAY_TYPE, null, sources.observed.value)
        Object.entries(sources.workstreams).forEach(([workstreamId, source]) => {
            if (source.remaining === 0)
                publishCategory(
                    actions,
                    `workstream:${workstreamId}`,
                    WORKSTREAM_TASKS_MY_DAY_TYPE,
                    workstreamId,
                    source.value
                )
        })
        if (sources.goals.remaining === 0)
            publishCategory(actions, 'goals', GOALS_MY_DAY_TYPE, null, sources.goals.value)

        const taskSources = [sources.assigned, sources.observed, ...Object.values(sources.workstreams)]
        if (taskSources.every(source => source.remaining === 0)) {
            const taskAvailability = combineShowMoreAvailability(taskSources.map(source => source.value))
            if (
                !publishedTaskAvailability ||
                publishedTaskAvailability.later !== taskAvailability.later ||
                publishedTaskAvailability.someday !== taskAvailability.someday
            ) {
                publishedTaskAvailability = { ...taskAvailability }
                actions.push(addThereAreLaterOpenTasks(projectId, taskAvailability.later))
                actions.push(addThereAreSomedayOpenTasks(projectId, taskAvailability.someday))
            }
        }
        if (sources.goals.remaining === 0) {
            if (
                !publishedGoalAvailability ||
                publishedGoalAvailability.later !== sources.goals.value.later ||
                publishedGoalAvailability.someday !== sources.goals.value.someday
            ) {
                publishedGoalAvailability = { ...sources.goals.value }
                actions.push(addThereAreLaterEmptyGoals(projectId, sources.goals.value.later))
                actions.push(addThereAreSomedayEmptyGoals(projectId, sources.goals.value.someday))
            }
        }

        if (actions.length > 0) store.dispatch(actions)
    }

    const updateSource = (source, value, firstSnapshot) => {
        if (firstSnapshot) source.remaining = Math.max(0, source.remaining - 1)
        source.value = { ...source.value, ...value }
        publish()
    }

    const attach = (query, source, readAvailability, label) => {
        let initialized = false
        const applySnapshot = snapshot => {
            if (disposed) return
            const firstSnapshot = !initialized
            initialized = true
            updateSource(source, readAvailability(snapshot), firstSnapshot)
        }
        const handleError = error => {
            console.warn(`[OpenTasks] Could not watch ${label} show-more availability for ${projectId}:`, error)
            applySnapshot({ docs: [], forEach: () => {} })
        }

        if (live) {
            const unsubscribe = query.onSnapshot(applySnapshot, handleError)
            unsubscribes.push(unsubscribe)
        } else {
            query.get().then(applySnapshot).catch(handleError)
        }
    }

    const assignedBaseQuery = getDb()
        .collection(`items/${projectId}/tasks`)
        .where('inDone', '==', false)
        .where('parentId', '==', null)
        .where('currentReviewerId', '==', userId)
        .where('isPublicFor', 'array-contains-any', allowUserIds)
    attach(
        assignedBaseQuery
            .where('dueDate', '>', endOfDay)
            .where('dueDate', '<', BACKLOG_DATE_NUMERIC)
            .orderBy('dueDate', 'asc')
            .limit(1),
        sources.assigned,
        snapshot => {
            const firstDueDate = snapshot.docs[0]?.data().dueDate
            return {
                later: snapshot.docs.length > 0,
                tomorrow: snapshot.docs.length > 0 && firstDueDate <= endOfTomorrow,
            }
        },
        'assigned later tasks'
    )
    attach(
        assignedBaseQuery.where('dueDate', '>', endOfTomorrow).where('dueDate', '<', BACKLOG_DATE_NUMERIC).limit(1),
        sources.assigned,
        snapshot => ({ future: snapshot.docs.length > 0 }),
        'assigned future tasks'
    )
    attach(
        assignedBaseQuery.where('dueDate', '==', BACKLOG_DATE_NUMERIC).limit(1),
        sources.assigned,
        snapshot => ({ someday: snapshot.docs.length > 0 }),
        'assigned someday tasks'
    )

    if (!isWorkstream(userId)) {
        const observedQuery = getDb()
            .collection(`items/${projectId}/tasks`)
            .where('inDone', '==', false)
            .where('parentId', '==', null)
            .where('observersIds', 'array-contains-any', [userId])
        attach(
            observedQuery,
            sources.observed,
            snapshot =>
                classifyShowMoreDueDates(
                    snapshotDocs(snapshot)
                        .map(doc => doc.data())
                        .filter(
                            task =>
                                Array.isArray(task.isPublicFor) &&
                                task.isPublicFor.some(id => allowUserIds.includes(id))
                        )
                        .map(task => task.dueDateByObserversIds?.[userId]),
                    endOfDay,
                    endOfTomorrow
                ),
            'observed tasks'
        )

        allWorkstreamIds.forEach(workstreamId => {
            const workstreamBaseQuery = getDb()
                .collection(`items/${projectId}/tasks`)
                .where('inDone', '==', false)
                .where('parentId', '==', null)
                .where('userId', '==', workstreamId)
                .where('isPublicFor', 'array-contains-any', allowUserIds)
            attach(
                workstreamBaseQuery
                    .where('dueDate', '>', endOfDay)
                    .where('dueDate', '<', BACKLOG_DATE_NUMERIC)
                    .orderBy('dueDate', 'asc')
                    .limit(1),
                sources.workstreams[workstreamId],
                snapshot => {
                    const firstDueDate = snapshot.docs[0]?.data().dueDate
                    const later = snapshot.docs.length > 0
                    return {
                        later,
                        tomorrow: later && firstDueDate <= endOfTomorrow,
                        // Preserve the old workstream show-more semantics: this
                        // flag represented every finite date after today.
                        future: later,
                    }
                },
                `workstream ${workstreamId} later tasks`
            )
            attach(
                workstreamBaseQuery.where('dueDate', '==', BACKLOG_DATE_NUMERIC).limit(1),
                sources.workstreams[workstreamId],
                snapshot => ({ someday: snapshot.docs.length > 0 }),
                `workstream ${workstreamId} someday tasks`
            )
        })
    }

    const ownerId = getOwnerId(projectId, userId)
    const goalsQuery = getDb()
        .collection(`goals/${projectId}/items`)
        .where('progress', '!=', 100)
        .where('assigneesIds', 'array-contains-any', [userId])
        .where('ownerId', '==', ownerId)
    attach(
        goalsQuery,
        sources.goals,
        snapshot =>
            classifyShowMoreDueDates(
                snapshotDocs(snapshot)
                    .map(doc => mapGoalData(doc.id, doc.data()))
                    .filter(goal => goal.progress !== DYNAMIC_PERCENT || goal.dynamicProgress !== 100)
                    .filter(
                        goal =>
                            Array.isArray(goal.isPublicFor) && goal.isPublicFor.some(id => allowUserIds.includes(id))
                    )
                    .map(goal => goal.assigneesReminderDate?.[userId]),
                endOfDay,
                endOfTomorrow
            ),
        'empty goals'
    )

    const unsubscribe = () => {
        if (disposed) return
        disposed = true
        unsubscribes.forEach(stop => stop())
        if (watcherKey) delete globalWatcherUnsub[watcherKey]
        store.dispatch([
            removeThereAreLaterOpenTasks(projectId),
            removeThereAreSomedayOpenTasks(projectId),
            removeThereAreLaterEmptyGoals(projectId),
            removeThereAreSomedayEmptyGoals(projectId),
            clearOpenTasksShowMoreDataInProject(projectId),
        ])
    }

    if (watcherKey) globalWatcherUnsub[watcherKey] = unsubscribe
    return unsubscribe
}
