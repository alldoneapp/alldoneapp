/**
 * TaskFeedGenerator - Universal task feed creation utility
 *
 * This module provides consistent feed generation logic for task events
 * across all platforms and contexts (MCP Server, Assistant, Frontend, Cloud Functions).
 */

// Constants - these should match the constants used in the main app
const FEED_TASK_CREATED = 'FEED_TASK_CREATED'
const FEED_TASK_FOLLOWED = 'FEED_TASK_FOLLOWED'
const FEED_TASK_UPDATED = 'FEED_TASK_UPDATED'
const FEED_PUBLIC_FOR_ALL = 'FEED_PUBLIC_FOR_ALL'
const OPEN_STEP = 'Open'

/**
 * Generates current date objects for feed creation
 * @param {Object} moment - Moment.js instance (optional)
 * @returns {Object} Date objects
 */
function generateCurrentDateObject(moment) {
    const currentDate = moment ? moment() : new Date()
    const currentMilliseconds = currentDate.valueOf ? currentDate.valueOf() : currentDate.getTime()

    // Format date as DDMMYYYY
    const currentDateFormated = moment ? currentDate.format('DDMMYYYY') : formatDateDDMMYYYY(currentDate)

    return { currentDate, currentDateFormated, currentMilliseconds }
}

/**
 * Formats date as DDMMYYYY for compatibility when moment is not available
 * @param {Date} date - JavaScript Date object
 * @returns {string} Formatted date string
 */
function formatDateDDMMYYYY(date) {
    const day = String(date.getDate()).padStart(2, '0')
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const year = String(date.getFullYear())
    return day + month + year
}

/**
 * Generates a unique ID for feeds
 * @param {Function} idGenerator - Custom ID generator (optional)
 * @returns {string} Unique ID
 */
function generateFeedId(idGenerator) {
    if (idGenerator && typeof idGenerator === 'function') {
        return idGenerator()
    }

    // Fallback ID generation
    return 'feed_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
}

/**
 * Generates a feed model for task events
 * @param {Object} params - Feed parameters
 * @param {string} params.feedType - Type of feed event
 * @param {number} params.lastChangeDate - Timestamp of change
 * @param {string} params.entryText - Description text for the feed
 * @param {Object} params.feedUser - User creating the feed
 * @param {string} params.objectId - Task ID
 * @param {Array} params.isPublicFor - Visibility array
 * @param {Function} params.idGenerator - Custom ID generator
 * @returns {Object} Feed model with ID
 */
function generateFeedModel({ feedType, lastChangeDate, entryText, feedUser, objectId, isPublicFor, idGenerator }) {
    const uid = feedUser.uid || feedUser.id || feedUser.userId

    const feed = {
        type: feedType,
        lastChangeDate,
        creatorId: uid,
        objectId,
        isPublicFor: isPublicFor || [FEED_PUBLIC_FOR_ALL],
    }

    if (entryText) {
        feed.entryText = entryText
    }

    const feedId = generateFeedId(idGenerator)
    return { feed, feedId }
}

/**
 * Generates a task object model for feeds
 * @param {number} currentMilliseconds - Current timestamp
 * @param {Object} task - Task object
 * @param {string} taskId - Task ID
 * @returns {Object} Task feed object model
 */
function generateTaskObjectModel(currentMilliseconds, task, taskId) {
    return {
        type: 'task',
        parentId: task.parentId || '',
        subtaskIds: task.subtaskIds || [],
        lastChangeDate: currentMilliseconds,
        taskId: taskId,
        name: task.extendedName || task.name,
        assigneeEstimation: (task.estimations && task.estimations[OPEN_STEP]) || 0,
        recurrence: task.recurrence || 'never',
        isDone: Boolean(task.done),
        isDeleted: false,
        privacy: task.isPrivate ? task.userId || task.userIds?.[0] || '' : 'public',
        linkBack: task.linkBack || '',
        comments: task.comments || [],
        userId: task.userId || task.userIds?.[0] || '',
        genericData: task.genericData || null,
        isPublicFor:
            task.isPublicFor || (task.isPrivate ? [task.userId || task.userIds?.[0] || ''] : [FEED_PUBLIC_FOR_ALL]),
        lockKey: task.lockKey || '',
    }
}

/**
 * Creates a task created feed
 * @param {Object} params - Feed creation parameters
 * @param {string} params.projectId - Project ID
 * @param {Object} params.task - Task object
 * @param {string} params.taskId - Task ID
 * @param {Object} params.feedUser - User creating the feed
 * @param {Object} params.moment - Moment.js instance (optional)
 * @param {Function} params.idGenerator - Custom ID generator (optional)
 * @returns {Object} Feed data ready for persistence
 */
