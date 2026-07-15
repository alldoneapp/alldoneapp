const hasOwn = (object, field) => Object.prototype.hasOwnProperty.call(object || {}, field)

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

/**
 * Builds the field-level operation used by the shared undo service. Missing fields are
 * recorded separately so undo restores the Firestore document exactly instead of
 * replacing an absent value with null.
 */
export const buildTaskStateUndoOperation = (projectId, taskId, beforeState, afterChanges, afterMissingFields = []) => {
    if (!beforeState || !afterChanges) return null

    const fields = Array.from(new Set([...Object.keys(afterChanges), ...afterMissingFields]))
    const before = {}
    const after = {}
    const beforeMissingFields = []
    const normalizedAfterMissingFields = []

    fields.forEach(field => {
        if (hasOwn(beforeState, field)) {
            const value = cleanValue(beforeState[field])
            if (value === undefined) beforeMissingFields.push(field)
            else before[field] = value
        } else {
            beforeMissingFields.push(field)
        }

        if (afterMissingFields.includes(field) || !hasOwn(afterChanges, field)) {
            normalizedAfterMissingFields.push(field)
        } else {
            const value = cleanValue(afterChanges[field])
            if (value === undefined) normalizedAfterMissingFields.push(field)
            else after[field] = value
        }
    })

    return {
        objectType: 'task',
        projectId,
        objectId: taskId,
        kind: 'update',
        before,
        after,
        ...(beforeMissingFields.length > 0 ? { beforeMissingFields } : {}),
        ...(normalizedAfterMissingFields.length > 0 ? { afterMissingFields: normalizedAfterMissingFields } : {}),
    }
}

export const buildTaskStateUndoOperations = (projectId, beforeStates, taskChanges) =>
    taskChanges
        .map(({ taskId, afterChanges, afterMissingFields }) =>
            buildTaskStateUndoOperation(projectId, taskId, beforeStates[taskId], afterChanges, afterMissingFields)
        )
        .filter(Boolean)
