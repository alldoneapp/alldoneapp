export const shouldClientWriteTaskTransitionStatistics = (taskOwnerUid, actorId) =>
    !!taskOwnerUid && !!actorId && taskOwnerUid === actorId

export const buildCrossUserTaskStatisticsMarker = (taskOwnerUid, actorId, completed, createId) => {
    if (!taskOwnerUid || !actorId || taskOwnerUid === actorId || typeof createId !== 'function') return {}
    return {
        taskStatisticsTransition: {
            id: createId(),
            actorId,
            ownerId: taskOwnerUid,
            ...(Number.isFinite(completed) ? { completed } : {}),
        },
    }
}
