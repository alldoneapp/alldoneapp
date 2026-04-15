'use strict'

const moment = require('moment-timezone')

const { ProjectService } = require('./ProjectService')
const { TaskRetrievalService } = require('./TaskRetrievalService')

const FEED_PUBLIC_FOR_ALL = 0
const DEFAULT_NOTE_LIMIT = 50
const MAX_NOTE_LIMIT = 500

class NoteRetrievalService {
    constructor(options = {}) {
        this.options = {
            database: null,
            moment,
            isCloudFunction: false,
            storageBucket: null,
            ...options,
        }

        this.initialized = false
    }

    async initialize() {
        if (this.initialized) return

        if (!this.options.database) {
            throw new Error('Database interface is required for NoteRetrievalService')
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
        const a = NoteRetrievalService.normalizeProjectNameForLookup(projectNameA)
        const b = NoteRetrievalService.normalizeProjectNameForLookup(projectNameB)
        return !!a && !!b && (a === b || a.includes(b) || b.includes(a))
    }

    static normalizeLimit(limit) {
        const numericLimit = Number(limit)
        if (!Number.isFinite(numericLimit) || numericLimit <= 0) {
            return DEFAULT_NOTE_LIMIT
        }
        return Math.min(Math.trunc(numericLimit), MAX_NOTE_LIMIT)
    }

    static compareNotes(a, b) {
        const editedDiff = (b.lastEditedAt || 0) - (a.lastEditedAt || 0)
        if (editedDiff !== 0) return editedDiff

        const titleDiff = String(a.title || '').localeCompare(String(b.title || ''), undefined, {
            sensitivity: 'base',
        })
        if (titleDiff !== 0) return titleDiff

        return String(a.id || '').localeCompare(String(b.id || ''))
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
                !NoteRetrievalService.projectNamesMatch(projectFromId.name, normalizedProjectName)
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
                NoteRetrievalService.normalizeProjectNameForLookup(project.name) === normalizedProjectName.toLowerCase()
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
            NoteRetrievalService.projectNamesMatch(project.name, normalizedProjectName)
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

        if (parsed?.field && parsed?.value !== null && parsed?.value !== undefined) {
            return {
                start: parsed.operator === '>=' ? Number(parsed.value) : Number.MIN_SAFE_INTEGER,
                end: parsed.operator === '<=' ? Number(parsed.value) : Number.MAX_SAFE_INTEGER,
            }
        }

        return null
    }

    async getProjectNotes(projectId, userId) {
        const snapshot = await this.options.database
            .collection(`noteItems/${projectId}/notes`)
            .where('isPublicFor', 'array-contains-any', [FEED_PUBLIC_FOR_ALL, userId])
            .get()

        const notes = []
        snapshot.forEach(doc => {
            notes.push({
                noteId: doc.id,
                ...(doc.data() || {}),
            })
        })

        return notes
    }

    async loadNoteContent(projectId, noteId) {
        try {
            const { NoteService } = require('./NoteService')
            const noteService = new NoteService({
                database: this.options.database,
                moment: this.options.moment,
                isCloudFunction: this.options.isCloudFunction,
                storageBucket: this.options.storageBucket,
            })
            await noteService.initialize()
            const content = await noteService.getStorageContent(projectId, noteId)
            return content || ''
        } catch (error) {
            console.warn(`NoteRetrievalService: Failed to load content for note ${noteId}:`, error.message)
            return '[Content could not be loaded]'
        }
    }

    mapNote(note, project, content) {
        return {
            id: note.noteId,
            projectId: project.id,
            projectName: project.name || project.id,
            title: note.extendedTitle || note.title || 'Untitled Note',
            content,
            createdAt: note.created || note.createdDate || null,
            lastEditedAt: Number(note.lastEditionDate) || 0,
            wordCount: content ? content.split(/\s+/).filter(Boolean).length : 0,
        }
    }

    async getNotes(params = {}) {
        await this.ensureInitialized()

        const {
            userId,
            projectId = '',
            projectName = '',
            date = null,
            limit = DEFAULT_NOTE_LIMIT,
            timezoneOffset = null,
        } = params

        if (!userId) {
            throw new Error('userId is required')
        }

        const normalizedLimit = NoteRetrievalService.normalizeLimit(limit)
        const normalizedDate = typeof date === 'string' && date.trim() ? date.trim() : null
        const dateRange = this.buildDateRange(normalizedDate, timezoneOffset)
        const { projects, targetProject } = await this.resolveProjectTarget(userId, projectId, projectName)

        const projectsToQuery = targetProject ? [targetProject] : projects
        if (projectsToQuery.length === 0) {
            return {
                notes: [],
                count: 0,
                appliedFilters: {
                    allProjects: !targetProject,
                    projectId: targetProject?.id || null,
                    projectName: targetProject?.name || null,
                    date: normalizedDate,
                    limit: normalizedLimit,
                },
            }
        }

        const noteLists = await Promise.all(
            projectsToQuery.map(async project => {
                const projectNotes = await this.getProjectNotes(project.id, userId)

                const filtered = projectNotes.filter(note => {
                    if (!dateRange) return true
                    const lastEditedAt = Number(note.lastEditionDate) || 0
                    return lastEditedAt >= dateRange.start && lastEditedAt <= dateRange.end
                })

                return filtered.map(note => ({ note, project }))
            })
        )

        const allNotes = noteLists
            .flat()
            .sort((a, b) => {
                const aEdited = Number(a.note.lastEditionDate) || 0
                const bEdited = Number(b.note.lastEditionDate) || 0
                return bEdited - aEdited
            })
            .slice(0, normalizedLimit)

        const notesWithContent = await Promise.all(
            allNotes.map(async ({ note, project }) => {
                const content = await this.loadNoteContent(project.id, note.noteId)
                return this.mapNote(note, project, content)
            })
        )

        return {
            notes: notesWithContent,
            count: notesWithContent.length,
            appliedFilters: {
                allProjects: !targetProject,
                projectId: targetProject?.id || null,
                projectName: targetProject?.name || null,
                date: normalizedDate,
                limit: normalizedLimit,
            },
        }
    }
}

module.exports = {
    NoteRetrievalService,
    DEFAULT_NOTE_LIMIT,
    MAX_NOTE_LIMIT,
}
