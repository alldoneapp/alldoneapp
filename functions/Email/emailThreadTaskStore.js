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
    const matches = results.flat()
    // A thread that joined a collection to-do after its first email (AT-3135) is not that task's
    // threadId, so the query above cannot find it. Its pointer, written in the same transaction
    // that added the thread, can; the task itself is re-checked like any other match.
    if (identity.threadId) {
        const pointer = await read(getBundleThreadPointerRef(database, identity))
        const registered = pointer.exists ? pointer.data() : null
        if (
            registered?.projectId &&
            registered?.taskId &&
            projectIds.includes(registered.projectId) &&
            !matches.some(match => match.taskId === registered.taskId && match.projectId === registered.projectId)
        ) {
            const taskSnapshot = await read(database.doc(`items/${registered.projectId}/tasks/${registered.taskId}`))
            const task = taskSnapshot.exists ? taskSnapshot.data() : null
            if (task && matchesEmailThread(task.gmailData, identity) && canAccessObject(task, identity.ownerId))
                matches.push({ taskId: registered.taskId, projectId: registered.projectId, task })
        }
    }
    return matches
}

function getBundleThreadPointerRef(database, identity) {
    return database.doc(`users/${identity.ownerId}/emailThreadTasks/bundleThread_${identity.key}`)
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
    bundle = null,
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
        // A new thread whose email belongs to a collection to-do (AT-3135): the open or done
        // collection to-do takes it instead of a new task. The caller appends the email to it.
        // Only a thread without any task joins it; a thread that already has several (ambiguous,
        // AT-2709) gets its separate task, which is then not a collection to-do.
        let bundleRef = null
        if (!existing && matches.length && bundle?.id) {
            const { bundle: _bundle, threadIds: _threadIds, ...gmailData } = taskResult.task.gmailData
            taskResult.task.gmailData = gmailData
        } else if (!existing && bundle?.id) {
            const { getEmailBundleRef, findLiveEmailBundleTask } = require('./emailTaskBundle')
            bundleRef = getEmailBundleRef(database, identity.ownerId, bundle.id)
            const live = await findLiveEmailBundleTask({
                database,
                identity,
                bundleId: bundle.id,
                projectIds,
                transaction,
            })
            if (live) {
                // The thread belongs to the collection to-do from this commit on, so a concurrent
                // email of the same thread finds it here instead of creating a second task. The
                // email itself (line, comment, message pointer) is added by appendEmailToBundleTask.
                const threadIds = [
                    ...new Set(
                        [
                            ...(live.task.gmailData.threadIds || []),
                            live.task.gmailData.threadId,
                            identity.threadId,
                        ].filter(Boolean)
                    ),
                ]
                const gmailData = { ...live.task.gmailData, threadIds }
                transaction.update(database.doc(`items/${live.projectId}/tasks/${live.taskId}`), { gmailData })
                transaction.set(registryRef, { projectId: live.projectId, taskId: live.taskId })
                if (identity.threadId && identity.threadId !== live.task.gmailData.threadId) {
                    transaction.set(getBundleThreadPointerRef(database, identity), {
                        projectId: live.projectId,
                        taskId: live.taskId,
                    })
                }
                return {
                    ...live,
                    task: { ...live.task, gmailData },
                    persisted: true,
                    existing: true,
                    bundleExisting: true,
                }
            }
        }
        const selected = existing || taskResult
        if (!existing) {
            const taskRef = database.doc(`items/${taskResult.projectId}/tasks/${taskResult.taskId}`)
            transaction.set(taskRef, taskResult.task)
        }
        if (bundleRef) {
            transaction.set(bundleRef, {
                ...bundle.registry,
                projectId: taskResult.projectId,
                taskId: taskResult.taskId,
            })
        }
        transaction.set(registryRef, { projectId: selected.projectId, taskId: selected.taskId })
        transaction.set(database.doc(`users/${identity.ownerId}/emailThreadTasks/message_${identity.messageKey}`), {
            projectId: selected.projectId,
            taskId: selected.taskId,
        })
        return { ...selected, persisted: true, existing: !!existing }
    })
}

module.exports = {
    findEmailThreadTasks,
    getBundleThreadPointerRef,
    persistEmailTaskAtomically,
    selectEmailThreadTask,
    resolveEmailThreadTask,
}
