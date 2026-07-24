'use strict'
const moment = require('moment')
const admin = require('firebase-admin')
const { BatchWrapper } = require('../BatchWrapper/batchWrapper')

const { OPEN_STEP } = require('../Utils/HelperFunctionsCloud')
const { mapTaskData } = require('../Utils/MapDataFuncions')
const { updateStatistics } = require('../Utils/statisticsHelper')
const { isEqual } = require('lodash')
const { getUserData } = require('../Users/usersFirestore')
const { addProjectRoutingReasonComment } = require('../shared/projectRoutingCommentHelper')

const FIRESTORE_IN_QUERY_MAX_IDS = 30

const generateTask = (customData, uid) => {
    return {
        completed: null,
        created: Date.now(),
        creatorId: uid,
        done: false,
        hasStar: '#ffffff',
        dueDate: Date.now(),
        isPrivate: false,
        isPublicFor: [0, uid],
        lastEditorId: uid,
        lastEditionDate: Date.now(),
        userId: uid,
        userIds: [uid],
        currentReviewerId: uid,
        observersIds: [],
        dueDateByObserversIds: {},
        estimationsByObserverIds: {},
        stepHistory: [OPEN_STEP],
        parentId: null,
        isSubtask: false,
        subtaskIds: [],
        recurrence: 'never',
        estimations: { [OPEN_STEP]: 0 },
        genericData: null,
        linkedParentNotesIds: [],
        linkedParentTasksIds: [],
        linkedParentContactsIds: [],
        linkedParentProjectsIds: [],
        linkedParentGoalsIds: [],
        linkedParentSkillsIds: [],
        linkedParentAssistantIds: [],
        parentDone: false,
        inDone: false,
        suggestedBy: null,
        parentGoalId: null,
        parentGoalIsPublicFor: null,
        containerNotesIds: [],
        autoEstimation: null,
        noteId: null,
        ...customData,
    }
}

const filterEvents = (events, email) => {
    return events.filter(event => {
        // Filter out cancelled events first
        if (event.status === 'cancelled') {
            return false
        }

        const { attendees } = event
        if (attendees) {
            const attendee = attendees.find(att => att.email === email)
            if (attendee) {
                // Filter if the user declined
                if (attendee.responseStatus === 'declined') {
                    return false
                }
            }
        }
        // Keep the event if it's not cancelled and the user hasn't declined
        return true
    })
}

const checkIfNeedToUpdateTask = (oldTask, dataToUpdate) => {
    const oldData = {
        calendarData: oldTask.calendarData,
        name: oldTask.name,
        extendedName: oldTask.extendedName,
        description: oldTask.description,
        estimations: oldTask.estimations,
    }
    return !isEqual(oldData, dataToUpdate)
}

// Compute sortIndex with proper timezone handling for all-day events
const computeSortIndex = (start, timezoneOffset = 0) => {
    const isAllDay = start.date && !start.dateTime
    if (isAllDay) {
        // For all-day events, apply timezone offset to interpret the date correctly
        return moment(start.date).utcOffset(timezoneOffset, true).valueOf()
    }
    // For timed events, dateTime already includes timezone info
    return moment(start.dateTime).valueOf()
}

const generateDataToUpdate = (event, email, originalProjectId = null, timezoneOffset = 0) => {
    const { start, end, summary, htmlLink, description } = event

    const name = summary.toString()
    const isAllDay = start.date && end.date

    // For all-day events, the date string (e.g., "2024-01-15") has no timezone info.
    // We must apply the user's timezone offset to interpret it correctly.
    // For timed events, dateTime already includes timezone info (e.g., "2024-01-15T10:00:00+02:00").
    let startDate, endDate
    if (isAllDay) {
        startDate = moment(start.date).utcOffset(timezoneOffset, true)
        endDate = moment(end.date).utcOffset(timezoneOffset, true)
    } else {
        startDate = moment(start.dateTime)
        endDate = moment(end.dateTime)
    }

    const calendarData = { link: htmlLink, start, end, email, provider: event.provider || 'google' }

    // Store the original project ID if this is a new task
    if (originalProjectId) {
        calendarData.originalProjectId = originalProjectId
    }

    const dataToUpdate = {
        calendarData,
        name,
        extendedName: name,
        description: description || '',
        estimations: {
            [OPEN_STEP]: isAllDay ? 0 : endDate.diff(startDate, 'minutes'),
        },
    }

    return dataToUpdate
}

