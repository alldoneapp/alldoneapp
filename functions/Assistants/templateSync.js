const admin = require('firebase-admin')
const { isEqual } = require('lodash')
const {
    getAssistantTemplateState,
    getTaskTemplateState,
    inheritMissingAssistantTemplateFields,
    isTaskUnmodified,
    mergeTemplateState,
    buildBackfillConflicts,
} = require('./templateMerge')

const GLOBAL_PROJECT_ID = 'globalProject'
const SYNC_FEED_TYPE = 'FEED_ASSISTANT_TEMPLATE_SYNCED'

const hasOwn = (object, field) => Object.prototype.hasOwnProperty.call(object || {}, field)

function getChangedTemplateFields(previousState, currentState) {
    const fields = new Set([...Object.keys(previousState || {}), ...Object.keys(currentState || {})])
    return new Set(
        Array.from(fields).filter(
            field =>
                hasOwn(previousState, field) !== hasOwn(currentState, field) ||
                (hasOwn(previousState, field) && !isEqual(previousState[field], currentState[field]))
        )
    )
}

function mergeStoredConflicts(storedConflicts, newConflicts, affectedFields) {
    return [
        ...(Array.isArray(storedConflicts)
            ? storedConflicts.filter(conflict => !affectedFields.has(conflict.field))
            : []),
        ...newConflicts,
    ]
}

const getProjectAndAssistantId = doc => {
    const parts = doc.ref.path.split('/')
    return { projectId: parts[1], assistantId: parts[3] }
}

async function getDerivedAssistants(templateAssistantId) {
    const snapshot = await admin
        .firestore()
        .collectionGroup('items')
        .where('copiedFromTemplateAssistantId', '==', templateAssistantId)
        .get()
    return snapshot.docs.filter(doc => doc.ref.path.startsWith('assistants/'))
}

function withDeletedFields(patch, fields) {
    fields.forEach(field => {
        patch[field] = admin.firestore.FieldValue.delete()
    })
    return patch
}

async function writeSyncActivity(
    projectId,
    assistantId,
    assistant,
    changedFields,
    conflictCount,
    timestamp,
    activityText
) {
    if (!changedFields.length) return
    const db = admin.firestore()
    const feedId = db.collection('_ids').doc().id
    const creatorId = assistant.creatorId || assistant.lastEditorId || 'system'
    const entryText =
        activityText ||
        `automatically synced ${changedFields.length} assistant setting${
            changedFields.length === 1 ? '' : 's'
        } from the template${
            conflictCount ? ` • ${conflictCount} change${conflictCount === 1 ? '' : 's'} need review` : ''
        }`
    const feed = {
        id: feedId,
        type: SYNC_FEED_TYPE,
        lastChangeDate: timestamp,
        creatorId,
        objectId: assistantId,
        assistantId,
        entryText,
        isPublicFor: [0],
    }
    const feedObject = {
        type: 'assistant',
        lastChangeDate: timestamp,
        assistantId,
        name: assistant.displayName || 'Assistant',
        photoURL: assistant.photoURL50 || '',
        isDeleted: false,
        isPublicFor: [0],
    }
    const batch = db.batch()
    batch.set(db.doc(`projectsInnerFeeds/${projectId}/assistants/${assistantId}/feeds/${feedId}`), feed)
    batch.set(db.doc(`feedsStore/${projectId}/all/${feedId}`), feed)
    batch.set(db.doc(`feedsObjectsLastStates/${projectId}/assistants/${assistantId}`), feedObject, { merge: true })
    batch.set(db.doc(`projects/${projectId}`), { lastActionDate: timestamp }, { merge: true })
    await batch.commit()
}

