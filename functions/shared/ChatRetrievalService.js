const moment = require('moment-timezone')

const { ProjectService } = require('./ProjectService')
const { TaskRetrievalService } = require('./TaskRetrievalService')

const FEED_PUBLIC_FOR_ALL = 0
const DEFAULT_CHAT_LIMIT = 10
const MAX_CHAT_LIMIT = 100
const CHAT_MESSAGE_LIMIT = 50
const VALID_CHAT_TYPES = ['topics', 'tasks', 'notes', 'contacts', 'goals', 'skills', 'assistants']

class ChatRetrievalService {
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
            throw new Error('Database interface is required for ChatRetrievalService')
        }

        this.initialized = true
    }

    async ensureInitialized() {
        if (!this.initialized) {
            await this.initialize()
        }
    }

    static normalizeProjectNameForLookup(value) {
        return typeof value === 'string' ? value.trim().toLowerCase() : ''
    }

    static projectNamesMatch(projectNameA, projectNameB) {
        const a = ChatRetrievalService.normalizeProjectNameForLookup(projectNameA)
        const b = ChatRetrievalService.normalizeProjectNameForLookup(projectNameB)
        return !!a && !!b && (a === b || a.includes(b) || b.includes(a))
    }

    static normalizeLimit(limit) {
        const numericLimit = Number(limit)
        if (!Number.isFinite(numericLimit) || numericLimit <= 0) {
            return DEFAULT_CHAT_LIMIT
        }
        return Math.min(Math.trunc(numericLimit), MAX_CHAT_LIMIT)
    }

    static normalizeTypes(types) {
        const normalizedInput =
            types === undefined || types === null ? ['topics'] : Array.isArray(types) ? types : [types]

        const normalizedTypes = normalizedInput
            .map(type => (typeof type === 'string' ? type.trim().toLowerCase() : ''))
            .filter(Boolean)

        if (normalizedTypes.length === 0) {
            throw new Error('types must contain at least one valid chat type')
        }

        const invalidTypes = normalizedTypes.filter(type => !VALID_CHAT_TYPES.includes(type))
        if (invalidTypes.length > 0) {
            throw new Error(
                `Invalid chat type${invalidTypes.length === 1 ? '' : 's'}: ${invalidTypes.join(
                    ', '
                )}. Valid types are: ${VALID_CHAT_TYPES.join(', ')}.`
            )
        }

        return [...new Set(normalizedTypes)]
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

    async getAccessibleProjects(userId) {
        const projectService = new ProjectService({ database: this.options.database })
        await projectService.initialize()

        return await projectService.getUserProjects(userId, {
            includeArchived: false,
            includeCommunity: false,
        })
    }

    async resolveProjectTarget(userId, requestedProjectId, requestedProjectName) {
        const normalizedProjectId = typeof requestedProjectId === 'string' ? requestedProjectId.trim() : ''
        const normalizedProjectName = typeof requestedProjectName === 'string' ? requestedProjectName.trim() : ''

        const projects = await this.getAccessibleProjects(userId)
        const projectsById = new Map(projects.map(project => [project.id, project]))

        if (normalizedProjectId) {
            const projectFromId = projectsById.get(normalizedProjectId)
            if (!projectFromId) {
                throw new Error(`Target project not found or not accessible: "${normalizedProjectId}"`)
            }

            if (
                normalizedProjectName &&
                !ChatRetrievalService.projectNamesMatch(projectFromId.name, normalizedProjectName)
            ) {
                throw new Error(
                    `Target project mismatch: projectId "${normalizedProjectId}" does not match projectName "${normalizedProjectName}".`
                )
            }

            return {
                projects,
                targetProject: projectFromId,
            }
        }

        if (!normalizedProjectName) {
            return {
                projects,
                targetProject: null,
            }
        }

        const exactMatches = projects.filter(
            project =>
                ChatRetrievalService.normalizeProjectNameForLookup(project.name) === normalizedProjectName.toLowerCase()
        )

        if (exactMatches.length === 1) {
            return {
                projects,
                targetProject: exactMatches[0],
            }
        }

        if (exactMatches.length > 1) {
            const options = exactMatches
                .slice(0, 5)
                .map(project => `"${project.name}" (${project.id})`)
                .join(', ')
            throw new Error(`Multiple projects match "${normalizedProjectName}": ${options}. Please use projectId.`)
        }

        const partialMatches = projects.filter(project =>
            ChatRetrievalService.projectNamesMatch(project.name, normalizedProjectName)
        )

        if (partialMatches.length === 1) {
            return {
                projects,
                targetProject: partialMatches[0],
            }
        }

        if (partialMatches.length > 1) {
            const options = partialMatches
                .slice(0, 5)
                .map(project => `"${project.name}" (${project.id})`)
                .join(', ')
            throw new Error(
                `Multiple projects partially match "${normalizedProjectName}": ${options}. Please use projectId.`
            )
        }

        throw new Error(`No project found matching "${normalizedProjectName}".`)
    }

    buildProjectChatQuery(projectId, userId, types, dateRange, limit) {
        let query = this.options.database
            .collection(`chatObjects/${projectId}/chats`)
            .where('isPublicFor', 'array-contains-any', [FEED_PUBLIC_FOR_ALL, userId])

        if (types.length === 1) {
            query = query.where('type', '==', types[0])
        } else {
            query = query.where('type', 'in', types)
        }

        if (dateRange?.start) {
            query = query.where('lastEditionDate', '>=', dateRange.start)
        }

        if (dateRange?.end) {
            query = query.where('lastEditionDate', '<=', dateRange.end)
        }

        return query.orderBy('lastEditionDate', 'desc').limit(limit)
    }

    mapChatThread(doc, project) {
        const chat = doc.data() || {}
        return {
            documentId: doc.id,
            projectId: project.id,
            projectName: project.name || project.id,
            type: chat.type || 'topics',
            title: chat.title || chat.name || '',
            lastActivityAt: Number(chat.lastEditionDate) || 0,
            createdAt: Number(chat.created) || null,
            lastCommentPreview: chat?.commentsData?.lastComment || '',
        }
    }

    async getRecentChatMessages(projectId, chatType, chatId, limit = CHAT_MESSAGE_LIMIT) {
        const snapshot = await this.options.database
            .collection(`chatComments/${projectId}/${chatType}/${chatId}/comments`)
            .orderBy('created', 'desc')
            .limit(Math.max(1, Math.min(Number(limit) || CHAT_MESSAGE_LIMIT, CHAT_MESSAGE_LIMIT)))
            .get()

        const messages = []
        snapshot.forEach(doc => {
            const data = doc.data() || {}
            messages.push({
                messageId: doc.id,
                role: data.fromAssistant ? 'assistant' : 'user',
                text: typeof data.commentText === 'string' ? data.commentText : '',
                createdAt: Number(data.created || data.lastChangeDate) || 0,
                fromAssistant: !!data.fromAssistant,
            })
        })

        return messages.reverse()
    }

    async getChats(params = {}) {
        await this.ensureInitialized()

        const {
            userId,
            projectId = '',
            projectName = '',
            types,
            date = null,
            limit = DEFAULT_CHAT_LIMIT,
            timezoneOffset = null,
        } = params

        if (!userId) {
            throw new Error('userId is required')
        }

        const normalizedTypes = ChatRetrievalService.normalizeTypes(types)
        const normalizedLimit = ChatRetrievalService.normalizeLimit(limit)
        const normalizedDate = typeof date === 'string' && date.trim() ? date.trim() : null
        const dateRange = this.buildDateRange(normalizedDate, timezoneOffset)
        const { projects, targetProject } = await this.resolveProjectTarget(userId, projectId, projectName)

        const projectsToQuery = targetProject ? [targetProject] : projects
        if (projectsToQuery.length === 0) {
            return {
                chats: [],
                count: 0,
                appliedFilters: {
                    types: normalizedTypes,
                    date: normalizedDate,
                    limit: normalizedLimit,
                    projectId: targetProject?.id || null,
                    projectName: targetProject?.name || null,
                },
            }
        }

        const perProjectLimit = normalizedLimit
        const chatLists = await Promise.all(
            projectsToQuery.map(async project => {
                const snapshot = await this.buildProjectChatQuery(
                    project.id,
                    userId,
                    normalizedTypes,
                    dateRange,
                    perProjectLimit
                ).get()

                const chats = []
                snapshot.forEach(doc => {
                    chats.push(this.mapChatThread(doc, project))
                })
                return chats
            })
        )

        const mergedChats = chatLists
            .flat()
            .sort((a, b) => {
                const activityDiff = (b.lastActivityAt || 0) - (a.lastActivityAt || 0)
                if (activityDiff !== 0) return activityDiff

                const createdDiff = (b.createdAt || 0) - (a.createdAt || 0)
                if (createdDiff !== 0) return createdDiff

                return String(a.documentId).localeCompare(String(b.documentId))
            })
            .slice(0, normalizedLimit)

        const chats = await Promise.all(
            mergedChats.map(async chat => ({
                ...chat,
                messages: await this.getRecentChatMessages(chat.projectId, chat.type, chat.documentId),
            }))
        )

        return {
            chats,
            count: chats.length,
            appliedFilters: {
                types: normalizedTypes,
                date: normalizedDate,
                limit: normalizedLimit,
                projectId: targetProject?.id || null,
                projectName: targetProject?.name || null,
            },
        }
    }
}

module.exports = {
    ChatRetrievalService,
    VALID_CHAT_TYPES,
    DEFAULT_CHAT_LIMIT,
    MAX_CHAT_LIMIT,
    CHAT_MESSAGE_LIMIT,
}
