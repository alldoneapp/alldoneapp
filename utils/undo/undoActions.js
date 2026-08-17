import firebase from 'firebase/compat/app'

import store from '../../redux/store'
import { isBrowserOffline } from '../connectionState'

export const UNDO_ACTION_STATUS_APPLIED = 'applied'
export const UNDO_ACTION_STATUS_UNDONE = 'undone'
export const UNDO_ACTION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export const MAX_UNDO_OPERATIONS = 100

const cleanValue = value => {
    if (value === undefined) return undefined
    if (Array.isArray(value)) return value.map(cleanValue).filter(item => item !== undefined)
    if (
        value &&
        Object.prototype.toString.call(value) === '[object Object]' &&
        (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
    ) {
        return Object.entries(value).reduce((result, [key, nestedValue]) => {
            const cleaned = cleanValue(nestedValue)
            if (cleaned !== undefined) result[key] = cleaned
            return result
        }, {})
    }
    return value
}

export const buildTaskUpdateOperation = (projectId, taskId, before, after) => ({
    objectType: 'task',
    projectId,
    objectId: taskId,
    kind: 'update',
    before: cleanValue(before),
    after: cleanValue(after),
})

export const buildObjectUpdateOperation = (objectType, projectId, objectId, before, after) => ({
    objectType,
    projectId,
    objectId,
    kind: 'update',
    before: cleanValue(before),
    after: cleanValue(after),
})

export const buildTaskCreateOperation = (projectId, taskId, task) => ({
    objectType: 'task',
    projectId,
    objectId: taskId,
    kind: 'create',
    before: null,
    after: cleanValue(task),
    expectedAfter: cleanValue({
        creatorId: task.creatorId,
        created: task.created,
        name: task.name,
    }),
})

export const queueUndoAction = ({ label, operations, batch, source = 'ui', actorId }) => {
    const loggedUser = store.getState().loggedUser || {}
    if (
        !loggedUser.uid ||
        !Array.isArray(operations) ||
        operations.length === 0 ||
        operations.length > MAX_UNDO_OPERATIONS
    ) {
        return null
    }

    const db = firebase.firestore()
    const actionRef = db.collection(`users/${loggedUser.uid}/undoActions`).doc()
    const createdAt = Date.now()
    const action = {
        actionId: actionRef.id,
        initiatorId: loggedUser.uid,
        actorId: actorId || loggedUser.uid,
        source,
        label,
        operations: cleanValue(operations),
        createdAt,
        expiresAt: createdAt + UNDO_ACTION_RETENTION_MS,
        status: UNDO_ACTION_STATUS_APPLIED,
        lastChangedAt: createdAt,
    }

    if (batch) {
        batch.set(actionRef, action)
        batch.currentUndoActionId = actionRef.id
    } else {
        actionRef.set(action)
    }
    return action
}

/**
 * Undo/redo is entirely server-side (the callable rewrites the objects and flips
 * the action's status), so offline there is nothing to queue — the request has
 * to fail, and it should fail NOW rather than after the callable SDK's ~70s
 * timeout with the undo bar stuck (AT-2340).
 *
 * This module is deliberately a leaf (firebase + redux only) because the write
 * paths import it; it therefore repeats the funnel's typed offline error rather
 * than importing `runHttpsCallableFunction` from `utils/backends/firestore` and
 * creating an import cycle. The error shape is identical, so callers that branch
 * on `error.code === 'offline'` work either way.
 */
export const reverseUndoAction = (actionId, direction) => {
    if (isBrowserOffline()) {
        const offlineError = new Error('Undo needs an internet connection')
        offlineError.code = 'offline'
        return Promise.reject(offlineError)
    }
    const callable = firebase.app().functions('europe-west1').httpsCallable('reverseUndoActionSecondGen')
    return callable({ actionId, direction }).then(result => result?.data || result)
}
