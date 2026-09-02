/**
 * TaskModelBuilder - Universal task object creation utility
 *
 * This module provides a pure function to build complete task objects
 * with all required fields, ensuring consistency across:
 * - MCP Server
 * - Assistant Tool calls
 * - Frontend UI components
 * - Cloud Functions
 * - Any other task creation contexts
 */

// Constants - these MUST match the constants in Utils/HelperFunctionsCloud.js
const OPEN_STEP = 'Open'
const FEED_PUBLIC_FOR_ALL = 0 // Must be 0 (number) to match HelperFunctionsCloud.js
const TASK_PRIORITIES = new Set(['none', 'do_later', 'could_do', 'should_do', 'must_do'])

/**
 * A task that belongs to a goal must carry that goal's `isPublicFor` as `parentGoalIsPublicFor`:
 * the open-task lists group a task under its goal only when this array says the reader may see
 * the goal (`processTaskChange` in utils/backends/openTasks.js), and a task with a `parentGoalId`
 * but no array is filed under "no goal" while still pointing at one. That is exactly what every
 * recurrence copy used to produce: `recurringTasksCloud` clones the completed task into these
 * params, so `parentGoalId` came through while this field was hardcoded to null - the new
 * occurrence silently dropped out of its goal group in every list, week after week. Pass the
 * caller's array through; a goal id with no usable array falls back to public-for-all, which is the
 * same default `mapGoalData` applies to a goal document that has no `isPublicFor` of its own.
 */
function resolveParentGoalIsPublicFor(parentGoalId, parentGoalIsPublicFor) {
    if (!parentGoalId) return null
    if (Array.isArray(parentGoalIsPublicFor) && parentGoalIsPublicFor.length > 0) return parentGoalIsPublicFor
    return [FEED_PUBLIC_FOR_ALL]
}

/**
 * Builds a complete task object with all required fields
 * @param {Object} params - Task creation parameters
 * @param {string} params.name - Task name (required)
 * @param {string} params.description - Task description (optional)
 * @param {string} params.userId - User ID who creates/owns the task (required)
 * @param {string} params.projectId - Project ID where task belongs (required)
 * @param {string} params.taskId - Unique task ID (required)
 * @param {number} params.dueDate - Due date timestamp (optional, defaults to now)
 * @param {boolean} params.isPrivate - Whether task is private (optional, defaults to false)
 * @param {Array} params.userIds - Array of user IDs with access (optional, defaults to [userId])
 * @param {string} params.assigneeType - Type of assignee (optional, defaults to 'USER')
 * @param {number} params.now - Current timestamp (optional, defaults to Date.now())
 * @param {Object} params.moment - Moment.js instance for time formatting (optional)
 * @returns {Object} Complete task object ready for persistence
 */
