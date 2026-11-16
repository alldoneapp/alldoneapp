const { assertProjectAccess } = require('../shared/privacyAccess')
const { findProjectAssistantId } = require('./annaWorkspace')

// Choosing a task's project must also choose who is responsible for the work. Keep an
// explicitly selected assistant within its own project; across projects use the same
// project-default resolution as the daily chat. A project with no assistant keeps the caller.
async function resolveAnnaTaskAssistant({
    db,
    projectId,
    targetProjectId,
    assistantId,
    requestUserId,
    assignedAssistantId,
}) {
    const caller = { projectId, assistantId }
    if (!assistantId || !targetProjectId || (targetProjectId === projectId && !assignedAssistantId)) return caller

    await assertProjectAccess(db, requestUserId, targetProjectId)
    if (assignedAssistantId) {
        const candidates = await db.getAll(
            db.doc(`assistants/${targetProjectId}/items/${assignedAssistantId}`),
            db.doc(`assistants/globalProject/items/${assignedAssistantId}`)
        )
        if (candidates.some(candidate => candidate.exists)) {
            return { projectId: targetProjectId, assistantId: assignedAssistantId }
        }
    }
    const targetAssistantId = await findProjectAssistantId(db, targetProjectId)
    return targetAssistantId ? { projectId: targetProjectId, assistantId: targetAssistantId } : caller
}

module.exports = { resolveAnnaTaskAssistant }