const normalizeRoutingDecision = decision => {
    if (!decision) return null

    if (typeof decision === 'string') {
        return {
            matched: true,
            targetProjectId: decision,
            reasoning: '',
            confidence: null,
            projectName: '',
        }
    }

    if (typeof decision !== 'object') return null

    return {
        matched: !!decision.matched && !!decision.targetProjectId,
        targetProjectId: decision.targetProjectId || null,
        reasoning: typeof decision.reasoning === 'string' ? decision.reasoning.trim() : '',
        confidence: Number.isFinite(decision.confidence) ? Number(decision.confidence) : null,
        projectName: typeof decision.projectName === 'string' ? decision.projectName.trim() : '',
        goldSpent: Number.isFinite(decision.goldSpent) ? Number(decision.goldSpent) : 0,
        tokenUsage: decision.tokenUsage || null,
        secondPassUsed: !!decision.tokenUsage?.auditModel,
        secondPassModel:
            typeof decision.tokenUsage?.auditModel === 'string' ? decision.tokenUsage.auditModel.trim() : '',
    }
}

// A calendar event is "already routed" once the classifier ran and its explanation comment
// was written (which is the only thing that persists `calendarData.projectRouting.commentId`).
const isCalendarEventAlreadyRouted = task => Boolean(task?.calendarData?.projectRouting?.commentId)

// Resolve the target project + routing decision for a single calendar event during sync.
//
// Once an event has been routed and commented, treat that decision as FINAL: keep the task in
// its current project and pass no routing decision. Re-running the classifier on every sync is
// non-deterministic — especially for sparse full-day events that carry no attendee/domain signal
// — so without this guard the chosen project flip-flops between syncs, which re-adds the routing
// comment and re-stamps the routing chat's "last edited" date several times a day.
const resolveCalendarRoutingForEvent = (existingTask, rawRoutingDecision, syncProjectId) => {
    if (isCalendarEventAlreadyRouted(existingTask)) {
        return { routingDecision: null, targetProjectId: existingTask.projectId }
    }

    const routingDecision = normalizeRoutingDecision(rawRoutingDecision)
    const targetProjectId = routingDecision?.matched ? routingDecision.targetProjectId : syncProjectId
    return { routingDecision, targetProjectId }
}

const shouldAddRoutingComment = (task, targetProjectId, routingDecision) => {
    // Comment whenever routing actually ran (matched or not). When the classifier
    // leaves the task in the connected/default project (matched === false), we still
    // want a comment explaining why it stayed there.
    if (!routingDecision || !targetProjectId) return false

    const previousRouting = task?.calendarData?.projectRouting || null
    return !previousRouting?.commentId || previousRouting.chosenProjectId !== targetProjectId
}

const addCalendarRoutingCommentIfNeeded = async ({
    userData,
    projectId,
    taskId,
    task,
    routingDecision,
    syncProjectId,
}) => {
    if (routingDecision?.targetProjectId && routingDecision.targetProjectId !== projectId) return null
    if (!shouldAddRoutingComment(task, projectId, routingDecision)) return null

    return await addProjectRoutingReasonComment({
        userData,
        projectId,
        taskId,
        task,
        projectName: routingDecision.projectName,
        reasoning: routingDecision.reasoning,
        confidence: routingDecision.confidence,
        matched: !!routingDecision.matched,
        secondPassUsed: routingDecision.secondPassUsed,
        secondPassModel: routingDecision.secondPassModel,
        source: 'calendar_project_routing',
        routingKey: taskId,
        sourceDataField: 'calendarData',
        routingData: {
            eventId: taskId,
            syncProjectId,
            matched: !!routingDecision.matched,
            goldSpent: routingDecision.goldSpent || 0,
            tokenUsage: routingDecision.tokenUsage || null,
            secondPassUsed: routingDecision.secondPassUsed,
            secondPassModel: routingDecision.secondPassModel,
        },
    })
}

