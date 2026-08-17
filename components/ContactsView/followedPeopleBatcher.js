const DEFAULT_BATCH_DELAY = 16

export const getProjectsForFollowedPeopleWatch = (inFollowedTab, selectedProjectIndex, projects) => {
    if (!inFollowedTab) return []
    return selectedProjectIndex >= 0 ? [projects[selectedProjectIndex]].filter(Boolean) : projects
}

/**
 * Firestore delivers one initial following snapshot per project. Without a small batch,
 * a large All Projects account renders the complete Contacts tree once per snapshot.
 */
export const createFollowedPeopleBatcher = (
    onFlush,
    schedule = callback => setTimeout(callback, DEFAULT_BATCH_DELAY),
    cancelScheduled = clearTimeout
) => {
    let pendingByProject = {}
    let scheduledFlush = null

    const flush = () => {
        scheduledFlush = null
        const updates = pendingByProject
        pendingByProject = {}
        onFlush(updates)
    }

    return {
        add(projectId, followedPeople) {
            pendingByProject[projectId] = followedPeople
            if (scheduledFlush === null) scheduledFlush = schedule(flush)
        },
        cancel() {
            if (scheduledFlush !== null) cancelScheduled(scheduledFlush)
            scheduledFlush = null
            pendingByProject = {}
        },
    }
}
