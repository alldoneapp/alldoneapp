const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value)

// A reusable browser session outlives the request using it. Publish only the reference to that
// request's existing status comment so the workspace can observe completion independently.
async function resolveBrowserActivity({ db, projectId, objectId, objectType, requestUserId, runtime }) {
    if (validId(runtime?.assistantCommentId) && validId(runtime?.objectId)) {
        return {
            projectId: runtime.projectId || projectId,
            objectId: runtime.objectId,
            objectType: runtime.objectType || objectType,
            commentId: runtime.assistantCommentId,
        }
    }
    // VM browser calls arrive through MCP with their host task, without the assistant's runtime.
    if (objectType !== 'tasks') return null
    const session = (await db.doc(`vmSessions/${projectId}__${objectId}`).get()).data()
    if (!validId(session?.activeCorrelationId)) return null
    const job = (await db.doc(`pendingWebhooks/${session.activeCorrelationId}`).get()).data()
    if (
        job?.kind !== 'vm_job' ||
        job.userId !== requestUserId ||
        job.projectId !== projectId ||
        job.objectId !== objectId ||
        !validId(job.statusCommentId)
    )
        return null
    return { projectId, objectId, objectType, commentId: job.statusCommentId }
}

module.exports = { resolveBrowserActivity }