function createTaskCreatedFeed({ projectId, task, taskId, feedUser, moment, idGenerator }) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject(moment)
    const taskFeedObject = generateTaskObjectModel(currentMilliseconds, task, taskId)

    const isSubtask = Boolean(task.parentId)

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_CREATED,
        lastChangeDate: currentMilliseconds,
        entryText: isSubtask ? 'created subtask' : 'created task',
        feedUser,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
        idGenerator,
    })

    return {
        feed,
        feedId,
        taskFeedObject,
        currentDateFormated,
        currentMilliseconds,
        isSubtask,
        projectId,
    }
}

/**
 * Creates a task followed feed
 * @param {Object} params - Feed creation parameters
 * @param {string} params.projectId - Project ID
 * @param {string} params.taskId - Task ID
 * @param {Object} params.feedUser - User creating the feed
 * @param {Object} params.taskFeedObject - Existing task feed object
 * @param {Object} params.moment - Moment.js instance (optional)
 * @param {Function} params.idGenerator - Custom ID generator (optional)
 * @returns {Object} Feed data ready for persistence
 */
function createTaskFollowedFeed({ projectId, taskId, feedUser, taskFeedObject, moment, idGenerator }) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject(moment)

    if (!taskFeedObject) {
        throw new Error('Task feed object is required for follow feed')
    }

    const isSubtask = Boolean(taskFeedObject.parentId)

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_FOLLOWED,
        lastChangeDate: currentMilliseconds,
        entryText: isSubtask ? 'started following the subtask' : 'started following the task',
        feedUser,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
        idGenerator,
    })

    return {
        feed,
        feedId,
        taskFeedObject,
        currentDateFormated,
        currentMilliseconds,
        isSubtask,
        projectId,
    }
}

/**
 * Creates a generic task update feed
 * @param {Object} params - Feed creation parameters
 * @param {string} params.projectId - Project ID
 * @param {string} params.taskId - Task ID
 * @param {Object} params.feedUser - User creating the feed
 * @param {Object} params.taskFeedObject - Existing task feed object
 * @param {string} params.updateType - Type of update (e.g., 'name_changed', 'description_updated')
 * @param {string} params.entryText - Custom entry text for the feed
 * @param {Object} params.moment - Moment.js instance (optional)
 * @param {Function} params.idGenerator - Custom ID generator (optional)
 * @returns {Object} Feed data ready for persistence
 */
function createTaskUpdateFeed({
    projectId,
    taskId,
    feedUser,
    taskFeedObject,
    updateType,
    entryText,
    moment,
    idGenerator,
}) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject(moment)

    if (!taskFeedObject) {
        throw new Error('Task feed object is required for update feed')
    }

    const { feed, feedId } = generateFeedModel({
        feedType: updateType || FEED_TASK_UPDATED,
        lastChangeDate: currentMilliseconds,
        entryText: entryText,
        feedUser,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
        idGenerator,
    })

    return {
        feed,
        feedId,
        taskFeedObject,
        currentDateFormated,
        currentMilliseconds,
        projectId,
    }
}

/**
 * Validates feed creation parameters
 * @param {Object} params - Parameters to validate
 */
function validateFeedParams(params) {
    const { projectId, taskId, feedUser } = params

    if (!projectId || typeof projectId !== 'string') {
        throw new Error('Project ID is required and must be a string')
    }

    if (!taskId || typeof taskId !== 'string') {
        throw new Error('Task ID is required and must be a string')
    }

    if (!feedUser || typeof feedUser !== 'object') {
        throw new Error('Feed user is required and must be an object')
    }

    const userId = feedUser.uid || feedUser.id || feedUser.userId
    if (!userId) {
        throw new Error('Feed user must have a valid ID (uid, id, or userId)')
    }
}

/**
 * Creates appropriate feed for task events with validation
 * @param {string} eventType - Type of event ('created', 'followed', 'updated')
 * @param {Object} params - Event parameters
 * @returns {Object} Feed data ready for persistence
 */
function createTaskEventFeed(eventType, params) {
    validateFeedParams(params)

    switch (eventType) {
        case 'created':
            return createTaskCreatedFeed(params)
        case 'followed':
            return createTaskFollowedFeed(params)
        case 'updated':
            return createTaskUpdateFeed(params)
        default:
            throw new Error(`Unsupported event type: ${eventType}`)
    }
}

// CommonJS export - works with Node.js and can be converted by bundlers
module.exports = {
    generateCurrentDateObject,
    generateFeedModel,
    generateTaskObjectModel,
    createTaskCreatedFeed,
    createTaskFollowedFeed,
    createTaskUpdateFeed,
    createTaskEventFeed,
    validateFeedParams,
    // Constants
    FEED_TASK_CREATED,
    FEED_TASK_FOLLOWED,
    FEED_TASK_UPDATED,
    FEED_PUBLIC_FOR_ALL,
    OPEN_STEP,
    default: createTaskEventFeed,
}
