'use strict'

const { getEmailIdentity, matchesEmailThread } = require('./emailThreadIdentity')
const { canAccessObject } = require('../shared/privacyAccess')

function getRegistryRef(database, identity, scopeProjectId = '') {
    const key = scopeProjectId ? `${identity.key}_${encodeURIComponent(scopeProjectId)}` : identity.key
    return database.doc(`users/${identity.ownerId}/emailThreadTasks/${key}`)
}

// Uses only automatic single-field indexes. The caller supplies the allowed project
// scope and decides which match to use; account/thread matching is never delegated to AI.
async function findEmailThreadTasks({ database, identity, projectIds, transaction = null }) {
    if (!identity) return []
    const read = ref => (transaction ? transaction.get(ref) : ref.get())
    const results = await Promise.all(
        [...new Set(projectIds)].map(async projectId => {
            const query = database
                .collection(`items/${projectId}/tasks`)
                .where(
                    identity.threadId ? 'gmailData.threadId' : 'gmailData.messageId',
                    '==',
                    identity.threadId || identity.messageId
                )
            const snapshot = await read(query)
            return snapshot.docs.flatMap(doc => {
                const task = doc.data()
                return matchesEmailThread(task.gmailData, identity) && canAccessObject(task, identity.ownerId)
                    ? [{ taskId: doc.id, projectId, task }]
                    : []
            })
        })
    )
    return results.flat()
}

// The task document and thread pointer commit together. Retrying a transaction never
// runs TaskService/model calls/feeds inside it. This also serializes two different
// messages racing to create the first task for a thread.
async function persistEmailTaskAtomically({
    database,
    taskResult,
    userId,
    projectIds,
    scopeProjectId = '',
    selectMatch,
}) {
    const identity = getEmailIdentity(userId, taskResult.task.gmailData)
    if (!identity) throw new Error('A proven email account and message identity are required')
    if (!projectIds.includes(taskResult.projectId))
        throw new Error('Task project is outside the allowed email thread scope')
    const registryRef = getRegistryRef(database, identity, scopeProjectId)
    return database.runTransaction(async transaction => {
        const registrySnapshot = await transaction.get(registryRef)
        const registered = registrySnapshot.exists ? registrySnapshot.data() : null
        let existing = null
        if (registered && projectIds.includes(registered.projectId)) {
            const taskSnapshot = await transaction.get(
                database.doc(`items/${registered.projectId}/tasks/${registered.taskId}`)
            )
            const task = taskSnapshot.exists ? taskSnapshot.data() : null
            if (task && matchesEmailThread(task.gmailData, identity) && canAccessObject(task, userId)) {
                existing = { taskId: registered.taskId, projectId: registered.projectId, task }
            }
        }
        if (!existing) {
            const matches = await findEmailThreadTasks({ database, identity, projectIds, transaction })
            if (matches.length) {
                if (!selectMatch) throw new Error('Existing email thread requires a task selection policy')
                existing = selectMatch(matches)
                if (!existing || !matches.includes(existing)) throw new Error('Invalid email thread task selection')
            }
        }
        const selected = existing || taskResult
        if (!existing) {
            const taskRef = database.doc(`items/${taskResult.projectId}/tasks/${taskResult.taskId}`)
            transaction.set(taskRef, taskResult.task)
        }
        transaction.set(registryRef, { projectId: selected.projectId, taskId: selected.taskId })
        return { ...selected, persisted: true, existing: !!existing }
    })
}

module.exports = { findEmailThreadTasks, persistEmailTaskAtomically }
