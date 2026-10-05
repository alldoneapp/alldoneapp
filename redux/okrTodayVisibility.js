export const SET_OKR_TODAY_OPERATION = 'Set OKR today operation'

export const getOkrTodayOperationKey = (userId, projectId, okrId) => JSON.stringify([userId, projectId, okrId])

export const getOkrTodayOperation = (operations, userId, projectId, okrId) =>
    operations?.[getOkrTodayOperationKey(userId, projectId, okrId)]

const getStoredValue = (user, projectId, okrId) =>
    user?.okrsHiddenInAllProjectsTodayByProjectAndOkr?.[projectId]?.[okrId] || null

// Pending Firestore snapshots are optimistic, not proof that the write succeeded.
// Keep the previous visibility until the write promise settles, including on failure
// while the listener has yet to deliver its rollback.
export const getOkrTodayVisibilityValue = (user, projectId, okrId, operation) => {
    if (operation?.status === 'saved') return operation.targetValue
    if (operation && (operation.status === 'pending' || !operation.rollbackComplete)) return operation.previousValue
    return getStoredValue(user, projectId, okrId)
}

export const reconcileOkrTodayOperations = (operations = {}, user) => {
    const result = { ...operations }
    Object.entries(operations).forEach(([key, operation]) => {
        if (operation.userId !== user?.uid) return
        const value = getStoredValue(user, operation.projectId, operation.okrId)
        if (operation.status === 'saved' && value === operation.targetValue) delete result[key]
        if (operation.status === 'error' && value === operation.previousValue) {
            result[key] = { ...operation, rollbackComplete: true }
        }
    })
    return result
}

export const reduceOkrTodayOperation = (state, action) => {
    const operations = { ...state.okrTodayOperations }
    action.operations.forEach(operation => {
        operations[getOkrTodayOperationKey(operation.userId, operation.projectId, operation.okrId)] = operation
    })
    return { ...state, okrTodayOperations: reconcileOkrTodayOperations(operations, state.loggedUser) }
}
