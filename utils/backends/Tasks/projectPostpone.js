import moment from 'moment'
import v4 from 'uuid/v4'

import { runHttpsCallableFunction } from '../firestore'
import store from '../../../redux/store'
import {
    beginProjectPostpone,
    clearProjectPostpone,
    reconcileProjectPostpone,
    finishProjectPostpone,
    projectPostponeKey,
    PROJECT_POSTPONE_ECHO_TIMEOUT_MS,
} from './optimisticProjectPostpone'

const inFlight = new Map()
const loadedTasks = (state, projectId) => ({
    ...state.openTasksMap?.[projectId],
    ...state.openSubtasksMap?.[projectId],
})

export const postponeProjectTasks = (projectId, date, mode = 'date') => {
    const userId = store.getState().loggedUser?.uid
    const key = projectPostponeKey(projectId, userId)
    if (inFlight.has(key)) return inFlight.get(key)
    const requestId = v4()
    beginProjectPostpone({
        projectId,
        userId,
        requestId,
        date,
        mode,
        tasks: Object.values(loadedTasks(store.getState(), projectId)),
    })
    const unsubscribe = store.subscribe(() =>
        reconcileProjectPostpone(projectId, userId, requestId, loadedTasks(store.getState(), projectId))
    )
    let echoTimer
    const cleanup = () => {
        clearTimeout(echoTimer)
        unsubscribe()
        clearProjectPostpone(projectId, userId, requestId)
    }
    // Start the preview synchronously, then persist without foreground loading. A microtask
    // also gives the picker time to unmount and locks out repeated clicks/reopened popups.
    const operation = Promise.resolve()
        .then(() =>
            runHttpsCallableFunction('postponeProjectTasksWithUndoSecondGen', {
                projectId,
                mode,
                ...(mode === 'date' ? { date } : {}),
                timezoneOffset: moment().utcOffset(),
                requestId,
            })
        )
        .then(result => {
            finishProjectPostpone(projectId, userId, requestId)
            if (!result?.updatedTaskCount) cleanup()
            else echoTimer = setTimeout(cleanup, PROJECT_POSTPONE_ECHO_TIMEOUT_MS)
            return result
        })
        .catch(error => {
            cleanup()
            throw error
        })
        .finally(() => inFlight.delete(key))
    inFlight.set(key, operation)
    return operation
}
