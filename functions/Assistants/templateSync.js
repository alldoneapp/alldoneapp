const admin = require('firebase-admin')
const { isEqual } = require('lodash')
const {
    getAssistantTemplateState,
    getTaskTemplateState,
    inheritMissingAssistantTemplateFields,
    inheritMissingTaskTemplateFields,
    isTaskUnmodified,
    mergeTemplateState,
    buildBackfillConflicts,
} = require('./templateMerge')
const { FieldValue } = require('firebase-admin/firestore')

const GLOBAL_PROJECT_ID = 'globalProject'
const SYNC_FEED_TYPE = 'FEED_ASSISTANT_TEMPLATE_SYNCED'
const TEMPLATE_SYNC_BACKFILL_VERSION = 2
// The original recurrence trigger updated this task's base field and snapshot,
// but not recurrenceByUser. Once that happened the old inherited cadence was no
// longer recoverable from the snapshot, so version two carries the exact missed
// transition. Other per-user values remain local customizations.
const LEGACY_RECURRENCE_REPAIRS = new Map([
    [
        '-OrS7UiOYnkrIf_PksMz',
        {
            templateAssistantId: '-Ns4cpvpLDeygvV2cjcJ',
            previousRecurrence: 'weekly',
            currentRecurrence: 'daily',
        },
    ],
])

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
        patch[field] = FieldValue.delete()
    })
    return patch
}

function getInheritedRecurrenceByUserPatch(previousState, currentState, localTask, mergeResult) {
    const recurrenceWasAutomaticallyMerged =
        hasOwn(mergeResult.patch, 'recurrence') || mergeResult.deleteFields.includes('recurrence')
    const recurrenceByUser = localTask?.recurrenceByUser

    if (
        !recurrenceWasAutomaticallyMerged ||
        !hasOwn(previousState, 'recurrence') ||
        !recurrenceByUser ||
        typeof recurrenceByUser !== 'object' ||
        Array.isArray(recurrenceByUser)
    ) {
        return {}
    }

    const previousRecurrence = previousState.recurrence
    const currentHasRecurrence = hasOwn(currentState, 'recurrence')
    const patch = {}

    Object.entries(recurrenceByUser).forEach(([userId, recurrence]) => {
        // A per-user value equal to the old template cadence is inherited state,
        // not a customization. Values that already differ remain user-owned.
        if (!isEqual(recurrence, previousRecurrence)) return

        patch[`recurrenceByUser.${userId}`] = currentHasRecurrence ? currentState.recurrence : FieldValue.delete()
    })

    return patch
}

function getLegacyRecurrenceByUserPatch(templateTask, currentState, localTask) {
    const repair = LEGACY_RECURRENCE_REPAIRS.get(templateTask?.id)
    if (
        !repair ||
        templateTask.assistantId !== repair.templateAssistantId ||
        !isEqual(currentState.recurrence, repair.currentRecurrence) ||
        !isEqual(localTask?.recurrence, repair.currentRecurrence) ||
        !localTask?.recurrenceByUser ||
        typeof localTask.recurrenceByUser !== 'object' ||
        Array.isArray(localTask.recurrenceByUser)
    ) {
        return {}
    }

    return Object.entries(localTask.recurrenceByUser).reduce((patch, [userId, recurrence]) => {
        if (isEqual(recurrence, repair.previousRecurrence)) {
            patch[`recurrenceByUser.${userId}`] = repair.currentRecurrence
        }
        return patch
    }, {})
}

/**
 * A sync that applies nothing because every changed field conflicted is still an
 * event the user has to hear about: the review is the only thing standing between
 * the template edit and the derived assistant. Wording it as "synced 0 settings"
 * would be worse than silence, so a review-only sync gets its own sentence.
 */
