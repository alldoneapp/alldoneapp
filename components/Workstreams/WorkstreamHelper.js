import { cloneDeep, findIndex } from 'lodash'

import store from '../../redux/store'
import { setGlobalDataByProject, setTaskListWatchersVars, setWorkstreamsInProject } from '../../redux/actions'
import { exitsOpenModals } from '../ModalsManager/modalsManager'
import TasksHelper from '../TaskListView/Utils/TasksHelper'
import { removeWatchersForOneStreamAndUser, STREAM_AND_USER_TASKS_INDEX } from '../../utils/backends/openTasks'
import { updateWorkstreamLastVisitedBoardDate } from '../../utils/backends/Workstreams/workstreamsFirestore'
import { PROJECT_DATA_WORKSTREAMS, requestProjectDataOnLookupMiss } from '../../utils/InitialLoad/projectDataLoader'

import { DEFAULT_WORKSTREAM_ID, WORKSTREAM_ID_PREFIX } from './WorkstreamConstants'

export { WORKSTREAM_ID_PREFIX, DEFAULT_WORKSTREAM_ID }

export const getDefaultMainWorkstream = (projectId, creatorId) => {
    const workstream = getNewDefaultWorkstream(projectId, creatorId)
    workstream.uid = DEFAULT_WORKSTREAM_ID
    workstream.displayName = 'Team'
    workstream.description = 'Default workstream to gather general project tasks'
    return workstream
}

export const getNewDefaultWorkstream = (projectId, creatorId) => {
    const date = Date.now()

    const lastVisitBoard = { [projectId]: { [creatorId]: date } }

    return {
        displayName: '',
        description: '',
        projectId,
        lastVisitBoard,
        lastVisitBoardInGoals: lastVisitBoard,
        userIds: [creatorId],
        created: date,
        creatorId,
        lastEditionDate: date,
        lastEditorId: creatorId,
        photoURL: DEFAULT_WORKSTREAM_ID,
    }
}

export const setWorkstreamLastVisitedBoardDate = (projectId, workstream, lastVisitBoardProperty) => {
    const { loggedUser, projectWorkstreams } = store.getState()

    const updatedWorkstream = {
        ...workstream,
        [lastVisitBoardProperty]: {
            ...workstream?.[lastVisitBoardProperty],
            [projectId]: {
                ...workstream?.[lastVisitBoardProperty]?.[projectId],
                [loggedUser.uid]: Date.now(),
            },
        },
    }

    // AT-2386: the slice is filled on demand, so skip the optimistic update when it cannot be
    // applied faithfully instead of spreading `undefined` or writing to the key "-1".
    const workstreamsInProject = projectWorkstreams[projectId]
    const index = Array.isArray(workstreamsInProject)
        ? workstreamsInProject.findIndex(ws => ws.uid === workstream.uid)
        : -1

    if (index !== -1) {
        const updatedWorkstreams = [...workstreamsInProject]
        updatedWorkstreams[index] = updatedWorkstream
        store.dispatch(setWorkstreamsInProject(projectId, updatedWorkstreams))
    }

    updateWorkstreamLastVisitedBoardDate(projectId, workstream.uid, lastVisitBoardProperty)
}

export const getWorkstreamById = (projectId, wstreamId) => {
    const { projectWorkstreams } = store.getState()
    const streamIndex = findIndex(projectWorkstreams[projectId] || [], ['uid', wstreamId])
    const workstream = streamIndex !== -1 ? projectWorkstreams[projectId]?.[streamIndex] || null : null
    // AT-2386: workstreams are no longer loaded for every project at login, so a miss can mean
    // "not requested yet". Reported here, in the single lookup funnel, so the rest of the app is
    // unchanged; the row fills in once the watcher's first snapshot lands.
    if (!workstream) requestProjectDataOnLookupMiss(projectId, PROJECT_DATA_WORKSTREAMS)
    return workstream
}

export const isWorkstream = id => {
    return id.startsWith(WORKSTREAM_ID_PREFIX)
}

export const getWorkstreamUserIds = (projectId, wstreamId) => {
    const workstream = getWorkstreamById(projectId, wstreamId)
    // AT-2386: `getWorkstreamById` could always return null (deleted workstream) and this
    // dereferenced it; with on-demand loading a not-yet-loaded project reaches it too.
    return workstream?.userIds || []
}

export const getWorkstreamMembers = (projectId, wstreamId, withData = false) => {
    if (isWorkstream(wstreamId)) {
        const stream = getWorkstreamById(projectId, wstreamId)
        return stream != null
            ? withData
                ? stream.userIds.map(uid => TasksHelper.getUserInProject(projectId, uid))
                : stream.userIds
            : []
    }
    return []
}

export const getWorkstreamInProject = (projectId, workstreamId) => {
    const { projectWorkstreams } = store.getState()

    const workstreams = projectWorkstreams[projectId]
    if (workstreams?.length > 0) {
        for (let n = 0; n < workstreams.length; n++) {
            if (workstreams[n].uid === workstreamId) {
                return workstreams[n]
            }
        }
    }

    return null
}

export const isSomeStreamEditOpen = () => {
    const edits = document.querySelectorAll('[data-edit-workstream]')
    return edits.length > 0 || exitsOpenModals()
}

export const cleanDataWhenRemoveWorkstreamMember = (projectId, currentUserId, userId, openTasks, updateOpenTaks) => {
    const { globalDataByProject, taskListWatchersVars } = store.getState()

    // REMOVE WATCHERS
    removeWatchersForOneStreamAndUser(projectId, currentUserId, userId)

    // REMOVE TASKS FROM LOCAL IN THE LIST VIEW
    const updatedTasks = cloneDeep(openTasks)
    for (let date in updatedTasks) {
        for (let uIndex in updatedTasks[date][STREAM_AND_USER_TASKS_INDEX]) {
            if (updatedTasks[date][STREAM_AND_USER_TASKS_INDEX][uIndex][0] === userId) {
                updatedTasks[date][STREAM_AND_USER_TASKS_INDEX].splice(uIndex, 1)
            }
        }
    }
    updateOpenTaks(updatedTasks)

    // REMOVE RECORDS FROM REDUX
    const globalData = {
        ...globalDataByProject[projectId],
        storedTasks: taskListWatchersVars.storedTasks,
        estimationByDate: taskListWatchersVars.estimationByDate,
        amountOfTasksByDate: taskListWatchersVars.amountOfTasksByDate,
        tasksMap: taskListWatchersVars.tasksMap,
        subtasksByParentId: taskListWatchersVars.subtasksByParentId,
        subtasksMap: taskListWatchersVars.subtasksMap,
    }

    // stored task
    for (let date in globalData.storedTasks) {
        let tasks = 0

        const collection = globalData.storedTasks[date][STREAM_AND_USER_TASKS_INDEX]

        for (let innerUserId in collection) {
            if (innerUserId === userId) {
                tasks += collection[innerUserId][0].length
            }
        }

        for (let innerUserId in collection) {
            if (innerUserId === userId) {
                delete globalData.storedTasks[date][STREAM_AND_USER_TASKS_INDEX][innerUserId]
            }
        }

        if (globalData.amountOfTasksByDate?.[date]) globalData.amountOfTasksByDate[date] -= tasks
    }

    store.dispatch(setTaskListWatchersVars({ ...taskListWatchersVars, ...globalData }))
    store.dispatch(setGlobalDataByProject({ ...globalDataByProject, [projectId]: globalData }))
}
