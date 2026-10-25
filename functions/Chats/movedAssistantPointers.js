function movedAssistantPointerUpdates(user, sourceProjectId, targetProjectId, objectId, deleteValue) {
    const updates = {}
    const moveScope = (pointers, prefix) => {
        if (!pointers) return
        const global = pointers.allProjects
        if (global?.projectId === sourceProjectId && global.objectId === objectId) {
            updates[`${prefix}.allProjects`] = { ...global, projectId: targetProjectId }
        }
        const source = pointers[sourceProjectId]
        if (source?.objectId !== objectId) return
        updates[`${prefix}.${sourceProjectId}`] = deleteValue
        const target = pointers[targetProjectId]
        if (!target || Number(target.date || 0) <= Number(source.date || 0)) {
            updates[`${prefix}.${targetProjectId}`] = { ...source, projectId: targetProjectId }
        }
    }
    moveScope(user.lastAssistantCommentData, 'lastAssistantCommentData')
    Object.entries(user.lastAssistantCommentDataByAssistant || {}).forEach(([assistantId, pointers]) =>
        moveScope(pointers, `lastAssistantCommentDataByAssistant.${assistantId}`)
    )
    return updates
}

module.exports = { movedAssistantPointerUpdates }
