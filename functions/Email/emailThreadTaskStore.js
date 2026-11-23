'use strict'

const { getEmailIdentity, matchesEmailThread } = require('./emailThreadIdentity')
const { canAccessObject } = require('../shared/privacyAccess')

function getRegistryRef(database, identity, scopeProjectId = '') {
    const key = scopeProjectId ? `${identity.key}_${encodeURIComponent(scopeProjectId)}` : identity.key
    return database.doc(`users/${identity.ownerId}/emailThreadTasks/${key}`)
}

function selectEmailThreadTask(matches, identity) {
    const exact = matches.filter(({ task }) =>
        [task.gmailData?.messageId, ...(task.gmailData?.messageIds || [])].includes(identity.messageId)
    )
    if (exact.length === 1) return exact[0]
    return matches.length === 1 ? matches[0] : null
}

async function resolveEmailThreadTask({
    database,
    identity,
    projectIds,
    transaction = null,
    includeAmbiguity = false,
}) {
    if (!identity) return null
    const messageRef = database.doc(`users/${identity.ownerId}/emailThreadTasks/message_${identity.messageKey}`)
    const pointer = await (transaction ? transaction.get(messageRef) : messageRef.get())
    const matches = await findEmailThreadTasks({ database, identity, projectIds, transaction })
    if (pointer.exists) {
        const registered = pointer.data()
        const exact = matches.find(
            match => match.taskId === registered.taskId && match.projectId === registered.projectId
        )
        if (
            exact &&
            [exact.task.gmailData.messageId, ...(exact.task.gmailData.messageIds || [])].includes(identity.messageId)
        )
            return exact
    }
    const selected = selectEmailThreadTask(matches, identity)
    return selected || (includeAmbiguity && matches.length > 1 ? { ambiguous: true } : null)
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
        // Reading and writing this shared pointer serializes first-message races.
        // Always inspect the live matches: a stale pointer cannot resolve ambiguity.
        await transaction.get(registryRef)
        const matches = await findEmailThreadTasks({ database, identity, projectIds, transaction })
        let existing = null
        if (matches.length) {
            if (!selectMatch) throw new Error('Existing email thread requires a task selection policy')
            const messageRef = database.doc(`users/${identity.ownerId}/emailThreadTasks/message_${identity.messageKey}`)
            const pointer = await transaction.get(messageRef)
            const registered = pointer.exists ? pointer.data() : null
            existing = registered
                ? matches.find(
                      match =>
                          match.taskId === registered.taskId &&
                          match.projectId === registered.projectId &&
                          [match.task.gmailData.messageId, ...(match.task.gmailData.messageIds || [])].includes(
                              identity.messageId
                          )
                  )
                : null
            existing = existing || selectMatch(matches, identity)
            if (existing && !matches.includes(existing)) throw new Error('Invalid email thread task selection')
        }
        const selected = existing || taskResult
        if (!existing) {
            const taskRef = database.doc(`items/${taskResult.projectId}/tasks/${taskResult.taskId}`)
            transaction.set(taskRef, taskResult.task)
        }
        transaction.set(registryRef, { projectId: selected.projectId, taskId: selected.taskId })
        transaction.set(database.doc(`users/${identity.ownerId}/emailThreadTasks/message_${identity.messageKey}`), {
            projectId: selected.projectId,
            taskId: selected.taskId,
        })
        return { ...selected, persisted: true, existing: !!existing }
    })
}

module.exports = { findEmailThreadTasks, persistEmailTaskAtomically, selectEmailThreadTask, resolveEmailThreadTask }
