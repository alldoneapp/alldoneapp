export const resolveFollowUpGoalLink = async ({ projectId, sourceTask, loadGoal, onGoalReadError }) => {
    const parentGoalId = sourceTask.parentGoalId || null
    if (!parentGoalId) return { parentGoalId: null, parentGoalIsPublicFor: null }

    if (Array.isArray(sourceTask.parentGoalIsPublicFor)) {
        return {
            parentGoalId,
            parentGoalIsPublicFor: [...sourceTask.parentGoalIsPublicFor],
        }
    }

    try {
        const goal = await loadGoal(projectId, parentGoalId)
        return {
            parentGoalId,
            parentGoalIsPublicFor: Array.isArray(goal?.isPublicFor) ? [...goal.isPublicFor] : null,
        }
    } catch (error) {
        onGoalReadError?.(error)
        return { parentGoalId, parentGoalIsPublicFor: null }
    }
}

export const buildFollowUpTask = ({ defaultTask, sourceTask, taskId, creatorId, dueDate, goalLink }) => {
    const sourceParentGoalId = sourceTask.parentGoalId || null
    const resolvedGoalLink = goalLink || {
        parentGoalId: sourceParentGoalId,
        parentGoalIsPublicFor:
            sourceParentGoalId && Array.isArray(sourceTask.parentGoalIsPublicFor)
                ? [...sourceTask.parentGoalIsPublicFor]
                : null,
    }

    return {
        ...defaultTask,
        id: taskId,
        creatorId,
        dueDate,
        hasStar: sourceTask.hasStar,
        isPrivate: sourceTask.isPrivate,
        isPublicFor: sourceTask.isPublicFor,
        name: `#FollowUp ${sourceTask.name.replace(/#FollowUp/g, '')}`.toLowerCase(),
        extendedName: `#FollowUp ${(sourceTask.extendedName || sourceTask.name).replace(/#FollowUp/g, '')}`,
        userId: sourceTask.userId,
        userIds: [sourceTask.userId],
        currentReviewerId: sourceTask.userId,
        observersIds: sourceTask.observersIds,
        dueDateByObserversIds: sourceTask.dueDateByObserversIds,
        estimationsByObserverIds: sourceTask.estimationsByObserverIds,
        linkedParentTasksIds: sourceTask.linkedParentTasksIds,
        linkedParentNotesIds: sourceTask.linkedParentNotesIds,
        ...resolvedGoalLink,
        lockKey: sourceTask.lockKey,
        timesFollowed: sourceTask.timesFollowed ? sourceTask.timesFollowed + 1 : 1,
        commentsData: null,
        followUpSourceTaskId: sourceTask.id,
        ...(sourceTask.noteId && { noteId: sourceTask.noteId }),
    }
}
