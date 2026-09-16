export const START_LOADING_OPERATION = 'Start loading operation'
export const FINISH_LOADING_OPERATION = 'Finish loading operation'

// Keep older counter-based callers separate: an unrelated stop/reset must never
// retire a listener's loading operation, and a late completion must be harmless.
export const reduceLoadingData = (state, action) => {
    let operations = state.loadingDataOperations || {}
    let legacyCount = state.legacyLoadingDataCount ?? state.isLoadingData ?? 0

    switch (action.type) {
        case START_LOADING_OPERATION:
            if (operations[action.id]) return state
            operations = { ...operations, [action.id]: { source: action.source, startedAt: action.startedAt } }
            break
        case FINISH_LOADING_OPERATION:
            if (!operations[action.id]) return state
            operations = { ...operations }
            delete operations[action.id]
            break
        case 'Start loading data':
            legacyCount += action.processes > 0 ? action.processes : 1
            break
        case 'Stop loading data':
            legacyCount = Math.max(0, legacyCount - 1)
            break
        case 'Reset loading data':
            legacyCount = 0
            break
        default:
            return state
    }

    const isLoadingData = legacyCount + Object.keys(operations).length
    return {
        ...state,
        legacyLoadingDataCount: legacyCount,
        loadingDataOperations: operations,
        isLoadingData,
        showLoadingDataSpinner: isLoadingData > 0,
    }
}