async function syncDerivedAssistant(doc, previousTemplateAssistant, currentTemplateAssistant) {
    const localAssistant = doc.data()
    const { projectId, assistantId } = getProjectAndAssistantId(doc)
    const timestamp = Date.now()
    const previousState = localAssistant.templateSyncSnapshot || getAssistantTemplateState(previousTemplateAssistant)
    const currentState = getAssistantTemplateState(currentTemplateAssistant)
    const { normalizedLocalState } = inheritMissingAssistantTemplateFields(
        getAssistantTemplateState(localAssistant),
        previousState
    )
    const result = mergeTemplateState(previousState, currentState, normalizedLocalState)
    const affectedFields = getChangedTemplateFields(previousState, currentState)
    const conflicts = mergeStoredConflicts(localAssistant.templateSyncConflicts, result.conflicts, affectedFields)
    const changedFields = [...Object.keys(result.patch), ...result.deleteFields]
    const patch = withDeletedFields({ ...result.patch }, result.deleteFields)

    Object.assign(patch, {
        copiedFromTemplateAssistantDate: currentTemplateAssistant.lastEditionDate || timestamp,
        templateSyncSnapshot: currentState,
        templateSyncConflicts: conflicts,
        templateSyncStatus: conflicts.length ? 'needs_review' : 'synced',
        templateSyncedAt: timestamp,
    })
    // Sync bookkeeping is not a local edit and must not impersonate the user.
    await doc.ref.update(patch)
    await writeSyncActivity(
        projectId,
        assistantId,
        { ...localAssistant, ...result.patch },
        changedFields,
        conflicts.length,
        timestamp
    )
    return { projectId, assistantId, changedFields, conflicts }
}

async function propagateTemplateAssistantUpdate(previousTemplateAssistant, currentTemplateAssistant) {
    const derivedDocs = await getDerivedAssistants(currentTemplateAssistant.uid)
    const results = []
    // Keep concurrency bounded for templates copied into many projects.
    for (let index = 0; index < derivedDocs.length; index += 20) {
        const chunk = derivedDocs.slice(index, index + 20)
        results.push(
            ...(await Promise.all(
                chunk.map(doc => syncDerivedAssistant(doc, previousTemplateAssistant, currentTemplateAssistant))
            ))
        )
    }
    return results
}

async function findLocalTemplateTask(projectId, assistantId, templateTaskId) {
    const snapshot = await admin.firestore().collection(`assistantTasks/${projectId}/${assistantId}`).get()
    const doc = snapshot.docs.find(item => item.data().copiedFromTemplateTaskId === templateTaskId)
    return doc || null
}

function newDerivedTask(currentTask, projectId, assistantId, creatorId, timestamp) {
    const state = getTaskTemplateState(currentTask)
    const recurring = state.recurrence && state.recurrence !== 'never'
    const task = {
        ...state,
        assistantId,
        copiedFromTemplateTaskId: currentTask.id,
        copiedFromTemplateTaskDate: timestamp,
        templateTaskSnapshot: state,
        templateTaskSyncConflicts: [],
        templateSyncStatus: 'synced',
        activatedInProjectId: projectId,
        lastExecuted: null,
        lastExecutedByUser: {},
        recurrenceByUser: recurring && creatorId ? { [creatorId]: state.recurrence } : {},
        activatedUserIds: recurring && creatorId ? [creatorId] : [],
    }
    if (creatorId) {
        task.creatorUserId = creatorId
        task.activatorUserId = creatorId
    }
    return task
}

