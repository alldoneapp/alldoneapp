// A chat run keeps its original lock ID for cancellation/idempotency, but its comment can
// move projects. Reading the lock in the same transaction as each write serializes streaming
// updates with the move, including a final token arriving while the chat is being copied.
async function updateAssistantRunComment(db, lockRef, location, data) {
    if (!lockRef) {
        await db.doc(commentPath(location)).update(data)
        return location
    }
    return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(lockRef)
        const lock = snapshot.exists ? snapshot.data() : null
        const current =
            lock?.objectId === location.objectId &&
            lock?.objectType === location.objectType &&
            lock?.commentId === location.commentId &&
            lock?.projectId
                ? { ...location, projectId: lock.projectId }
                : location
        transaction.update(db.doc(commentPath(current)), data)
        return current
    })
}

function commentPath({ projectId, objectType, objectId, commentId }) {
    return `chatComments/${projectId}/${objectType}/${objectId}/comments/${commentId}`
}

async function moveAssistantRunComment(
    db,
    { sourceProjectId, targetProjectId, objectType, objectId, commentId, runId }
) {
    const lockRef = db.doc(`assistantRunLocks/${runId}`)
    const sourceRef = db.doc(commentPath({ projectId: sourceProjectId, objectType, objectId, commentId }))
    const targetRef = db.doc(commentPath({ projectId: targetProjectId, objectType, objectId, commentId }))
    await db.runTransaction(async transaction => {
        const [source, lockSnapshot] = await Promise.all([transaction.get(sourceRef), transaction.get(lockRef)])
        const lock = lockSnapshot.exists ? lockSnapshot.data() : null
        const matches = lock?.objectId === objectId && lock?.objectType === objectType && lock?.commentId === commentId
        // A retried copy must never replace a reply that has already continued at its destination.
        if (matches && lock.projectId !== sourceProjectId) return
        if (!source.exists) throw new Error('The assistant comment disappeared before its chat could be moved.')
        transaction.set(targetRef, source.data())
        if (matches) transaction.update(lockRef, { projectId: targetProjectId, updatedAt: Date.now() })
    })
}

module.exports = { updateAssistantRunComment, moveAssistantRunComment }
