// Security audit 2026-11: Firestore triggers act on a few task fields AS the user they name
// (goal routing as creatorId === lastEditorId, AI workflow steps as workflowPayerUserId and the
// author of workflowAiPromptOverride, calendar routing feedback as requestedByUserId). firestore.rules
// therefore only let a client write those fields as itself. A task copied from an existing one (a
// duplicate, a copy into another project) still carries the previous writer's values, so before the
// copy is created they are re-attributed to the copier or dropped. Pinned by
// taskIdentityFields.test.js and the `task identity fields` block of the rules emulator suite.

const CALENDAR_ROUTING_MARKERS = ['projectRoutingFeedback', 'goalRoutingFeedback']

export const bindCopiedTaskIdentityFieldsToWriter = (task, writerId) => {
    if (!task || !writerId) return task
    const bound = { ...task }

    // A copy written by someone else is not that person's own task, so it must not look like one.
    if (bound.creatorId && bound.creatorId === bound.lastEditorId && bound.creatorId !== writerId) {
        bound.lastEditorId = writerId
    }

    // Whoever creates an assistant workflow task in a step is the one its AI step runs for.
    if (bound.workflowPayerUserId && bound.workflowPayerUserId !== writerId) {
        bound.workflowPayerUserId = writerId
    }

    const override = bound.workflowAiPromptOverride
    if (override && override.requestedByUserId && override.requestedByUserId !== writerId) {
        bound.workflowAiPromptOverride = null
    }

    const calendarData = bound.calendarData
    if (calendarData && typeof calendarData === 'object') {
        const foreignMarkers = CALENDAR_ROUTING_MARKERS.filter(
            marker => calendarData[marker] && calendarData[marker].requestedByUserId !== writerId
        )
        if (foreignMarkers.length > 0) {
            const cleaned = { ...calendarData }
            foreignMarkers.forEach(marker => delete cleaned[marker])
            bound.calendarData = cleaned
        }
    }

    return bound
}