function buildTaskObject({
    // Required fields
    name,
    userId,
    projectId,
    taskId,

    // Optional fields with defaults
    description = '',
    dueDate = null,
    isPrivate = false,
    userIds = null,
    assigneeType = 'USER',
    now = Date.now(),
    moment = null,

    // Advanced optional fields
    parentId = null,
    isSubtask = false,
    parentGoalId = null,
    parentGoalIsPublicFor = null,
    recurrence = 'never',
    recurrenceOriginalDueDate = null,
    recurrenceBaseDateOverride = null,
    hasStar = '#FFFFFF',
    estimations = null,
    observersIds = [],
    linkBack = '',
    noteId = null,
    containerNotesIds = [],
    assistantId = '',
    isPremium = false,
    lockKey = '',
    calendarData = null,
    gmailData = null,
    genericData = null,
    suggestedBy = null,
    autoEstimation = null,
    humanReadableId = null,
    autoFollowUpManaged = false,
    autoFollowUpType = null,
    autoFollowUpContactId = null,
    autoFollowUpStatusId = null,
    priority = 'none',
    executionMode = 'workflow',
    workflowTask = false,
    workflowPayerUserId = null,
    workflowAiPromptOverride = null,
    assistantScheduleSource = null,
    isAssistantEnabled = false,
    aiModel = null,
    aiTemperature = null,
    aiReasoningEffort = null,
    aiSystemMessage = null,
    taskMetadata = null,
    stepHistory = null,
    currentReviewerId = null,
    completed = null,
    creatorId = null,
    projectRouting = null,
}) {
    // Validation
    if (!name || !name.trim()) {
        throw new Error('Task name is required')
    }
    if (!userId) {
        throw new Error('User ID is required')
    }
    if (!projectId) {
        throw new Error('Project ID is required')
    }
    if (!taskId) {
        throw new Error('Task ID is required')
    }

    // Set defaults for derived fields
    const trimmedName = name.trim()
    const finalDueDate = dueDate || now
    const finalUserIds = userIds || [userId]
    const finalEstimations = estimations || { [OPEN_STEP]: 0 }

    // Determine privacy settings
    const finalIsPublicFor = isPrivate
        ? [userId]
        : [FEED_PUBLIC_FOR_ALL, userId].filter(value => value !== null && value !== undefined && value !== '')

    // Build the complete task object matching Alldone's schema
    const task = {
        // Core identification
        id: taskId,
        name: trimmedName,
        extendedName: trimmedName,
        description: description || '',

        // Status fields
        done: false,
        inDone: false,

        // User assignment
        userId: userId,
        userIds: finalUserIds,
        currentReviewerId: currentReviewerId || userId,
        assigneeType: assigneeType,
        executionMode: executionMode === 'direct' ? 'direct' : 'workflow',
        workflowTask: workflowTask === true,
        workflowPayerUserId,
        workflowAiPromptOverride,

        // Observers and privacy
        observersIds: observersIds || [],
        dueDateByObserversIds: {},
        estimationsByObserverIds: {},
        isPrivate: isPrivate,
        isPublicFor: finalIsPublicFor,

        // Workflow and steps
        stepHistory: stepHistory || [OPEN_STEP],
        estimations: finalEstimations,

        // Dates and timing
        created: now,
        startDate: now,
        startTime: moment ? moment(now).format('HH:mm') : new Date(now).toTimeString().substring(0, 5),
        dueDate: finalDueDate,
        alertEnabled: false,
        completed,
        completedTime: null,
        lastEditionDate: now,
        lastEditorId: userId,

        // Creation metadata
        creatorId: creatorId || userId,
        hasStar: hasStar,
        priority: TASK_PRIORITIES.has(priority) ? priority : 'none',
        sortIndex: now,

        // Hierarchy and relationships
        parentId: parentId,
        isSubtask: Boolean(parentId),
        subtaskIds: [],
        subtaskNames: [],
        parentDone: false,
        parentGoalId: parentGoalId,
        parentGoalIsPublicFor: resolveParentGoalIsPublicFor(parentGoalId, parentGoalIsPublicFor),

        // Linking and references
        linkedParentNotesIds: [],
        linkedParentTasksIds: [],
        linkedParentContactsIds: [],
        linkedParentProjectsIds: [],
        linkedParentGoalsIds: [],
        linkedParentSkillsIds: [],
        linkedParentAssistantIds: [],
        linkBack: linkBack,
        noteId: noteId,
        containerNotesIds: containerNotesIds || [],

        // Recurrence and scheduling
        recurrence: recurrence,
        recurrenceOriginalDueDate: recurrenceOriginalDueDate,
        recurrenceBaseDateOverride: recurrenceBaseDateOverride,

        // Statistics and counters
        timesPostponed: 0,
        timesFollowed: 0,
        timesDoneInExpectedDay: 0,
        timesDone: 0,

        // Comments and data
        comments: [],
        commentsData: null,
        genericData: genericData,

        // External integrations
        calendarData: calendarData,
        gmailData: gmailData,

        // AI and assistance
        assistantId: assistantId,
        assistantScheduleSource,
        isAssistantEnabled: isAssistantEnabled === true,
        aiModel,
        aiTemperature,
        aiReasoningEffort,
        aiSystemMessage,
        taskMetadata,
        autoEstimation: autoEstimation,
        suggestedBy: suggestedBy,

        // Premium and security
        isPremium: isPremium,
        lockKey: lockKey,

        // Review workflow
        inReview: null,
        toReview: null,

        // Human readable ID (if generated)
        humanReadableId: humanReadableId,
        ...(projectRouting ? { projectRouting } : {}),
        autoFollowUpManaged: autoFollowUpManaged,
        autoFollowUpType: autoFollowUpType,
        autoFollowUpContactId: autoFollowUpContactId,
        autoFollowUpStatusId: autoFollowUpStatusId,
    }

    return task
}

/**
 * Validates task creation parameters
 * @param {Object} params - Parameters to validate
 * @throws {Error} If validation fails
 */
function validateTaskParams(params) {
    const { name, userId, projectId, taskId } = params

    if (!name || typeof name !== 'string' || !name.trim()) {
        throw new Error('Task name must be a non-empty string')
    }
    if (!userId || typeof userId !== 'string') {
        throw new Error('User ID must be a non-empty string')
    }
    if (!projectId || typeof projectId !== 'string') {
        throw new Error('Project ID must be a non-empty string')
    }
    if (!taskId || typeof taskId !== 'string') {
        throw new Error('Task ID must be a non-empty string')
    }

    // Optional field validations
    if (params.dueDate !== null && params.dueDate !== undefined) {
        if (typeof params.dueDate !== 'number' || params.dueDate < 0) {
            throw new Error('Due date must be a positive timestamp')
        }
    }
    if (params.userIds && !Array.isArray(params.userIds)) {
        throw new Error('User IDs must be an array')
    }
    if (params.observersIds && !Array.isArray(params.observersIds)) {
        throw new Error('Observer IDs must be an array')
    }
}

/**
 * Creates a task object with validation
 * @param {Object} params - Task creation parameters
 * @returns {Object} Complete validated task object
 */
function createTaskObject(params) {
    validateTaskParams(params)
    return buildTaskObject(params)
}

// CommonJS export - works with Node.js and can be converted by bundlers
module.exports = {
    buildTaskObject,
    resolveParentGoalIsPublicFor,
    validateTaskParams,
    createTaskObject,
    OPEN_STEP,
    FEED_PUBLIC_FOR_ALL,
    default: createTaskObject,
}
