// The settle delay is intentionally longer than the largest allowed inter-action gap. A burst can
// therefore never render as a single action and later grow into a summary (banner flicker + a
// second screen-reader announcement).
export const UNDO_BURST_SETTLE_MS = 600
export const UNDO_BURST_MAX_GAP_MS = 500
export const UNDO_BURST_MAX_SPAN_MS = 2000

const numericTime = value => (Number.isFinite(value) ? value : 0)

const operationShape = operation => {
    const beforeMissingFields = Array.isArray(operation?.beforeMissingFields) ? operation.beforeMissingFields : []
    const afterMissingFields = Array.isArray(operation?.afterMissingFields) ? operation.afterMissingFields : []
    const fields = new Set([
        ...Object.keys(operation?.before || {}),
        ...Object.keys(operation?.after || {}),
        ...beforeMissingFields,
        ...afterMissingFields,
    ])
    return [
        operation?.projectId || '',
        operation?.objectType || '',
        operation?.kind || '',
        [...fields].sort().join(','),
    ].join(':')
}

/**
 * A burst boundary is deliberately based on persisted mutation data, not on the human label.
 * Labels can be translated or contain object names. Two records may share a burst only when they
 * came from the same actor/source and changed the same kind of fields on the same object type in
 * the same project. The operation count is omitted so a one-task action can sit beside a bulk
 * action of the same kind, while the unique operation shapes keep compound actions atomic.
 */
export const buildUndoGroupingKey = ({ actorId, source = 'ui', operations = [] }) => {
    const shapes = [...new Set(operations.map(operationShape))].sort()
    return `${actorId || ''}|${source}|${shapes.join('|')}`
}

const groupingKeyFor = action =>
    action?.groupKey ||
    buildUndoGroupingKey({ actorId: action?.actorId, source: action?.source, operations: action?.operations })

const isUnexpired = (action, now) => !action?.expiresAt || action.expiresAt > now

/**
 * Returns the newest compatible burst. Actions are kept as whole records: an action containing a
 * goal and its linked tasks is one indivisible member of the group and is never flattened.
 */
export const buildUndoActionGroup = (actions, now = Date.now()) => {
    const ordered = (Array.isArray(actions) ? actions : [])
        .filter(action => action?.actionId && isUnexpired(action, now))
        .sort((first, second) => numericTime(second.createdAt) - numericTime(first.createdAt))

    const newest = ordered[0]
    if (!newest) return null

    const key = groupingKeyFor(newest)
    const grouped = [newest]
    let previousCreatedAt = numericTime(newest.createdAt)

    for (const candidate of ordered.slice(1)) {
        const candidateCreatedAt = numericTime(candidate.createdAt)
        const gap = previousCreatedAt - candidateCreatedAt
        if (
            candidate.status !== newest.status ||
            groupingKeyFor(candidate) !== key ||
            gap < 0 ||
            gap > UNDO_BURST_MAX_GAP_MS ||
            numericTime(newest.createdAt) - candidateCreatedAt > UNDO_BURST_MAX_SPAN_MS
        ) {
            break
        }
        grouped.push(candidate)
        previousCreatedAt = candidateCreatedAt
    }

    return {
        id: grouped.map(action => action.actionId).join('|'),
        status: newest.status,
        actions: grouped,
        newestCreatedAt: numericTime(newest.createdAt),
        newestChangedAt: Math.max(...grouped.map(action => numericTime(action.lastChangedAt))),
    }
}

/**
 * Reverses a group in dependency-safe order. Undo goes newest -> oldest; redo reapplies the
 * original chronology. If a member fails, already reversed members are compensated in the exact
 * opposite order. Server-side optimistic checks still guard every atomic member.
 */
export const reverseUndoActionGroup = async (actions, direction, reverseAction) => {
    const ordered = [...actions].sort((first, second) => numericTime(first.createdAt) - numericTime(second.createdAt))
    const targets = direction === 'undo' ? ordered.reverse() : ordered
    const completed = []

    try {
        for (const action of targets) {
            await reverseAction(action.actionId, direction)
            completed.push(action)
        }
    } catch (error) {
        const compensationDirection = direction === 'undo' ? 'redo' : 'undo'
        let compensationError = null
        for (const action of [...completed].reverse()) {
            try {
                await reverseAction(action.actionId, compensationDirection)
            } catch (rollbackError) {
                compensationError = compensationError || rollbackError
            }
        }
        error.compensationFailed = Boolean(compensationError)
        error.compensationError = compensationError
        error.completedActionIds = completed.map(action => action.actionId)
        throw error
    }

    return { actionIds: completed.map(action => action.actionId), direction }
}
