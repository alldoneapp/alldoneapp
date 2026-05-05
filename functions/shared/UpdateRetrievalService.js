'use strict'

const moment = require('moment-timezone')

const { ProjectService } = require('./ProjectService')
const { TaskRetrievalService } = require('./TaskRetrievalService')

const FEED_PUBLIC_FOR_ALL = 0
const DEFAULT_UPDATE_LIMIT = 100
const MAX_UPDATE_LIMIT = 500
const VALID_OBJECT_TYPES = ['tasks', 'notes', 'goals', 'contacts', 'projects', 'users', 'skills', 'assistants']

const EVENT_TYPE_TO_OBJECT_TYPE = new Map([
    [9, 'tasks'],
    [10, 'tasks'],
    [11, 'tasks'],
    [12, 'tasks'],
    [13, 'tasks'],
    [14, 'tasks'],
    [15, 'tasks'],
    [16, 'tasks'],
    [17, 'tasks'],
    [18, 'tasks'],
    [19, 'tasks'],
    [20, 'tasks'],
    [21, 'tasks'],
    [22, 'tasks'],
    [23, 'tasks'],
    [231, 'tasks'],
    [24, 'tasks'],
    [26, 'tasks'],
    [27, 'tasks'],
    [28, 'tasks'],
    [566, 'tasks'],
    [575, 'tasks'],
    [576, 'tasks'],
    [577, 'tasks'],
    [578, 'tasks'],
    [579, 'tasks'],
    [580, 'tasks'],
    ['FEED_TASK_UPDATED', 'tasks'],
    ['FEED_TASK_FOCUS_CHANGED', 'tasks'],
    ['FEED_TASK_ASSISTANT_CHANGED', 'tasks'],
    ['FEED_TASK_OBSERVER_ESTIMATION_CHANGED', 'tasks'],

    [29, 'projects'],
    [30, 'projects'],
    [31, 'projects'],
    [32, 'projects'],
    [321, 'projects'],
    [33, 'projects'],
    [34, 'projects'],
    [35, 'projects'],
    [36, 'projects'],
    [38, 'projects'],
    [39, 'projects'],
    [40, 'projects'],
    [571, 'projects'],
    ['FEED_PROJECT_GUIDE_CHANGED', 'projects'],
    ['FEED_PROJECT_ESTIMATION_TYPE_CHANGED', 'projects'],
    ['FEED_PROJECT_ASSISTANT_CHANGED', 'projects'],

    [41, 'contacts'],
    [42, 'contacts'],
    [43, 'contacts'],
    [44, 'contacts'],
    [45, 'contacts'],
    [46, 'contacts'],
    [47, 'contacts'],
    [48, 'contacts'],
    [49, 'contacts'],
    [51, 'contacts'],
    [52, 'contacts'],
    [53, 'contacts'],
    [531, 'contacts'],
    [568, 'contacts'],
    [573, 'contacts'],
    ['FEED_CONTACT_ASSISTANT_CHANGED', 'contacts'],

    [54, 'users'],
    [55, 'users'],
    [562, 'users'],
    [563, 'users'],
    [564, 'users'],
    [565, 'users'],
    [56, 'users'],
    [58, 'users'],
    [59, 'users'],
    [60, 'users'],
    [61, 'users'],
    [62, 'users'],
    [561, 'users'],
    [567, 'users'],
    [572, 'users'],
    [574, 'users'],

    [63, 'notes'],
    [65, 'notes'],
    [66, 'notes'],
    [67, 'notes'],
    [68, 'notes'],
    [69, 'notes'],
    [70, 'notes'],
    [71, 'notes'],
    [72, 'notes'],
    [73, 'notes'],
    [74, 'notes'],
    [75, 'notes'],
    [76, 'notes'],
    [570, 'notes'],
    ['FEED_NOTE_UPDATED', 'notes'],
    ['FEED_NOTE_ASSISTANT_CHANGED', 'notes'],

    [80, 'goals'],
    [81, 'goals'],
    [82, 'goals'],
    [83, 'goals'],
    [84, 'goals'],
    [85, 'goals'],
    [86, 'goals'],
    [88, 'goals'],
    [89, 'goals'],
    [90, 'goals'],
    [91, 'goals'],
    [92, 'goals'],
    [93, 'goals'],
    [95, 'goals'],
    ['FEED_GOAL_ASSISTANT_CHANGED', 'goals'],

    ['SKILL_CREATED', 'skills'],
    ['SKILL_DELETED', 'skills'],
    ['SKILL_TITLE_CHANGED', 'skills'],
    ['SKILL_PRIVACY_CHANGED', 'skills'],
    ['FEED_SKILL_CHANGES_POINTS', 'skills'],
    ['SKILL_DESCRIPTION_CHANGED', 'skills'],
    ['SKILL_HIGHLIGHTED_CHANGED', 'skills'],
    ['SKILL_PROJECT_CHANGED', 'skills'],
    ['SKILL_FOLLOWED', 'skills'],
    ['SKILL_UNFOLLOWED', 'skills'],
    ['SKILL_BACKLINK', 'skills'],
    ['FEED_SKILL_COMPLETION_CHANGED', 'skills'],
    ['FEED_SKILL_ASSISTANT_CHANGED', 'skills'],

    ['FEED_ASSISTANT_CREATED', 'assistants'],
    ['FEED_ASSISTANT_DELETED', 'assistants'],
    ['FEED_ASSISTANT_NAME_CHANGED', 'assistants'],
    ['FEED_ASSISTANT_DESCRIPTION_CHANGED', 'assistants'],
    ['FEED_ASSISTANT_BACKLINK', 'assistants'],
    ['FEED_ASSISTANT_FOLLOWED', 'assistants'],
    ['FEED_ASSISTANT_UNFOLLOWED', 'assistants'],
    ['FEED_ASSISTANT_PICTURE_CHANGED', 'assistants'],
    ['FEED_ASSISTANT_TYPE_CHANGED', 'assistants'],
    ['FEED_ASSISTANT_INSTRUCTIONS_CHANGED', 'assistants'],
    ['FEED_ASSISTANT_MODEL_CHANGED', 'assistants'],
    ['FEED_ASSISTANT_TEMPERATURE_CHANGED', 'assistants'],
])