async function syncDerivedTask(assistantDoc, previousTask, currentTask, operation) {
    const assistant = assistantDoc.data()
    const { projectId, assistantId } = getProjectAndAssistantId(assistantDoc)
    const localTaskDoc = await findLocalTemplateTask(projectId, assistantId, (currentTask || previousTask).id)
    const timestamp = Date.now()

    if (operation === 'create') {
        if (localTaskDoc) return
        const ref = admin.firestore().collection(`assistantTasks/${projectId}/${assistantId}`).doc()
        await ref.set(newDerivedTask(currentTask, projectId, assistantId, assistant.creatorId, timestamp))
        await writeSyncActivity(
            projectId,
            assistantId,
            assistant,
            ['task'],
            0,
            timestamp,
            'automatically added a task from the template'
        )
        return
    }
    if (!localTaskDoc) return

    const localTask = { ...localTaskDoc.data(), id: localTaskDoc.id }
    if (operation === 'delete') {
        const previousState = localTask.templateTaskSnapshot || previousTask
        if (isTaskUnmodified(previousState, localTask)) {
            await localTaskDoc.ref.delete()
            await writeSyncActivity(
                projectId,
                assistantId,
                assistant,
                ['task'],
                0,
                timestamp,
                'automatically removed an unmodified task deleted from the template'
            )
        } else
            await localTaskDoc.ref.update({
                templateSyncStatus: 'template_deleted_local_changes_preserved',
                templateTaskDeletedAt: timestamp,
                copiedFromTemplateTaskDate: timestamp,
            })
        return
    }

    const previousState = localTask.templateTaskSnapshot || getTaskTemplateState(previousTask)
    const currentState = getTaskTemplateState(currentTask)
    const localState = getTaskTemplateState(localTask)
    const result = mergeTemplateState(previousState, currentState, localState)
    const affectedFields = getChangedTemplateFields(previousState, currentState)
    const conflicts = mergeStoredConflicts(localTask.templateTaskSyncConflicts, result.conflicts, affectedFields)
    const changedFields = [...Object.keys(result.patch), ...result.deleteFields]
    const patch = withDeletedFields({ ...result.patch }, result.deleteFields)
    Object.assign(patch, {
        copiedFromTemplateTaskDate: timestamp,
        templateTaskSnapshot: currentState,
        templateTaskSyncConflicts: conflicts,
        templateSyncStatus: conflicts.length ? 'needs_review' : 'synced',
    })
    await localTaskDoc.ref.update(patch)
    await writeSyncActivity(
        projectId,
        assistantId,
        assistant,
        changedFields,
        conflicts.length,
        timestamp,
        `automatically synced ${changedFields.length} template task setting${changedFields.length === 1 ? '' : 's'}${
            conflicts.length ? ` • ${conflicts.length} change${conflicts.length === 1 ? '' : 's'} need review` : ''
        }`
    )
}

async function propagateTemplateTaskChange(templateAssistantId, previousTask, currentTask, operation) {
    if (!templateAssistantId) return []
    const derivedDocs = await getDerivedAssistants(templateAssistantId)
    for (let index = 0; index < derivedDocs.length; index += 20) {
        await Promise.all(
            derivedDocs.slice(index, index + 20).map(doc => syncDerivedTask(doc, previousTask, currentTask, operation))
        )
    }
    return derivedDocs.length
}

async function backfillDerivedAssistant(doc, templateAssistant) {
    const localAssistant = doc.data()
    if (localAssistant.templateSyncSnapshot) return false
    const { projectId, assistantId } = getProjectAndAssistantId(doc)
    const timestamp = Date.now()
    const templateState = getAssistantTemplateState(templateAssistant)
    const { normalizedLocalState, inheritedPatch } = inheritMissingAssistantTemplateFields(
        getAssistantTemplateState(localAssistant),
        templateState
    )
    const conflicts = buildBackfillConflicts(templateState, normalizedLocalState)
    await doc.ref.update({
        ...inheritedPatch,
        templateSyncSnapshot: templateState,
        templateSyncConflicts: conflicts,
        templateSyncStatus: conflicts.length ? 'needs_review' : 'synced',
        templateSyncedAt: timestamp,
        copiedFromTemplateAssistantDate: templateAssistant.lastEditionDate || timestamp,
    })

    const [globalTasksSnapshot, localTasksSnapshot] = await Promise.all([
        admin
            .firestore()
            .collection(`assistantTasks/${GLOBAL_PROJECT_ID}/preConfigTasks`)
            .where('assistantId', '==', templateAssistant.uid)
            .get(),
        admin.firestore().collection(`assistantTasks/${projectId}/${assistantId}`).get(),
    ])
    const globalTasks = new Map(
        globalTasksSnapshot.docs.map(taskDoc => [taskDoc.id, { ...taskDoc.data(), id: taskDoc.id }])
    )
    await Promise.all(
        localTasksSnapshot.docs.map(async taskDoc => {
            const localTask = { ...taskDoc.data(), id: taskDoc.id }
            if (!localTask.copiedFromTemplateTaskId || localTask.templateTaskSnapshot) return
            const templateTask = globalTasks.get(localTask.copiedFromTemplateTaskId)
            if (!templateTask) {
                await taskDoc.ref.update({
                    templateSyncStatus: 'template_missing_local_preserved',
                    templateTaskDeletedAt: timestamp,
                })
                return
            }
            const taskState = getTaskTemplateState(templateTask)
            const taskConflicts = buildBackfillConflicts(taskState, getTaskTemplateState(localTask))
            await taskDoc.ref.update({
                templateTaskSnapshot: taskState,
                templateTaskSyncConflicts: taskConflicts,
                templateSyncStatus: taskConflicts.length ? 'needs_review' : 'synced',
                copiedFromTemplateTaskDate: timestamp,
            })
        })
    )
    return true
}

