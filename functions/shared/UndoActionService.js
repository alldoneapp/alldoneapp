const { isEqual } = require('lodash')
const { FieldValue } = require('firebase-admin/firestore')

const ACTION_STATUS_APPLIED = 'applied'
const ACTION_STATUS_UNDONE = 'undone'
const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const MAX_OPERATIONS_PER_ACTION = 450
const SUPPORTED_OBJECT_TYPES = new Set(['task', 'chat', 'note', 'goal'])
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
    if (operation.objectType === 'goal') {
        return db.doc(`goals/${operation.projectId}/items/${operation.objectId}`)
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

// security audit 2026-11: undo records live in users/{uid}/undoActions, which the owner can write,
// and reverseAction replays them with the Admin SDK. So a record is only a REQUEST: every write it
// leads to is re-authorized here against the stored documents, mirroring the object write rules in
// firestore.rules (projects/{pid}.userIds membership, isPublicFor containing 0 or the caller before
// AND after the write, the projectId binding, and the server-owned access projection).
const ACCESS_PROJECTION_FIELDS = new Set([
    'readerIds',
    'roleIdsVisibleTo',
    'followedByVisibleTo',
    'followedReaderIds',
    'backlinkIdsVisibleTo',
])

const createPermissionError = message => {
    const error = new Error(message)
    error.code = 'permission-denied'
    return error
}

const assertProjectMember = (projectSnapshot, userId) => {
    const userIds = projectSnapshot?.exists ? projectSnapshot.data()?.userIds : null
    if (!Array.isArray(userIds) || !userIds.includes(userId)) {
        throw createPermissionError('You no longer have access to this project')
    }
}

const isVisibleTo = (userId, isPublicFor) =>
    Array.isArray(isPublicFor) && (isPublicFor.includes(0) || isPublicFor.includes(userId))

const assertObjectVisible = (userId, objectData) => {
    if (!isVisibleTo(userId, objectData?.isPublicFor)) {
        throw createPermissionError('You no longer have access to this object')
    }
}

const topLevelField = fieldPath => String(fieldPath).split('.')[0]

const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value)

const assertStatesRestorable = operation => {
    const states = [operation.before, operation.after, operation.expectedAfter, operation.requiredCurrentFields]
    const fieldLists = [operation.beforeMissingFields, operation.afterMissingFields]
    states.forEach(state => {
        if (state !== undefined && state !== null && !isPlainObject(state)) {
            throw createPermissionError('Undo action contains an invalid object state')
        }
        Object.keys(state || {}).forEach(field => {
            if (ACCESS_PROJECTION_FIELDS.has(topLevelField(field))) {
                throw createPermissionError('Undo action cannot restore server-owned fields')
            }
        })
    })
    fieldLists.forEach(fields => {
        ;(Array.isArray(fields) ? fields : []).forEach(field => {
            if (ACCESS_PROJECTION_FIELDS.has(topLevelField(field)) || topLevelField(field) === 'projectId') {
                throw createPermissionError('Undo action cannot remove server-owned fields')
            }
        })
    })
}

const assertProjectBinding = (operation, data) => {
    if (data && Object.prototype.hasOwnProperty.call(data, 'projectId') && data.projectId !== operation.projectId) {
        throw createPermissionError('Undo action cannot move an object to another project')
    }
}

const assertNonEmptyExpectedState = expected => {
    if (!isPlainObject(expected) || Object.keys(expected).length === 0) {
        throw createPermissionError('Undo action has no expected object state')
    }
}

// isPublicFor of the document as it will be after the replacement is applied.
const getResultingIsPublicFor = (currentData, replacement, replacementMissingFields) => {
    if (replacementMissingFields.includes('isPublicFor')) return null
    if (replacement && Object.prototype.hasOwnProperty.call(replacement, 'isPublicFor')) {
        return replacement.isPublicFor
    }
    return currentData?.isPublicFor
}

const getNestedValue = (objectData, fieldPath) =>
    String(fieldPath)
        .split('.')
        .reduce((value, field) => (value === undefined || value === null ? undefined : value[field]), objectData)

const matchesFields = (objectData, expectedFields = {}, missingFields = []) =>
    Object.entries(expectedFields).every(([field, expectedValue]) =>
        isEqual(getNestedValue(objectData, field), expectedValue)
    ) && missingFields.every(field => getNestedValue(objectData, field) === undefined)

