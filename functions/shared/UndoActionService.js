const { isEqual } = require('lodash')

const ACTION_STATUS_APPLIED = 'applied'
const ACTION_STATUS_UNDONE = 'undone'
const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const MAX_OPERATIONS_PER_ACTION = 100
const SUPPORTED_OBJECT_TYPES = new Set(['task', 'chat', 'note'])
const SUPPORTED_OPERATION_KINDS = new Set(['update', 'create'])

const getActionRef = (db, userId, actionId) => db.doc(`users/${userId}/undoActions/${actionId}`)

const getObjectRef = (db, operation) => {
    if (operation.objectType === 'task') {
        return db.doc(`items/${operation.projectId}/tasks/${operation.objectId}`)
    }
    if (operation.objectType === 'chat') {
        return db.doc(`chatObjects/${operation.projectId}/chats/${operation.objectId}`)
    }
    if (operation.objectType === 'note') {
        return db.doc(`noteItems/${operation.projectId}/notes/${operation.objectId}`)
    }
    throw new Error(`Unsupported undo object type: ${operation.objectType}`)
}

const assertSupportedOperation = operation => {
    if (!operation || !SUPPORTED_OBJECT_TYPES.has(operation.objectType)) {
        throw new Error('Undo action contains an unsupported object type')
    }
    if (!SUPPORTED_OPERATION_KINDS.has(operation.kind)) {
        throw new Error('Undo action contains an unsupported operation kind')
    }
    if (!operation.projectId || !operation.objectId) {
        throw new Error('Undo action contains an invalid object reference')
    }
}

const assertProjectAccess = (user, projectId) => {
    const projectIds = [
        ...(user.projectIds || []),
        ...(user.guideProjectIds || []),
        ...(user.templateProjectIds || []),
        ...(user.archivedProjectIds || []),
    ]
    if (!projectIds.includes(projectId)) {
        const error = new Error('You no longer have access to this project')
        error.code = 'permission-denied'
        throw error
    }
}

const assertObjectVisible = (userId, objectData) => {
    const isPublicFor = Array.isArray(objectData?.isPublicFor) ? objectData.isPublicFor : []
    if (!isPublicFor.includes(0) && !isPublicFor.includes(userId)) {
        const error = new Error('You no longer have access to this object')
        error.code = 'permission-denied'
        throw error
    }
}

const matchesFields = (objectData, expectedFields = {}) =>
    Object.entries(expectedFields).every(([field, expectedValue]) => isEqual(objectData?.[field], expectedValue))

const createConflictError = () => {
    const error = new Error('This action cannot be reversed because the object changed again')
    error.code = 'failed-precondition'
    return error
}

const createUndoActionRecord = ({
    actionId,
    initiatorId,
    actorId,
    source = 'ui',
    label,
    operations,
    createdAt = Date.now(),
    expiresAt = createdAt + DEFAULT_RETENTION_MS,
}) => ({
    actionId,
    initiatorId,
    actorId: actorId || initiatorId,
    source,
    label,
    operations,
    createdAt,
    expiresAt,
    status: ACTION_STATUS_APPLIED,
    lastChangedAt: createdAt,
})

async function reverseAction({ db, userId, actionId, direction }) {
    if (!db || !userId || !actionId) throw new Error('Database, user ID and action ID are required')
    if (direction !== 'undo' && direction !== 'redo') throw new Error('Direction must be undo or redo')

    const actionRef = getActionRef(db, userId, actionId)
    const userRef = db.doc(`users/${userId}`)

    return db.runTransaction(async transaction => {
        const [actionSnapshot, userSnapshot] = await Promise.all([transaction.get(actionRef), transaction.get(userRef)])
        if (!actionSnapshot.exists) {
            const error = new Error('Undo action was not found')
            error.code = 'not-found'
            throw error
        }
        if (!userSnapshot.exists) {
            const error = new Error('User was not found')
            error.code = 'permission-denied'
            throw error
        }

        const action = actionSnapshot.data()
        if (action.initiatorId !== userId) {
            const error = new Error("You cannot reverse another user's action")
            error.code = 'permission-denied'
            throw error
        }
        if (action.expiresAt && action.expiresAt < Date.now()) {
            const error = new Error('This undo action has expired')
            error.code = 'failed-precondition'
            throw error
        }

        const expectedStatus = direction === 'undo' ? ACTION_STATUS_APPLIED : ACTION_STATUS_UNDONE
        const nextStatus = direction === 'undo' ? ACTION_STATUS_UNDONE : ACTION_STATUS_APPLIED
        if (action.status !== expectedStatus) {
            return { success: true, actionId, status: action.status, alreadyApplied: true, label: action.label }
        }

        const operations = Array.isArray(action.operations) ? action.operations : []
        if (operations.length === 0) throw new Error('Undo action has no operations')
        if (operations.length > MAX_OPERATIONS_PER_ACTION) {
            throw new Error('Undo action contains too many operations')
        }
        operations.forEach(assertSupportedOperation)
        operations.forEach(operation => assertProjectAccess(userSnapshot.data(), operation.projectId))

        const objectSnapshots = []
        for (const operation of operations) {
            objectSnapshots.push(await transaction.get(getObjectRef(db, operation)))
        }

        operations.forEach((operation, index) => {
            const snapshot = objectSnapshots[index]
            const objectRef = getObjectRef(db, operation)

            if (operation.kind === 'create') {
                if (direction === 'undo') {
                    if (
                        !snapshot.exists ||
                        !matchesFields(snapshot.data(), operation.expectedAfter || operation.after)
                    ) {
                        throw createConflictError()
                    }
                    assertObjectVisible(userId, snapshot.data())
                    transaction.delete(objectRef)
                } else {
                    if (snapshot.exists) throw createConflictError()
                    transaction.set(objectRef, operation.after)
                }
                return
            }

            if (!snapshot.exists) throw createConflictError()
            assertObjectVisible(userId, snapshot.data())
            const expected = direction === 'undo' ? operation.after : operation.before
            const replacement = direction === 'undo' ? operation.before : operation.after
            if (!matchesFields(snapshot.data(), expected)) throw createConflictError()
            transaction.update(objectRef, replacement)
        })

        const changedAt = Date.now()
        transaction.update(actionRef, {
            status: nextStatus,
            lastChangedAt: changedAt,
            [direction === 'undo' ? 'undoneAt' : 'redoneAt']: changedAt,
        })

        return { success: true, actionId, status: nextStatus, label: action.label }
    })
}

async function cleanupExpiredUndoActions(db, now = Date.now()) {
    const snapshot = await db.collectionGroup('undoActions').where('expiresAt', '<', now).limit(500).get()
    if (snapshot.empty) return { deleted: 0 }

    const batch = db.batch()
    snapshot.docs.forEach(document => batch.delete(document.ref))
    await batch.commit()
    return { deleted: snapshot.size }
}

module.exports = {
    ACTION_STATUS_APPLIED,
    ACTION_STATUS_UNDONE,
    DEFAULT_RETENTION_MS,
    MAX_OPERATIONS_PER_ACTION,
    cleanupExpiredUndoActions,
    createUndoActionRecord,
    reverseAction,
}