async function runTemplateSyncBackfill() {
    const db = admin.firestore()
    const markerRef = db.doc('systemMigrations/AT-1936-template-sync')
    const marker = await markerRef.get()
    if (marker.exists && marker.data().completed) return { alreadyCompleted: true, assistants: 0 }

    const templatesSnapshot = await db.collection(`assistants/${GLOBAL_PROJECT_ID}/items`).get()
    let assistants = 0
    for (const templateDoc of templatesSnapshot.docs) {
        const template = { ...templateDoc.data(), uid: templateDoc.id }
        const derivedDocs = await getDerivedAssistants(template.uid)
        for (let index = 0; index < derivedDocs.length; index += 20) {
            const results = await Promise.all(
                derivedDocs.slice(index, index + 20).map(doc => backfillDerivedAssistant(doc, template))
            )
            assistants += results.filter(Boolean).length
        }
    }
    await markerRef.set({ completed: true, completedAt: Date.now(), assistants })
    return { alreadyCompleted: false, assistants }
}

async function acceptTemplateConflicts({ userId, projectId, assistantId, acceptedFields, resolvedFields }) {
    const ref = admin.firestore().doc(`assistants/${projectId}/items/${assistantId}`)
    return admin.firestore().runTransaction(async transaction => {
        const doc = await transaction.get(ref)
        if (!doc.exists) throw new Error('Assistant not found')
        const assistant = doc.data()
        const accepted = new Set(Array.isArray(acceptedFields) ? acceptedFields : [])
        const resolved = new Set(Array.isArray(resolvedFields) ? resolvedFields : [])
        const conflicts = Array.isArray(assistant.templateSyncConflicts) ? assistant.templateSyncConflicts : []
        const remaining = []
        const patch = {}
        conflicts.forEach(conflict => {
            if (!resolved.has(conflict.field)) {
                remaining.push(conflict)
            } else if (accepted.has(conflict.field) && conflict.templateValueExists) {
                patch[conflict.field] = conflict.templateValue
            } else if (accepted.has(conflict.field)) {
                patch[conflict.field] = admin.firestore.FieldValue.delete()
            }
        })
        Object.assign(patch, {
            templateSyncConflicts: remaining,
            templateSyncStatus: remaining.length ? 'needs_review' : 'synced',
            templateSyncedAt: Date.now(),
            templateSyncReviewedBy: userId,
        })
        transaction.update(ref, patch)
        return { acceptedFields: Array.from(accepted), remainingConflicts: remaining.length }
    })
}

module.exports = {
    propagateTemplateAssistantUpdate,
    propagateTemplateTaskChange,
    acceptTemplateConflicts,
    syncDerivedAssistant,
    runTemplateSyncBackfill,
}