class UpdateRetrievalService {
    constructor(options = {}) {
        this.options = {
            database: null,
            moment,
            ...options,
        }
        this.initialized = false
    }

    async initialize() {
        if (this.initialized) return
        if (!this.options.database) {
            throw new Error('Database interface is required for UpdateRetrievalService')
        }
        this.initialized = true
    }

    static normalizeLimit(limit) {
        const numericLimit = Number(limit)
        if (!Number.isFinite(numericLimit) || numericLimit <= 0) {
            return DEFAULT_UPDATE_LIMIT
        }
        return Math.min(Math.trunc(numericLimit), MAX_UPDATE_LIMIT)
    }

    static normalizeRecentHours(recentHours) {
        if (recentHours === undefined || recentHours === null || recentHours === '') return null
        const numericHours = Number(recentHours)
        if (!Number.isFinite(numericHours) || numericHours <= 0 || numericHours > 720) return null
        return numericHours
    }

    static normalizeProjectNameForLookup(value) {
        return typeof value === 'string' ? value.trim().toLowerCase() : ''
    }

    static projectNamesMatch(projectNameA, projectNameB) {
        const a = UpdateRetrievalService.normalizeProjectNameForLookup(projectNameA)
        const b = UpdateRetrievalService.normalizeProjectNameForLookup(projectNameB)
        return !!a && !!b && (a === b || a.includes(b) || b.includes(a))
    }

    static normalizeObjectTypes(objectTypes) {
        if (objectTypes === undefined || objectTypes === null) return null

        const rawTypes = Array.isArray(objectTypes) ? objectTypes : [objectTypes]
        const normalizedTypes = rawTypes
            .map(type => (typeof type === 'string' ? type.trim().toLowerCase() : ''))
            .filter(Boolean)

        if (normalizedTypes.length === 0) return null

        const invalidTypes = normalizedTypes.filter(type => !VALID_OBJECT_TYPES.includes(type))
        if (invalidTypes.length > 0) {
            throw new Error(
                `Invalid object type${invalidTypes.length === 1 ? '' : 's'}: ${invalidTypes.join(
                    ', '
                )}. Valid types are: ${VALID_OBJECT_TYPES.join(', ')}.`
            )
        }

        return [...new Set(normalizedTypes)]
    }

    getObjectTypeForEvent(eventType) {
        return EVENT_TYPE_TO_OBJECT_TYPE.get(eventType) || null
    }

    buildDateRange(date, timezoneOffset = null) {
        if (typeof date !== 'string' || date.trim().length === 0) return null

        const taskRetrievalService = new TaskRetrievalService({
            database: this.options.database,
            moment: this.options.moment,
        })

        const parsed = taskRetrievalService.buildDateFilters(date, 'done', timezoneOffset)
        if (parsed?.operator === 'range' && parsed?.value) {
            return parsed.value
        }

        return null
    }

