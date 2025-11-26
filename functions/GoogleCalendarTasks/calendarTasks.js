'use strict'
const moment = require('moment')
const admin = require('firebase-admin')
const { BatchWrapper } = require('../BatchWrapper/batchWrapper')

const { OPEN_STEP } = require('../Utils/HelperFunctionsCloud')
const { mapTaskData } = require('../Utils/MapDataFuncions')
const { isEqual } = require('lodash')
const { getUserData } = require('../Users/usersFirestore')

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

const generateDataToUpdate = (event, email, projectId = null) => {
    const { start, end, summary, htmlLink, description } = event

    const name = summary.toString()
    const isAllDay = start.date && end.date
    const startDate = moment(start.dateTime || start.date)
    const endDate = moment(end.dateTime || end.date)

    const MINUTES_IN_8_HOURS = 480

    const calendarData = { link: htmlLink, start, end, email }

    // Store the original project ID if this is a new task
    if (projectId) {
        calendarData.originalProjectId = projectId
    }

    const dataToUpdate = {
        calendarData,
        name,
        extendedName: name,
        description: description || '',
        estimations: {
            [OPEN_STEP]: isAllDay ? MINUTES_IN_8_HOURS : endDate.diff(startDate, 'minutes'),
        },
    }

    return dataToUpdate
}

const addOrUpdateCalendarTask = async (projectId, task, event, userId, email) => {
    const { start, id: taskId } = event

    // Pass projectId only for new tasks, otherwise preserve existing originalProjectId
    const isNewTask = !task
    const dataToUpdate = generateDataToUpdate(event, email, isNewTask ? projectId : null)

    // Preserve manual pinning info and originalProjectId from existing task
    if (task && task.calendarData) {
        if (task.calendarData.pinnedToProjectId) {
            dataToUpdate.calendarData.pinnedToProjectId = task.calendarData.pinnedToProjectId
        }
        if (task.calendarData.originalProjectId) {
            dataToUpdate.calendarData.originalProjectId = task.calendarData.originalProjectId
        }
    }

    if (task) {
        // Respect manual pinning: if pinned, never move between projects
        const isPinned = Boolean(task.calendarData && task.calendarData.pinnedToProjectId)

        // If exists under a different project, same calendar email, and not pinned,
        // move it to the newly connected project to enforce single-project ownership per account.
        if (!isPinned && task.projectId !== projectId && task.calendarData && task.calendarData.email === email) {
            const oldRef = admin.firestore().doc(`items/${task.projectId}/tasks/${taskId}`)
            const newRef = admin.firestore().doc(`items/${projectId}/tasks/${taskId}`)

            // Merge existing task data with the latest calendar fields, omitting non-persisted props
            const { id, projectId: oldProjectId, ...persistableTask } = task
            const newTaskData = { ...persistableTask, ...dataToUpdate }

            // Preserve sortIndex when present; otherwise compute from start
            if (!newTaskData.sortIndex) {
                newTaskData.sortIndex = moment(start.dateTime || start.date).valueOf()
            }

            // Create in new project, delete from old
            await newRef.set(newTaskData, { merge: true })
            await oldRef.delete()
            return
        }

        // Otherwise, just update in-place when needed (and keep pinning if present)
        if (checkIfNeedToUpdateTask(task, dataToUpdate)) {
            await admin.firestore().doc(`items/${task.projectId}/tasks/${taskId}`).update(dataToUpdate)
        }
    } else {
        dataToUpdate.sortIndex = moment(start.dateTime || start.date).valueOf()
        await admin.firestore().doc(`items/${projectId}/tasks/${taskId}`).set(generateTask(dataToUpdate, userId))
    }
}

const createTasksMap = tasks => {
    const tasksMap = {}
    tasks.forEach(task => {
        tasksMap[task.id] = task
    })
    return tasksMap
}

