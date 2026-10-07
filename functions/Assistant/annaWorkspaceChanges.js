const { randomUUID } = require('crypto')
const { loadAnnaContext } = require('./annaWorkspace')

const TYPES = {
    create_task: 'task',
    update_task: 'task',
    create_note: 'note',
    update_note: 'note',
    update_contact: 'contact',
}
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]+$/.test(value)

function getWorkspaceChangeTarget(toolName, result) {
    const type = TYPES[toolName]
    if (!type || result?.success !== true || result.existing || result.skippedDuplicate) return null
    if (toolName.startsWith('update_') && Array.isArray(result.changes) && !result.changes.length) return null
    const object = result[type] || result.updatedTask || {}
    const objectId = result[`${type}Id`] || object[`${type}Id`] || object.id || object.uid
    // update_task retains the source projectId from persistence when it then
    // moves the task; the final project descriptor points at the destination.
    const projectId = result.project?.id || result.projectId || object.projectId
    if (!validId(objectId) || !validId(projectId)) return null
    return { type, objectId, projectId, change: toolName.startsWith('create_') ? 'created' : 'updated' }
}

// Only confirmed mutations in the private sidebar conversation create a visual cue.
// The cue is best-effort UI feedback; a failure must never replay the mutation.
async function recordAnnaWorkspaceChange({ db, runtime, toolName, result, now = Date.now() }) {
    if (!runtime?.annaConversation) return
    const results =
        toolName === 'update_task' && result?.success === true && Array.isArray(result.updated)
            ? result.updated.map(task => ({ ...task, taskId: task.id, success: true }))
            : [result]
    const targets = [
        ...new Map(
            results
                .map(saved => getWorkspaceChangeTarget(toolName, saved))
                .filter(Boolean)
                .map(target => [`${target.projectId}/${target.type}/${target.objectId}`, target])
        ).values(),
    ].slice(-12)
    if (!targets.length || !(await loadAnnaContext(db, runtime))) return
    const projects = new Map()
    const paths = { task: 'items', note: 'noteItems', contact: 'projectsContacts' }
    const newCues = (
        await Promise.all(
            targets.map(async target => {
                if (!projects.has(target.projectId))
                    projects.set(target.projectId, db.doc(`projects/${target.projectId}`).get())
                const project = await projects.get(target.projectId)
                if (!project.data()?.userIds?.includes(runtime.requestUserId)) return null
                const object = await db
                    .doc(`${paths[target.type]}/${target.projectId}/${target.type}s/${target.objectId}`)
                    .get()
                if (!object.exists) return null
                const data = object.data()
                if (
                    Array.isArray(data.isPublicFor) &&
                    !data.isPublicFor.some(id => id === 0 || id === runtime.requestUserId)
                )
                    return null
                if (target.type === 'contact' && data.isPrivate && data.recorderUserId !== runtime.requestUserId)
                    return null
                return {
                    ...target,
                    id: randomUUID(),
                    title: String(
                        data.name || data.title || data.extendedTitle || data.displayName || data.extendedName || ''
                    ).slice(0, 120),
                    path: `/projects/${target.projectId}/${target.type}s/${target.objectId}/${target.type === 'note' ? 'editor' : 'properties'}`,
                    createdAt: now,
                    expiresAt: now + 120000,
                }
            })
        )
    ).filter(Boolean)
    if (!newCues.length) return
    const ref = db.doc(`chatObjects/${runtime.projectId}/chats/${runtime.objectId}`)
    await db.runTransaction(async tx => {
        const chat = (await tx.get(ref)).data()
        if (chat?.annaOwnerId !== runtime.requestUserId || chat.creatorId !== runtime.requestUserId) return
        const cues = [...(chat.annaWorkspaceChanges || []).filter(item => item.expiresAt > now), ...newCues].slice(-12)
        const status = chat.annaWorkspaceChangeStatus || {}
        tx.update(ref, {
            annaWorkspaceChanges: cues,
            annaWorkspaceChangeStatus: Object.fromEntries(
                cues.filter(item => status[item.id]).map(item => [item.id, status[item.id]])
            ),
        })
    })
}

module.exports = { getWorkspaceChangeTarget, recordAnnaWorkspaceChange }