    buildRecentHoursRange(recentHours) {
        const hours = UpdateRetrievalService.normalizeRecentHours(recentHours)
        if (hours === null) return null

        const now = this.options.moment()
        return {
            start: now.valueOf() - hours * 60 * 60 * 1000,
            end: now.valueOf(),
            recentHours: hours,
        }
    }

    async getAccessibleProjects(userId, options = {}) {
        const projectService = new ProjectService({ database: this.options.database })
        await projectService.initialize()

        return await projectService.getUserProjects(userId, {
            includeArchived: options.includeArchived === true,
            includeCommunity: options.includeCommunity === true,
        })
    }

    async resolveProjectTarget(userId, requestedProjectId, requestedProjectName, options = {}) {
        const normalizedProjectId = typeof requestedProjectId === 'string' ? requestedProjectId.trim() : ''
        const normalizedProjectName = typeof requestedProjectName === 'string' ? requestedProjectName.trim() : ''

        const projects = await this.getAccessibleProjects(userId, options)
        const projectsById = new Map(projects.map(project => [project.id, project]))

        if (normalizedProjectId) {
            const projectFromId = projectsById.get(normalizedProjectId)
            if (!projectFromId) {
                throw new Error(`Target project not found or not accessible: "${normalizedProjectId}"`)
            }

            if (
                normalizedProjectName &&
                !UpdateRetrievalService.projectNamesMatch(projectFromId.name, normalizedProjectName)
            ) {
                throw new Error(
                    `Target project mismatch: projectId "${normalizedProjectId}" does not match projectName "${normalizedProjectName}".`
                )
            }

            return { projects, targetProject: projectFromId }
        }

        if (!normalizedProjectName) {
            return { projects, targetProject: null }
        }

        const exactMatches = projects.filter(
            project =>
                UpdateRetrievalService.normalizeProjectNameForLookup(project.name) ===
                normalizedProjectName.toLowerCase()
        )

        if (exactMatches.length === 1) {
            return { projects, targetProject: exactMatches[0] }
        }

        if (exactMatches.length > 1) {
            const optionsText = exactMatches
                .slice(0, 5)
                .map(project => `"${project.name}" (${project.id})`)
                .join(', ')
            throw new Error(`Multiple projects match "${normalizedProjectName}": ${optionsText}. Please use projectId.`)
        }

        const partialMatches = projects.filter(project =>
            UpdateRetrievalService.projectNamesMatch(project.name, normalizedProjectName)
        )

        if (partialMatches.length === 1) {
            return { projects, targetProject: partialMatches[0] }
        }

        if (partialMatches.length > 1) {
            const optionsText = partialMatches
                .slice(0, 5)
                .map(project => `"${project.name}" (${project.id})`)
                .join(', ')
            throw new Error(
                `Multiple projects partially match "${normalizedProjectName}": ${optionsText}. Please use projectId.`
            )
        }

        throw new Error(`No project found matching "${normalizedProjectName}".`)
    }

    buildProjectUpdatesQuery(projectId, userId, dateRange, limit) {
        let query = this.options.database
            .collection(`feedsStore/${projectId}/all`)
            .where('isPublicFor', 'array-contains-any', [FEED_PUBLIC_FOR_ALL, userId])

        if (dateRange?.start) {
            query = query.where('lastChangeDate', '>=', dateRange.start)
        }

        if (dateRange?.end) {
            query = query.where('lastChangeDate', '<=', dateRange.end)
        }

        return query.orderBy('lastChangeDate', 'desc').limit(limit)
    }

    mapUpdate(doc, project) {
        const feed = doc.data() || {}
        const eventType = feed.type
        const objectType = this.getObjectTypeForEvent(eventType)

        return {
            id: doc.id,
            projectId: project.id,
            projectName: project.name || project.id,
            objectType,
            objectId: feed.objectId || '',
            objectTitle: '',
            eventType,
            eventText: typeof feed.entryText === 'string' ? feed.entryText : '',
            creatorId: feed.creatorId || '',
            creatorName: '',
            updatedAt: Number(feed.lastChangeDate) || 0,
        }
    }