const addOrUpdateCalendarTask = async (
    syncProjectId,
    targetProjectId,
    task,
    event,
    userId,
    email,
    timezoneOffset = 0,
    routingDecision = null,
    userData = null
) => {
    const { start, id: taskId } = event
    const normalizedRoutingDecision = normalizeRoutingDecision(routingDecision)

    // Pass the calendar-connected project for new tasks, even when the task is routed elsewhere.
    const isNewTask = !task
    const dataToUpdate = generateDataToUpdate(event, email, isNewTask ? syncProjectId : null, timezoneOffset)

    // Preserve manual pinning info and originalProjectId from existing task
    if (task && task.calendarData) {
        if (task.calendarData.pinnedToProjectId) {
            dataToUpdate.calendarData.pinnedToProjectId = task.calendarData.pinnedToProjectId
        }
        if (task.calendarData.originalProjectId) {
            dataToUpdate.calendarData.originalProjectId = task.calendarData.originalProjectId
        }
        if (task.calendarData.projectRouting) {
            dataToUpdate.calendarData.projectRouting = task.calendarData.projectRouting
        }
    }

    if (task) {
        // Respect manual pinning: if pinned, never move between projects
        const isPinned = Boolean(task.calendarData && task.calendarData.pinnedToProjectId)

        // If exists under a different project, same calendar email, and not pinned,
        // move it to the selected project to enforce single-project ownership per account.
        if (!isPinned && task.projectId !== targetProjectId && task.calendarData && task.calendarData.email === email) {
            const oldRef = admin.firestore().doc(`items/${task.projectId}/tasks/${taskId}`)
            const newRef = admin.firestore().doc(`items/${targetProjectId}/tasks/${taskId}`)

            // Merge existing task data with the latest calendar fields, omitting non-persisted props
            const { id, projectId: oldProjectId, ...persistableTask } = task
            const newTaskData = { ...persistableTask, ...dataToUpdate }

            // Preserve sortIndex when present; otherwise compute from start with timezone
            if (!newTaskData.sortIndex) {
                newTaskData.sortIndex = computeSortIndex(start, timezoneOffset)
            }

            // Create in new project, delete from old
            await newRef.set(newTaskData, { merge: true })
            await oldRef.delete()
            await addCalendarRoutingCommentIfNeeded({
                userData,
                projectId: targetProjectId,
                taskId,
                task: newTaskData,
                routingDecision: normalizedRoutingDecision,
                syncProjectId,
            })
            return
        }

        // Otherwise, just update in-place when needed (and keep pinning if present)
        if (checkIfNeedToUpdateTask(task, dataToUpdate)) {
            const taskRef = admin.firestore().doc(`items/${task.projectId}/tasks/${taskId}`)
            const oldEstimation = Number(task.estimations?.[OPEN_STEP] || 0)
            const newEstimation = Number(dataToUpdate.estimations?.[OPEN_STEP] || 0)

            if (task.done && task.completed && oldEstimation !== newEstimation) {
                const batch = new BatchWrapper(admin.firestore())
                batch.update(taskRef, dataToUpdate)
                await updateStatistics(task.projectId, task.userId, oldEstimation, true, true, task.completed, batch)
                await updateStatistics(task.projectId, task.userId, newEstimation, false, true, task.completed, batch)
                await batch.commit()
            } else {
                await taskRef.update(dataToUpdate)
            }
        }
        await addCalendarRoutingCommentIfNeeded({
            userData,
            projectId: task.projectId,
            taskId,
            task,
            routingDecision: normalizedRoutingDecision,
            syncProjectId,
        })
    } else {
        dataToUpdate.sortIndex = computeSortIndex(start, timezoneOffset)
        const newTask = generateTask(dataToUpdate, userId)
        await admin.firestore().doc(`items/${targetProjectId}/tasks/${taskId}`).set(newTask)
        await addCalendarRoutingCommentIfNeeded({
            userData,
            projectId: targetProjectId,
            taskId,
            task: newTask,
            routingDecision: normalizedRoutingDecision,
            syncProjectId,
        })
    }
}

const createTasksMap = tasks => {
    const tasksMap = {}
    tasks.forEach(task => {
        tasksMap[task.id] = task
    })
    return tasksMap
}

