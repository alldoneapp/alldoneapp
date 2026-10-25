import store from '../../../redux/store'
import {
    SET_OKR_TODAY_OPERATION,
    getOkrTodayOperation,
    getOkrTodayVisibilityValue,
} from '../../../redux/okrTodayVisibility'

// Redux owns the operation, rather than a row that can unmount on a local
// snapshot or navigation. Synchronous dispatch also locks same-tick clicks.
export const persistOkrTodayVisibility = async (userId, projectId, okrIds, targetValue, write) => {
    const state = store.getState()
    const ids = [...new Set(okrIds)]
    if (
        ids.some(okrId => {
            const operation = getOkrTodayOperation(state.okrTodayOperations, userId, projectId, okrId)
            return (
                operation?.status === 'pending' ||
                (operation?.status === 'saved' && operation.targetValue === targetValue)
            )
        })
    )
        return false // Suppressed clicks do not acknowledge a write.

    const operations = ids.map(okrId => ({
        userId,
        projectId,
        okrId,
        targetValue,
        previousValue: getOkrTodayVisibilityValue(
            state.loggedUser,
            projectId,
            okrId,
            getOkrTodayOperation(state.okrTodayOperations, userId, projectId, okrId)
        ),
        status: 'pending',
    }))
    const setStatus = status =>
        store.dispatch({
            type: SET_OKR_TODAY_OPERATION,
            operations: operations.map(operation => ({ ...operation, status })),
        })
    setStatus('pending')
    try {
        await write()
        setStatus('saved')
        return true
    } catch (error) {
        setStatus('error')
        throw error
    }
}