function buildSyncActivityText(changedCount, conflictCount, subject) {
    const changes = `${conflictCount} template change${conflictCount === 1 ? '' : 's'}`
    // Feeds render as `${assistantName} ${entryText}`, so the review-only variant is
    // phrased to follow a name rather than stand alone.
    if (!changedCount) return `has ${changes} waiting for review — open the assistant to choose which version to keep`
    const synced = `automatically synced ${changedCount} ${subject}${changedCount === 1 ? '' : 's'} from the template`
    return conflictCount ? `${synced} • ${changes} need${conflictCount === 1 ? 's' : ''} review` : synced
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
    // A conflict-only sync has no changed fields but is exactly the case the user
    // never heard about before (AT-2358); staying silent there is the bug.
    if (!changedFields.length && !conflictCount) return
    const db = admin.firestore()
    const feedId = db.collection('_ids').doc().id
    const creatorId = assistant.creatorId || assistant.lastEditorId || 'system'
    const entryText = activityText || buildSyncActivityText(changedFields.length, conflictCount, 'assistant setting')
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
    const previousState = getAssistantTemplateState(localAssistant.templateSyncSnapshot || previousTemplateAssistant)
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
        const previousState = getTaskTemplateState(localTask.templateTaskSnapshot || previousTask)
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

    const previousState = getTaskTemplateState(localTask.templateTaskSnapshot || previousTask)
    const currentState = getTaskTemplateState(currentTask)
    const { normalizedLocalState, inheritedPatch } = inheritMissingTaskTemplateFields(
        getTaskTemplateState(localTask),
        previousState
    )
    const result = mergeTemplateState(previousState, currentState, normalizedLocalState)
    const affectedFields = getChangedTemplateFields(previousState, currentState)
    const conflicts = mergeStoredConflicts(localTask.templateTaskSyncConflicts, result.conflicts, affectedFields)
    const changedFields = [...Object.keys(result.patch), ...result.deleteFields]
    const patch = withDeletedFields({ ...inheritedPatch, ...result.patch }, result.deleteFields)
    Object.assign(patch, getInheritedRecurrenceByUserPatch(previousState, currentState, localTask, result))
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
        buildSyncActivityText(changedFields.length, conflicts.length, 'template task setting')
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

async function backfillDerivedTask(taskDoc, templateTask, timestamp) {
    const localTask = { ...taskDoc.data(), id: taskDoc.id }
    if (!localTask.copiedFromTemplateTaskId) return false

    if (!templateTask) {
        if (localTask.templateTaskSnapshot && isTaskUnmodified(localTask.templateTaskSnapshot, localTask)) {
            await taskDoc.ref.delete()
        } else if (
            localTask.templateSyncStatus !== 'template_missing_local_preserved' &&
            localTask.templateSyncStatus !== 'template_deleted_local_changes_preserved'
        ) {
            await taskDoc.ref.update({
                templateSyncStatus: localTask.templateTaskSnapshot
                    ? 'template_deleted_local_changes_preserved'
                    : 'template_missing_local_preserved',
                templateTaskDeletedAt: timestamp,
                copiedFromTemplateTaskDate: timestamp,
            })
        } else {
            return false
        }
        return true
    }

    const currentState = getTaskTemplateState(templateTask)
    if (!localTask.templateTaskSnapshot) {
        const { normalizedLocalState, inheritedPatch } = inheritMissingTaskTemplateFields(
            getTaskTemplateState(localTask),
            currentState
        )
        const conflicts = buildBackfillConflicts(currentState, normalizedLocalState)
        await taskDoc.ref.update({
            ...inheritedPatch,
            templateTaskSnapshot: currentState,
            templateTaskSyncConflicts: conflicts,
            templateSyncStatus: conflicts.length ? 'needs_review' : 'synced',
            copiedFromTemplateTaskDate: timestamp,
        })
        return true
    }

    const previousState = getTaskTemplateState(localTask.templateTaskSnapshot)
    // Schedule fields were absent from version-one snapshots. Prefer the old
    // snapshot when it has a value and otherwise treat the current template
    // value as inherited legacy state.
    const missingFieldReference = { ...currentState, ...previousState }
    const { normalizedLocalState, inheritedPatch } = inheritMissingTaskTemplateFields(
        getTaskTemplateState(localTask),
        missingFieldReference
    )
    const result = mergeTemplateState(previousState, currentState, normalizedLocalState)
    const affectedFields = getChangedTemplateFields(previousState, currentState)
    const conflicts = mergeStoredConflicts(localTask.templateTaskSyncConflicts, result.conflicts, affectedFields)
    const patch = withDeletedFields({ ...inheritedPatch, ...result.patch }, result.deleteFields)
    Object.assign(
        patch,
        getInheritedRecurrenceByUserPatch(previousState, currentState, localTask, result),
        getLegacyRecurrenceByUserPatch(templateTask, currentState, localTask),
        {
            templateTaskSnapshot: currentState,
            templateTaskSyncConflicts: conflicts,
            templateSyncStatus: conflicts.length ? 'needs_review' : 'synced',
            copiedFromTemplateTaskDate: timestamp,
        }
    )
    await taskDoc.ref.update(patch)
    return true
}

async function backfillDerivedAssistant(doc, templateAssistant) {
    const localAssistant = doc.data()
    const { projectId, assistantId } = getProjectAndAssistantId(doc)
    const timestamp = Date.now()
    const templateState = getAssistantTemplateState(templateAssistant)
    let assistantBackfilled = false

    if (!localAssistant.templateSyncSnapshot) {
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
        // The first backfill is where most existing needs_review states came
        // from, so announce those conflicts once.
        if (conflicts.length)
            await writeSyncActivity(projectId, assistantId, localAssistant, [], conflicts.length, timestamp)
        assistantBackfilled = true
    } else {
        const previousState = getAssistantTemplateState(localAssistant.templateSyncSnapshot)
        const { normalizedLocalState, inheritedPatch } = inheritMissingAssistantTemplateFields(
            getAssistantTemplateState(localAssistant),
            { ...templateState, ...previousState }
        )
        const result = mergeTemplateState(previousState, templateState, normalizedLocalState)
        const affectedFields = getChangedTemplateFields(previousState, templateState)
        const conflicts = mergeStoredConflicts(localAssistant.templateSyncConflicts, result.conflicts, affectedFields)
        await doc.ref.update({
            ...withDeletedFields({ ...inheritedPatch, ...result.patch }, result.deleteFields),
            templateSyncSnapshot: templateState,
            templateSyncConflicts: conflicts,
            templateSyncStatus: conflicts.length ? 'needs_review' : 'synced',
            templateSyncedAt: timestamp,
            copiedFromTemplateAssistantDate: templateAssistant.lastEditionDate || timestamp,
        })
        assistantBackfilled = true
    }

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
    const taskResults = await Promise.all(
        localTasksSnapshot.docs.map(async taskDoc => {
            const localTask = { ...taskDoc.data(), id: taskDoc.id }
            const templateTask = globalTasks.get(localTask.copiedFromTemplateTaskId)
            return backfillDerivedTask(taskDoc, templateTask, timestamp)
        })
    )
    return { assistantBackfilled, tasksBackfilled: taskResults.filter(Boolean).length }
}

async function runTemplateSyncBackfill() {
    const db = admin.firestore()
    const markerRef = db.doc('systemMigrations/AT-1936-template-sync')
    const marker = await markerRef.get()
    const completedVersion = marker.exists && marker.data().completed ? Number(marker.data().version || 1) : 0
    if (completedVersion >= TEMPLATE_SYNC_BACKFILL_VERSION)
        return { alreadyCompleted: true, assistants: 0, tasks: 0, version: completedVersion }

    const templatesSnapshot = await db.collection(`assistants/${GLOBAL_PROJECT_ID}/items`).get()
    let assistants = 0
    let tasks = 0
    for (const templateDoc of templatesSnapshot.docs) {
        const template = { ...templateDoc.data(), uid: templateDoc.id }
        const derivedDocs = await getDerivedAssistants(template.uid)
        for (let index = 0; index < derivedDocs.length; index += 20) {
            const results = await Promise.all(
                derivedDocs.slice(index, index + 20).map(doc => backfillDerivedAssistant(doc, template))
            )
            assistants += results.filter(result => result.assistantBackfilled).length
            tasks += results.reduce((total, result) => total + result.tasksBackfilled, 0)
        }
    }
    await markerRef.set({
        completed: true,
        version: TEMPLATE_SYNC_BACKFILL_VERSION,
        completedAt: Date.now(),
        assistants,
        tasks,
    })
    return { alreadyCompleted: false, assistants, tasks, version: TEMPLATE_SYNC_BACKFILL_VERSION }
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
                patch[conflict.field] = FieldValue.delete()
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
    syncDerivedTask,
    backfillDerivedAssistant,
    backfillDerivedTask,
    runTemplateSyncBackfill,
    buildSyncActivityText,
}