const addCalendarEvents = async (
    events,
    syncProjectId,
    userId,
    email,
    timezoneOffset = 0,
    routingDecisionsByEventId = {}
) => {
    const user = await getUserData(userId)
    if (!user) {
        return
    }

    const filteredEvents = filterEvents(events, email)
    const eventIds = filteredEvents.map(event => event.id).filter(Boolean)

    // Search across ALL user projects to find existing calendar tasks
    // This prevents duplicates when users manually move or previously complete tasks.
    const tasks = await getCalendarTasksInAllProjects(user.projectIds, userId, eventIds)
    const tasksMap = createTasksMap(tasks)

    console.log(
        `[addCalendarEvents] Processing ${filteredEvents.length}/${events.length} events (${
            events.length - filteredEvents.length
        } filtered)`
    )

    const promises = []
    filteredEvents.forEach(event => {
        const existingTask = tasksMap[event.id]
        const { routingDecision, targetProjectId } = resolveCalendarRoutingForEvent(
            existingTask,
            routingDecisionsByEventId[event.id],
            syncProjectId
        )
        promises.push(
            addOrUpdateCalendarTask(
                syncProjectId,
                targetProjectId,
                existingTask,
                event,
                userId,
                email,
                timezoneOffset,
                routingDecision,
                user
            )
        )
    })

    await Promise.all(promises)
}

const checkIfIsInvalidEvent = (events, taskId) => {
    const event = events.find(event => event.id === taskId)
    const isInvalid = !event || event.responseStatus === 'declined'
    return isInvalid
}

const convertDocsInTasks = (projectId, docs) => {
    const tasks = []
    docs.forEach(doc => {
        const task = mapTaskData(doc.id, doc.data())
        task.projectId = projectId
        tasks.push(task)
    })
    return tasks
}

const getTasksBaseQuery = (projectId, userId, done) => {
    return admin
        .firestore()
        .collection(`items/${projectId}/tasks`)
        .where('calendarData', '!=', null)
        .where('userId', '==', userId)
        .where('done', '==', done)
}

const getCalendarTasksByEventIdsInProject = async (projectId, userId, eventIds = []) => {
    const uniqueEventIds = [...new Set(eventIds.filter(Boolean))]
    if (uniqueEventIds.length === 0) return []

    const eventIdChunks = []
    for (let i = 0; i < uniqueEventIds.length; i += FIRESTORE_IN_QUERY_MAX_IDS) {
        eventIdChunks.push(uniqueEventIds.slice(i, i + FIRESTORE_IN_QUERY_MAX_IDS))
    }

    const results = await Promise.all(
        eventIdChunks.map(eventIdChunk =>
            admin
                .firestore()
                .collection(`items/${projectId}/tasks`)
                .where(admin.firestore.FieldPath.documentId(), 'in', eventIdChunk)
                .get()
        )
    )
    const tasks = []
    results.forEach(snapshot => {
        tasks.push(...convertDocsInTasks(projectId, snapshot).filter(task => task.userId === userId))
    })
    return tasks
}

const getCalendarTasksInProject = async (projectId, userId) => {
    const tasksDocs = await getTasksBaseQuery(projectId, userId, false).get()
    return convertDocsInTasks(projectId, tasksDocs)
}

const getCalendarTasksInAllProjects = async (projectIds, userId, eventIds = []) => {
    const promises = []
    projectIds.forEach(projectId => {
        promises.push(getCalendarTasksInProject(projectId, userId))
        if (eventIds.length > 0) promises.push(getCalendarTasksByEventIdsInProject(projectId, userId, eventIds))
    })
    const results = await Promise.all(promises)

    const tasks = []
    results.forEach(projectTasks => {
        tasks.push(...projectTasks)
    })
    return tasks
}

// Event ids whose task has already been routed (and commented) in a previous sync. The sync
// uses this to skip re-classifying those events, which avoids re-charging gold and the
// non-deterministic re-routing that re-stamps the routing chat. Exact event-id lookups include
// completed tasks from previous days, including multi-day calendar events.
const getRoutedCalendarEventIds = async (userId, eventIds = []) => {
    const user = await getUserData(userId)
    if (!user) {
        return new Set()
    }

    const tasks = await getCalendarTasksInAllProjects(user.projectIds, userId, eventIds)
    const routedEventIds = new Set()
    tasks.forEach(task => {
        if (isCalendarEventAlreadyRouted(task)) {
            routedEventIds.add(task.id)
        }
    })
    return routedEventIds
}