    async enrichUpdates(updates) {
        const db = this.options.database
        const objectRefs = []
        const objectKeys = []
        const creatorRefs = []
        const creatorIds = []

        updates.forEach(update => {
            if (update.objectType && update.objectId) {
                objectRefs.push(
                    db.doc(`feedsObjectsLastStates/${update.projectId}/${update.objectType}/${update.objectId}`)
                )
                objectKeys.push(`${update.projectId}/${update.objectType}/${update.objectId}`)
            }

            if (update.creatorId && !creatorIds.includes(update.creatorId)) {
                creatorIds.push(update.creatorId)
                creatorRefs.push(db.collection('users').doc(update.creatorId))
            }
        })

        const objectSnapshots = objectRefs.length > 0 ? await db.getAll(...objectRefs) : []
        const creatorSnapshots = creatorRefs.length > 0 ? await db.getAll(...creatorRefs) : []

        const objectTitlesByKey = {}
        objectSnapshots.forEach((snapshot, index) => {
            if (!snapshot.exists) return
            const data = snapshot.data() || {}
            const title = data.name || data.title || data.displayName || data.extendedName || data.extendedTitle || ''
            objectTitlesByKey[objectKeys[index]] = typeof title === 'string' ? title : ''
        })

        const creatorNamesById = {}
        creatorSnapshots.forEach((snapshot, index) => {
            if (!snapshot.exists) return
            const data = snapshot.data() || {}
            const name = data.displayName || data.fullName || data.name || data.shortName || ''
            creatorNamesById[creatorIds[index]] = typeof name === 'string' ? name : ''
        })

        return updates.map(update => {
            const objectKey = `${update.projectId}/${update.objectType}/${update.objectId}`
            const enrichedUpdate = {
                ...update,
                objectTitle: objectTitlesByKey[objectKey] || update.objectTitle,
            }

            const creatorName = creatorNamesById[update.creatorId]
            if (creatorName) {
                enrichedUpdate.creatorName = creatorName
            } else {
                delete enrichedUpdate.creatorName
            }

            return enrichedUpdate
        })
    }

    async getUpdates(params = {}) {
        await this.initialize()

        const userId = typeof params.userId === 'string' ? params.userId.trim() : ''
        if (!userId) {
            throw new Error('userId is required for getUpdates')
        }

        const limit = UpdateRetrievalService.normalizeLimit(params.limit)
        const recentHoursWasProvided = params.recentHours !== undefined && params.recentHours !== null
        const recentHoursRange = this.buildRecentHoursRange(params.recentHours)
        if (recentHoursWasProvided && recentHoursRange === null) {
            throw new Error('recentHours must be a positive number of hours up to 720')
        }

        const dateRange = recentHoursRange || this.buildDateRange(params.date, params.timezoneOffset)
        const objectTypes = UpdateRetrievalService.normalizeObjectTypes(params.objectTypes)
        const { projects, targetProject } = await this.resolveProjectTarget(
            userId,
            params.projectId || '',
            params.projectName || '',
            {
                includeArchived: params.includeArchived === true,
                includeCommunity: params.includeCommunity === true,
            }
        )

        const allProjects = params.allProjects !== false && !targetProject
        const targetProjects = targetProject
            ? [targetProject]
            : allProjects
            ? projects
            : projects.filter(p => p.id === params.currentProjectId)

        if (targetProjects.length === 0) {
            return {
                updates: [],
                count: 0,
                appliedFilters: {
                    allProjects,
                    projectId: targetProject ? targetProject.id : params.currentProjectId || null,
                    projectName: targetProject ? targetProject.name || null : null,
                    date: recentHoursRange ? null : params.date || null,
                    recentHours: recentHoursRange?.recentHours || null,
                    objectTypes,
                    limit,
                    includeArchived: params.includeArchived === true,
                    includeCommunity: params.includeCommunity === true,
                },
                queriedProjects: [],
            }
        }

        const perProjectLimit = limit
        const projectResults = await Promise.all(
            targetProjects.map(async project => {
                const snapshot = await this.buildProjectUpdatesQuery(
                    project.id,
                    userId,
                    dateRange,
                    perProjectLimit
                ).get()
                return snapshot.docs.map(doc => this.mapUpdate(doc, project))
            })
        )

        let updates = projectResults.flat()
        if (objectTypes) {
            updates = updates.filter(update => update.objectType === null || objectTypes.includes(update.objectType))
        }

        updates = updates.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
        updates = await this.enrichUpdates(updates)

        return {
            updates,
            count: updates.length,
            appliedFilters: {
                allProjects,
                projectId: targetProject ? targetProject.id : !allProjects ? params.currentProjectId || null : null,
                projectName: targetProject ? targetProject.name || null : null,
                date: recentHoursRange ? null : params.date || null,
                recentHours: recentHoursRange?.recentHours || null,
                objectTypes,
                limit,
                includeArchived: params.includeArchived === true,
                includeCommunity: params.includeCommunity === true,
            },
            queriedProjects: targetProjects.map(project => ({
                id: project.id,
                name: project.name || project.id,
                type: project.projectType || project.type || 'regular',
            })),
        }
    }
}

module.exports = {
    UpdateRetrievalService,
    VALID_OBJECT_TYPES,
    EVENT_TYPE_TO_OBJECT_TYPE,
}