const addCalendarEvents = async (events, syncProjectId, userId, email) => {
    console.log('[addCalendarEvents] ═══════════ START ═══════════')
    console.log('[addCalendarEvents] Sync Project ID:', syncProjectId)
    console.log('[addCalendarEvents] User ID:', userId)
    console.log('[addCalendarEvents] Email:', email)
    console.log('[addCalendarEvents] Total events received:', events.length)

    const user = await getUserData(userId)
    if (!user) {
        console.log('[addCalendarEvents] ❌ User not found, aborting')
        return
    }
    console.log('[addCalendarEvents] User found, project IDs:', user.projectIds)

    // Search across ALL user projects to find existing calendar tasks
    // This prevents duplicates when users manually move tasks between projects
    const tasks = await getCalendarTasksInAllProjects(user.projectIds, userId, true)
    console.log('[addCalendarEvents] Existing calendar tasks across all projects:', tasks.length)

    const tasksMap = createTasksMap(tasks)
    console.log('[addCalendarEvents] Tasks map created, keys:', Object.keys(tasksMap).length)

    const filteredEvents = filterEvents(events, email)
    console.log('[addCalendarEvents] Events after filtering:', filteredEvents.length)
    console.log(
        '[addCalendarEvents] Filtered out:',
        events.length - filteredEvents.length,
        'events (cancelled/declined)'
    )

    const promises = []
    filteredEvents.forEach((event, idx) => {
        const existingTask = tasksMap[event.id]
        console.log(`[addCalendarEvents] Event ${idx + 1}/${filteredEvents.length}:`, {
            id: event.id,
            summary: event.summary,
            hasExistingTask: !!existingTask,
            existingTaskProject: existingTask?.projectId,
        })
        promises.push(addOrUpdateCalendarTask(syncProjectId, existingTask, event, userId, email))
    })

    console.log('[addCalendarEvents] Processing', promises.length, 'tasks (add/update)...')
    await Promise.all(promises)
    console.log('[addCalendarEvents] ✅ All tasks processed')
    console.log('[addCalendarEvents] ═══════════ END ═══════════')
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

const getTodayDoneCalendarTasksInProject = async (projectId, userId) => {
    const startOfToday = moment().startOf('day').valueOf()
    const tasksDocs = await getTasksBaseQuery(projectId, userId, true).where('completed', '>=', startOfToday).get()
    return convertDocsInTasks(projectId, tasksDocs)
}

const getCalendarTasksInProject = async (projectId, userId, includeDone = false) => {
    const promises = [getTasksBaseQuery(projectId, userId, false).get()]
    if (includeDone) {
        promises.push(getTasksBaseQuery(projectId, userId, true).get())
    }

    const results = await Promise.all(promises)
    const tasks = []
    results.forEach(snapshot => {
        tasks.push(...convertDocsInTasks(projectId, snapshot))
    })
    return tasks
}

const getCalendarTasksInAllProjects = async (projectIds, userId, needGetDoneTaks) => {
    const promises = []
    projectIds.forEach(projectId => {
        if (needGetDoneTaks) promises.push(getTodayDoneCalendarTasksInProject(projectId, userId))
        promises.push(getCalendarTasksInProject(projectId, userId))
    })
    const results = await Promise.all(promises)

    const tasks = []
    results.forEach(projectTasks => {
        tasks.push(...projectTasks)
    })
    return tasks
}

const removeCalendarTasks = async (userId, projectId, dateFormated, events, removeFromAllDates, email) => {
    console.log('[removeCalendarTasks] ═══════════ START ═══════════')
    console.log('[removeCalendarTasks] User ID:', userId)
    console.log('[removeCalendarTasks] Project ID:', projectId)
    console.log('[removeCalendarTasks] Calendar Email:', email)
    console.log('[removeCalendarTasks] Date formatted:', dateFormated)
    console.log('[removeCalendarTasks] Events count:', events.length)
    console.log('[removeCalendarTasks] Remove from all dates:', removeFromAllDates)

    const user = await getUserData(userId)
    if (!user) {
        console.log('[removeCalendarTasks] ❌ User not found, aborting')
        return
    }

    // Search across ALL user projects to find calendar tasks to potentially remove
    // This ensures we find and clean up tasks even if they were manually moved
    const tasks = await getCalendarTasksInAllProjects(user.projectIds, userId, false)
    console.log('[removeCalendarTasks] Total calendar tasks to check across all projects:', tasks.length)

    const batch = new BatchWrapper(admin.firestore())
    let tasksToDelete = 0

    tasks.forEach(task => {
        if (!task.noteId) {
            // Only consider tasks from the current calendar account
            // This prevents deleting tasks from other calendar accounts when syncing across projects
            if (email && task.calendarData && task.calendarData.email !== email) {
                return // Skip this task, it belongs to a different calendar account
            }

            const { projectId, calendarData } = task
            const { dateTime, date } = calendarData.start
            const taskDateFormatted = moment(dateTime || date).format('DDMMYYYY')

            const reasons = []
            let shouldDelete = false

            if (removeFromAllDates) {
                reasons.push('removeFromAllDates=true')
                shouldDelete = true
            } else if (taskDateFormatted !== dateFormated) {
                reasons.push(`date mismatch (task:${taskDateFormatted} vs target:${dateFormated})`)
                shouldDelete = true
            } else if (checkIfIsInvalidEvent(events, task.id)) {
                reasons.push('invalid event (not found or declined)')
                shouldDelete = true
            }

            if (shouldDelete) {
                tasksToDelete++
                console.log(`[removeCalendarTasks] DELETE task ${tasksToDelete}:`, {
                    id: task.id,
                    summary: task.name,
                    projectId,
                    email: task.calendarData?.email,
                    reasons,
                })
                batch.delete(admin.firestore().doc(`items/${projectId}/tasks/${task.id}`))
            }
        }
    })

    console.log('[removeCalendarTasks] Tasks marked for deletion:', tasksToDelete, '/', tasks.length)
    console.log('[removeCalendarTasks] Committing batch delete...')
    await batch.commit()
    console.log('[removeCalendarTasks] ✅ Batch delete committed')
    console.log('[removeCalendarTasks] ═══════════ END ═══════════')
}

module.exports = { removeCalendarTasks, generateTask, addCalendarEvents }
