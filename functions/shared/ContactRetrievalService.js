'use strict'

const moment = require('moment-timezone')

const { ProjectService } = require('./ProjectService')
const { TaskRetrievalService } = require('./TaskRetrievalService')

const FEED_PUBLIC_FOR_ALL = 0
const DEFAULT_CONTACT_LIMIT = 100
const MAX_CONTACT_LIMIT = 1000

class ContactRetrievalService {
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
            throw new Error('Database interface is required for ContactRetrievalService')
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
        const a = ContactRetrievalService.normalizeProjectNameForLookup(projectNameA)
        const b = ContactRetrievalService.normalizeProjectNameForLookup(projectNameB)
        return !!a && !!b && (a === b || a.includes(b) || b.includes(a))
    }

    static normalizeLimit(limit) {
        const numericLimit = Number(limit)
        if (!Number.isFinite(numericLimit) || numericLimit <= 0) {
            return DEFAULT_CONTACT_LIMIT
        }
        return Math.min(Math.trunc(numericLimit), MAX_CONTACT_LIMIT)
    }

    static normalizeEmails(contact = {}) {
        const emails = []
        const seen = new Set()

        ;[...(Array.isArray(contact.emails) ? contact.emails : []), contact.email]
            .filter(value => typeof value === 'string' && value.trim())
            .forEach(value => {
                const normalized = value.trim()
                const key = normalized.toLowerCase()
                if (seen.has(key)) return
                seen.add(key)
                emails.push(normalized)
            })

        return emails
    }

    static compareContacts(a, b) {
        const editedDiff = (b.lastEditedAt || 0) - (a.lastEditedAt || 0)
        if (editedDiff !== 0) return editedDiff

        const nameDiff = String(a.displayName || '').localeCompare(String(b.displayName || ''), undefined, {
            sensitivity: 'base',
        })
        if (nameDiff !== 0) return nameDiff

        return String(a.contactId || '').localeCompare(String(b.contactId || ''))
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
                !ContactRetrievalService.projectNamesMatch(projectFromId.name, normalizedProjectName)
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
                ContactRetrievalService.normalizeProjectNameForLookup(project.name) ===
                normalizedProjectName.toLowerCase()
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
            ContactRetrievalService.projectNamesMatch(project.name, normalizedProjectName)
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

    async getProjectContacts(projectId, userId) {
        const snapshot = await this.options.database
            .collection(`projectsContacts/${projectId}/contacts`)
            .where('isPublicFor', 'array-contains-any', [FEED_PUBLIC_FOR_ALL, userId])
            .get()

        const contacts = []
        snapshot.forEach(doc => {
            contacts.push({
                contactId: doc.id,
                ...(doc.data() || {}),
            })
        })

        return contacts
    }

    mapContact(contact, project) {
        const emails = ContactRetrievalService.normalizeEmails(contact)

        return {
            contactId: contact.contactId || contact.uid || null,
            projectId: project.id,
            projectName: project.name || project.id,
            displayName: contact.displayName || '',
            email: contact.email || '',
            emails,
            company: contact.company || '',
            role: contact.role || '',
            phone: contact.phone || '',
            linkedInUrl: contact.linkedInUrl || '',
            description: contact.description || '',
            lastEditedAt: Number(contact.lastEditionDate) || 0,
        }
    }

    async getContacts(params = {}) {
        await this.ensureInitialized()

        const {
            userId,
            projectId = '',
            projectName = '',
            date = null,
            limit = DEFAULT_CONTACT_LIMIT,
            timezoneOffset = null,
        } = params

        if (!userId) {
            throw new Error('userId is required')
        }

        const normalizedLimit = ContactRetrievalService.normalizeLimit(limit)
        const normalizedDate = typeof date === 'string' && date.trim() ? date.trim() : null
        const dateRange = this.buildDateRange(normalizedDate, timezoneOffset)
        const { projects, targetProject } = await this.resolveProjectTarget(userId, projectId, projectName)

        const projectsToQuery = targetProject ? [targetProject] : projects
        if (projectsToQuery.length === 0) {
            return {
                contacts: [],
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

        const contactLists = await Promise.all(
            projectsToQuery.map(async project => {
                const projectContacts = await this.getProjectContacts(project.id, userId)

                return projectContacts
                    .filter(contact => {
                        if (!dateRange) return true
                        const lastEditedAt = Number(contact.lastEditionDate) || 0
                        return lastEditedAt >= dateRange.start && lastEditedAt <= dateRange.end
                    })
                    .map(contact => this.mapContact(contact, project))
            })
        )

        const contacts = contactLists.flat().sort(ContactRetrievalService.compareContacts).slice(0, normalizedLimit)

        return {
            contacts,
            count: contacts.length,
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
    ContactRetrievalService,
    DEFAULT_CONTACT_LIMIT,
    MAX_CONTACT_LIMIT,
}
