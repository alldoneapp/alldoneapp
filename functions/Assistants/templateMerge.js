const { isEqual } = require('lodash')

const ASSISTANT_LOCAL_FIELDS = new Set([
    'uid',
    'creatorId',
    'createdDate',
    'lastEditorId',
    'lastEditionDate',
    'noteIdsByProject',
    'lastVisitBoard',
    'commentsData',
    'isDefault',
    'fromTemplate',
    'instructionsHistory',
    'heartbeatPromptHistory',
    'copiedFromTemplateAssistantId',
    'copiedFromTemplateAssistantDate',
    'templateSyncSnapshot',
    'templateSyncConflicts',
    'templateSyncStatus',
    'templateSyncedAt',
])

const TASK_LOCAL_FIELDS = new Set([
    'id',
    'assistantId',
    'copiedFromTemplateTaskId',
    'copiedFromTemplateTaskDate',
    'templateTaskSnapshot',
    'templateTaskSyncConflicts',
    'templateSyncStatus',
    'templateTaskDeletedAt',
    'activatedInProjectId',
    'lastExecuted',
    'lastExecutedByUser',
    'creatorUserId',
    'activatorUserId',
    'recurrenceByUser',
    'activatedUserIds',
])

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key)

function copyTemplateFields(object, excludedFields) {
    return Object.keys(object || {}).reduce((result, field) => {
        if (!excludedFields.has(field)) result[field] = object[field]
        return result
    }, {})
}

function getAssistantTemplateState(assistant) {
    return copyTemplateFields(assistant, ASSISTANT_LOCAL_FIELDS)
}

function getTaskTemplateState(task) {
    const state = copyTemplateFields(task, TASK_LOCAL_FIELDS)
    if (task?.recurrence && task.recurrence !== 'never') {
        delete state.startDate
        delete state.startTime
        delete state.userTimezone
    }
    return state
}

function serializableValue(object, field) {
    return hasOwn(object, field) ? object[field] : null
}

/**
 * Three-way merge at top-level document fields. Objects/arrays are deliberately
 * atomic: settings such as tool access and MCP servers must be reviewed as one
 * coherent value instead of producing invalid partial configurations.
 */
function mergeTemplateState(previousTemplate, currentTemplate, localState) {
    const patch = {}
    const deleteFields = []
    const conflicts = []
    const fields = new Set([...Object.keys(previousTemplate || {}), ...Object.keys(currentTemplate || {})])

    fields.forEach(field => {
        const existedBefore = hasOwn(previousTemplate, field)
        const existsNow = hasOwn(currentTemplate, field)
        const templateChanged =
            existedBefore !== existsNow ||
            (existedBefore && existsNow && !isEqual(previousTemplate[field], currentTemplate[field]))
        if (!templateChanged) return

        const localMatchesPrevious =
            hasOwn(localState, field) === existedBefore &&
            (!existedBefore || isEqual(localState[field], previousTemplate[field]))

        if (localMatchesPrevious) {
            if (existsNow) patch[field] = currentTemplate[field]
            else deleteFields.push(field)
            return
        }

        // A local value which already equals the new template is resolved.
        if (
            hasOwn(localState, field) === existsNow &&
            (!existsNow || isEqual(localState[field], currentTemplate[field]))
        ) {
            return
        }

        conflicts.push({
            field,
            previousTemplateValue: serializableValue(previousTemplate, field),
            previousTemplateValueExists: existedBefore,
            localValue: serializableValue(localState, field),
            localValueExists: hasOwn(localState, field),
            templateValue: serializableValue(currentTemplate, field),
            templateValueExists: existsNow,
        })
    })

    return { patch, deleteFields, conflicts }
}

function isTaskUnmodified(previousTemplateTask, localTask) {
    const previous = getTaskTemplateState(previousTemplateTask)
    const local = getTaskTemplateState(localTask)
    return isEqual(previous, local)
}

function buildBackfillConflicts(templateState, localState) {
    return Object.keys(templateState || {})
        .filter(field => !hasOwn(localState, field) || !isEqual(localState[field], templateState[field]))
        .map(field => ({
            field,
            previousTemplateValue: null,
            previousTemplateValueExists: false,
            localValue: hasOwn(localState, field) ? localState[field] : null,
            localValueExists: hasOwn(localState, field),
            templateValue: templateState[field],
            templateValueExists: true,
        }))
}

module.exports = {
    ASSISTANT_LOCAL_FIELDS,
    TASK_LOCAL_FIELDS,
    getAssistantTemplateState,
    getTaskTemplateState,
    mergeTemplateState,
    isTaskUnmodified,
    buildBackfillConflicts,
}
