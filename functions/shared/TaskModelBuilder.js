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

// Import constants that are used across different environments
const OPEN_STEP = 'Open'
const FEED_PUBLIC_FOR_ALL = 'FEED_PUBLIC_FOR_ALL'

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
    recurrence = 'never',
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
    const finalIsPublicFor = isPrivate ? [userId] : [FEED_PUBLIC_FOR_ALL, userId].filter(Boolean)

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
        currentReviewerId: userId,
        assigneeType: assigneeType,

        // Observers and privacy
        observersIds: observersIds || [],
        dueDateByObserversIds: {},
        estimationsByObserverIds: {},
        isPrivate: isPrivate,
        isPublicFor: finalIsPublicFor,

        // Workflow and steps
        stepHistory: [OPEN_STEP],
        estimations: finalEstimations,

        // Dates and timing
        created: now,
        startDate: now,
        startTime: moment ? moment(now).format('HH:mm') : new Date(now).toTimeString().substring(0, 5),
        dueDate: finalDueDate,
        alertEnabled: false,
        completed: null,
        completedTime: null,
        lastEditionDate: now,
        lastEditorId: userId,

        // Creation metadata
        creatorId: userId,
        hasStar: hasStar,
        sortIndex: now,

        // Hierarchy and relationships
        parentId: parentId,
        isSubtask: Boolean(parentId),
        subtaskIds: [],
        subtaskNames: [],
        parentDone: false,
        parentGoalId: parentGoalId,
        parentGoalIsPublicFor: null,

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
    validateTaskParams,
    createTaskObject,
    OPEN_STEP,
    FEED_PUBLIC_FOR_ALL,
    default: createTaskObject,
}
