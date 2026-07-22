export const compareWorkflowEntries = (a, b) => {
    const aSortIndex = a[1] && a[1].sortIndex
    const bSortIndex = b[1] && b[1].sortIndex
    const aHasSortIndex = Number.isFinite(aSortIndex)
    const bHasSortIndex = Number.isFinite(bSortIndex)

    // Workflow steps historically had no explicit position and were ordered by their push IDs.
    // Reordered workflows persist a sortIndex; steps without one (including newly-added steps)
    // stay after explicitly ordered steps and retain their legacy chronological order.
    if (aHasSortIndex || bHasSortIndex) {
        if (!aHasSortIndex) return 1
        if (!bHasSortIndex) return -1
        if (aSortIndex !== bSortIndex) return aSortIndex - bSortIndex
    }

    return a[0] < b[0] ? -1 : 1
}

export const getWorkflowStepsIdsSorted = workflow => {
    // A user without a project workflow is represented as null by getUserWorkflow.
    // Only normalize that legitimate absence; unexpected non-null values should still fail normally.
    if (workflow == null) return []

    return Object.entries(workflow)
        .sort(compareWorkflowEntries)
        .map(([stepId]) => stepId)
}

export const getWorkflowSortIndexUpdates = (projectId, orderedStepIds) =>
    orderedStepIds.reduce((updates, stepId, sortIndex) => {
        updates[`workflow.${projectId}.${stepId}.sortIndex`] = sortIndex
        return updates
    }, {})
