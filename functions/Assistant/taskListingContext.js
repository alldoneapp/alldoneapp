// Task counts describe the query, not the excerpt that happens to fit in model context.
function withTaskListingMetadata(result) {
    const shownCount = result.tasks.length
    const count = Math.max(Number(result.count) || 0, shownCount)
    const hasTotal = Number.isInteger(result.totalCount) && result.totalCount >= count
    const totalCount = hasTotal ? result.totalCount : count
    const totalCountIsExact = hasTotal && result.totalCountIsExact === true && !result.retrieval?.resultsAreIncomplete
    const hasMore = result.hasMore === true || totalCount > shownCount ? true : totalCountIsExact ? false : null
    const listingComplete = totalCountIsExact && hasMore === false

    return {
        ...result,
        count,
        totalCount,
        totalCountIsExact,
        shownCount,
        hasMore,
        listingComplete,
        countGuidance: totalCountIsExact
            ? 'Use totalCount for the task total. shownCount is only the visible list; if listingComplete is false, label it as partial.'
            : 'totalCount is a lower bound, not an exact total. The task list is incomplete; say so explicitly.',
    }
}

function compactTaskListing(result, maxBytes) {
    // Strip comments and other historical detail before omitting any task identities.
    const compact = {
        tasks: [],
        count: result.count ?? result.tasks.length,
        totalCount: result.totalCount,
        totalCountIsExact: result.totalCountIsExact,
        hasMore: result.hasMore,
        ...(result.scope ? { scope: result.scope } : {}),
        ...(result.retrieval?.resultsAreIncomplete
            ? { retrieval: { resultsAreIncomplete: true, projectsFailed: result.retrieval.projectsFailed } }
            : {}),
        contextTruncated: true,
        taskDetailsOmitted: true,
    }
    const clip = (value, length) =>
        typeof value === 'string' && value.length > length ? `${value.slice(0, length)}…` : value
    const tasks = result.tasks.filter(task => task && typeof task === 'object')
    for (const task of tasks) {
        const summary = {
            id: task.id,
            humanReadableId: task.humanReadableId || undefined,
            name: clip(task.name, 240),
            projectName: clip(task.projectName, 100),
            completed: task.completed,
            dueDate: task.dueDate || undefined,
            completedAt: task.completedAt || undefined,
            calendarTime: task.calendarTime || undefined,
            isOwnedByRequestingUser: task.isOwnedByRequestingUser,
            // Ownership must remain unambiguous for shared/project queries.
            ownerUserId: task.isOwnedByRequestingUser === true ? undefined : task.ownerUserId,
            isFocus: task.isFocus || undefined,
            priority: task.priority && task.priority !== 'none' ? task.priority : undefined,
        }
        compact.tasks.push(summary)
        if (Buffer.byteLength(JSON.stringify(withTaskListingMetadata(compact)), 'utf8') > maxBytes) {
            compact.tasks.pop()
            break
        }
    }
    return withTaskListingMetadata(compact)
}

module.exports = { withTaskListingMetadata, compactTaskListing }
