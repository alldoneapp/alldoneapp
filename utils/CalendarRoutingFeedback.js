export const CALENDAR_PROJECT_ROUTING_FEEDBACK_VERSION = 1
export const CALENDAR_GOAL_ROUTING_FEEDBACK_VERSION = 1

const normalizeId = value => (typeof value === 'string' ? value.trim() : '')

/**
 * Builds the durable marker consumed by the server-side calendar-routing feedback trigger.
 * The marker travels with the copied task, so an offline move still teaches routing once
 * Firestore reconnects and creates the task in its destination project.
 */
export function buildCalendarProjectRoutingFeedback({
    task,
    sourceProjectId,
    targetProjectId,
    requestedByUserId,
    feedbackId,
    requestedAt = Date.now(),
} = {}) {
    const calendarData = task?.calendarData
    if (!calendarData || typeof calendarData !== 'object') return null

    const normalizedSourceProjectId = normalizeId(sourceProjectId || task?.projectId)
    const normalizedTargetProjectId = normalizeId(targetProjectId)
    const normalizedRequestedByUserId = normalizeId(requestedByUserId)
    const normalizedFeedbackId = normalizeId(feedbackId)
    const syncProjectId = normalizeId(
        calendarData.originalProjectId || calendarData.projectRouting?.syncProjectId || normalizedSourceProjectId
    )

    if (
        !syncProjectId ||
        !normalizedSourceProjectId ||
        !normalizedTargetProjectId ||
        !normalizedRequestedByUserId ||
        !normalizedFeedbackId ||
        normalizedSourceProjectId === normalizedTargetProjectId
    ) {
        return null
    }

    return {
        version: CALENDAR_PROJECT_ROUTING_FEEDBACK_VERSION,
        feedbackId: normalizedFeedbackId,
        requestedAt: Number.isFinite(requestedAt) ? Number(requestedAt) : Date.now(),
        requestedByUserId: normalizedRequestedByUserId,
        syncProjectId,
        movedFromProjectId: normalizedSourceProjectId,
        movedToProjectId: normalizedTargetProjectId,
        previousRoutedProjectId: normalizeId(calendarData.projectRouting?.chosenProjectId),
    }
}

/**
 * Builds the explicit user-feedback marker for calendar-to-Goal routing. Unlike project moves,
 * Goal changes normally update a task in place, so the marker is what lets the update trigger
 * distinguish a deliberate picker action from sync, workflow, or automatic-router writes.
 */
export function buildCalendarGoalRoutingFeedback({
    task,
    projectId,
    previousGoalId = task?.parentGoalId,
    selectedGoalId,
    requestedByUserId,
    feedbackId,
    requestedAt = Date.now(),
} = {}) {
    const calendarData = task?.calendarData
    if (!calendarData || typeof calendarData !== 'object') return null

    const normalizedProjectId = normalizeId(projectId || task?.projectId)
    const normalizedPreviousGoalId = normalizeId(previousGoalId) || null
    const normalizedSelectedGoalId = normalizeId(selectedGoalId) || null
    const normalizedRequestedByUserId = normalizeId(requestedByUserId)
    const normalizedFeedbackId = normalizeId(feedbackId)
    const syncProjectId = normalizeId(
        calendarData.originalProjectId || calendarData.projectRouting?.syncProjectId || normalizedProjectId
    )

    if (
        !syncProjectId ||
        !normalizedProjectId ||
        !normalizedRequestedByUserId ||
        !normalizedFeedbackId ||
        normalizedPreviousGoalId === normalizedSelectedGoalId
    ) {
        return null
    }

    return {
        version: CALENDAR_GOAL_ROUTING_FEEDBACK_VERSION,
        feedbackId: normalizedFeedbackId,
        requestedAt: Number.isFinite(requestedAt) ? Number(requestedAt) : Date.now(),
        requestedByUserId: normalizedRequestedByUserId,
        syncProjectId,
        projectId: normalizedProjectId,
        previousGoalId: normalizedPreviousGoalId,
        selectedGoalId: normalizedSelectedGoalId,
    }
}