const getMissingFields = (operation, state) => {
    const key = state === 'after' ? 'afterMissingFields' : 'beforeMissingFields'
    return Array.isArray(operation[key]) ? operation[key] : []
}

const getDeleteFieldValue = () => FieldValue.delete()

const buildReplacement = (fields, missingFields) => {
    const replacement = { ...fields }
    missingFields.forEach(field => {
        replacement[field] = getDeleteFieldValue()
    })
    return replacement
}

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
        operations.forEach(assertStatesRestorable)

        // Membership comes from projects/{pid}.userIds, never from the users/{uid} arrays.
        const projectIds = [...new Set(operations.map(operation => operation.projectId))]
        for (const projectId of projectIds) {
            assertProjectMember(await transaction.get(db.doc(`projects/${projectId}`)), userId)
        }

        const objectSnapshots = []
        for (const operation of operations) {
            objectSnapshots.push(await transaction.get(getObjectRef(db, operation)))
        }

        const skippedOperationIndexes = []
        const previouslySkippedIndexes = Array.isArray(action.skippedOperationIndexes)
            ? action.skippedOperationIndexes
            : []
        const mutations = []

        operations.forEach((operation, index) => {
            const snapshot = objectSnapshots[index]
            const objectRef = getObjectRef(db, operation)

            if (previouslySkippedIndexes.includes(index)) return

            if (operation.kind === 'create') {
                if (direction === 'undo') {
                    const expected = operation.expectedAfter || operation.after
                    assertNonEmptyExpectedState(expected)
                    if (!snapshot.exists || !matchesFields(snapshot.data(), expected)) {
                        throw createConflictError()
                    }
                    assertObjectVisible(userId, snapshot.data())
                    assertProjectBinding(operation, snapshot.data())
                    mutations.push(() => transaction.delete(objectRef))
                } else {
                    if (snapshot.exists) throw createConflictError()
                    // The recreated document must be one the caller could create through the rules.
                    if (!isPlainObject(operation.after)) {
                        throw createPermissionError('Undo action has no object to recreate')
                    }
                    assertObjectVisible(userId, operation.after)
                    if (operation.after.projectId !== operation.projectId && operation.objectType === 'task') {
                        throw createPermissionError('Undo action cannot move an object to another project')
                    }
                    assertProjectBinding(operation, operation.after)
                    mutations.push(() => transaction.set(objectRef, operation.after))
                }
                return
            }

            if (!snapshot.exists && operation.skipIfMissing) {
                skippedOperationIndexes.push(index)
                return
            }
            if (!snapshot.exists) throw createConflictError()
            if (operation.requiredCurrentFields && !matchesFields(snapshot.data(), operation.requiredCurrentFields)) {
                skippedOperationIndexes.push(index)
                return
            }
            assertObjectVisible(userId, snapshot.data())
            assertProjectBinding(operation, snapshot.data())
            const expected = direction === 'undo' ? operation.after : operation.before
            const replacement = direction === 'undo' ? operation.before : operation.after
            const expectedMissingFields = getMissingFields(operation, direction === 'undo' ? 'after' : 'before')
            const replacementMissingFields = getMissingFields(operation, direction === 'undo' ? 'before' : 'after')
            // An empty expected state matches any document, so it would turn the record into a
            // blind write. The caller must also still be able to see the object afterwards.
            if (Object.keys(expected || {}).length === 0 && expectedMissingFields.length === 0) {
                throw createPermissionError('Undo action has no expected object state')
            }
            assertProjectBinding(operation, replacement)
            if (!isVisibleTo(userId, getResultingIsPublicFor(snapshot.data(), replacement, replacementMissingFields))) {
                throw createPermissionError('Undo action would leave an object the caller cannot access')
            }
            if (!matchesFields(snapshot.data(), expected, expectedMissingFields)) throw createConflictError()
            mutations.push(() => transaction.update(objectRef, buildReplacement(replacement, replacementMissingFields)))
        })

        mutations.forEach(applyMutation => applyMutation())

        const changedAt = Date.now()
        transaction.update(actionRef, {
            status: nextStatus,
            lastChangedAt: changedAt,
            [direction === 'undo' ? 'undoneAt' : 'redoneAt']: changedAt,
            skippedOperationIndexes,
        })

        return {
            success: true,
            actionId,
            status: nextStatus,
            label: action.label,
            skippedOperationCount: skippedOperationIndexes.length,
        }
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