const removeCalendarTasks = async (
    userId,
    projectId,
    dateFormated,
    events,
    removeFromAllDates,
    email,
    timezoneOffset = 0
) => {
    const user = await getUserData(userId)
    if (!user) {
        return
    }

    // Search across ALL user projects to find calendar tasks to potentially remove
    // This ensures we find and clean up tasks even if they were manually moved
    console.log(`[removeCalendarTasks] Fetching tasks for projects: ${user.projectIds.join(', ')}`)
    const tasks = await getCalendarTasksInAllProjects(user.projectIds, userId)
    console.log(`[removeCalendarTasks] Found ${tasks.length} tasks in DB to check.`)
    tasks.forEach(t =>
        console.log(
            `[removeCalendarTasks] DB Task: ${t.id} | ${t.name} | Date: ${
                t.calendarData?.start?.dateTime || t.calendarData?.start?.date
            }`
        )
    )

    const batch = new BatchWrapper(admin.firestore())
    let tasksToDelete = 0

    tasks.forEach(task => {
        if (!task.noteId) {
            // Only consider tasks from the current calendar account
            // This prevents deleting tasks from other calendar accounts when syncing across projects
            if (email && task.calendarData && task.calendarData.email !== email) {
                console.log(
                    `[removeCalendarTasks] Skipping task ${task.id} (${task.name}) - Email mismatch: ${task.calendarData.email} vs ${email}`
                )
                return // Skip this task, it belongs to a different calendar account
            }

            const { projectId, calendarData } = task
            const { dateTime, date } = calendarData.start
            const taskMoment = moment(dateTime || date)
                .utcOffset(timezoneOffset)
                .startOf('day')
            // Use string comparison (YYYYMMDD) effectively ignoring offsets for the categorization
            // of Past/Today/Future to be more robust against TZ shifts
            const taskDateStr = taskMoment.format('YYYYMMDD')
            const syncDateStr = moment(dateFormated, 'DDMMYYYY').format('YYYYMMDD')

            const isToday = taskDateStr === syncDateStr
            const isFuture = taskDateStr > syncDateStr
            const isPast = taskDateStr < syncDateStr

            let shouldDelete = false
            let deleteReason = ''

            if (removeFromAllDates) {
                shouldDelete = true
                deleteReason = 'removeFromAllDates is true'
            } else if (isFuture) {
                // Future task - DELETE (Clean up orphans)
                shouldDelete = true
                deleteReason = `Future task (orphan cleanup) - TaskDate: ${taskDateStr} SyncDate: ${syncDateStr}`
            } else if (isPast) {
                // Past task - SKIP (Preserve history)
                console.log(
                    `[removeCalendarTasks] Skipping task ${task.id} - Past task. TaskDate: ${taskDateStr} SyncDate: ${syncDateStr}`
                )
            } else {
                // Today's task - Check validity
                if (checkIfIsInvalidEvent(events, task.id)) {
                    shouldDelete = true
                    deleteReason = 'Task is invalid/declined'
                } else {
                    console.log(
                        `[removeCalendarTasks] Skipping task ${task.id} (${task.name}) - Date match (${taskDateStr}) but valid event`
                    )
                }
            }

            if (shouldDelete) {
                console.log(
                    `[removeCalendarTasks] Deleting task ${task.id} (${task.name}) - Reason: ${deleteReason} - Date: ${taskDateStr}`
                )
                tasksToDelete++
                batch.delete(admin.firestore().doc(`items/${projectId}/tasks/${task.id}`))
            }
        } else {
            console.log(`[removeCalendarTasks] Skipping task ${task.id} (${task.name}) - Has noteId`)
        }
    })

    if (tasksToDelete > 0) {
        console.log(`[removeCalendarTasks] Removing ${tasksToDelete} tasks`)
    } else {
        console.log(`[removeCalendarTasks] No tasks to remove. Checked ${tasks.length} tasks.`)
    }

    await batch.commit()
}

module.exports = {
    removeCalendarTasks,
    generateTask,
    addCalendarEvents,
    filterEvents,
    addOrUpdateCalendarTask,
    resolveCalendarRoutingForEvent,
    getRoutedCalendarEventIds,
    getCalendarTasksByEventIdsInProject,
}
