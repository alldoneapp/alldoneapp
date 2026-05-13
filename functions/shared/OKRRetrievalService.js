'use strict'

const { ProjectService } = require('./ProjectService')
const {
    OKRS_COLLECTION,
    OKR_STATUS_ACTIVE,
    calculateOkrPace,
    getRemainingText,
    mapOKRData,
    normalizeStatus,
    resolveOkrDataForProject,
} = require('./OKRHelper')

const DEFAULT_OKR_LIMIT = 100
const MAX_OKR_LIMIT = 1000

class OKRRetrievalService {
    constructor(options = {}) {
        this.options = {
            database: null,
            now: Date.now,
            ...options,
        }
        this.initialized = false
    }

    async initialize() {
        if (this.initialized) return
        if (!this.options.database) throw new Error('Database interface is required for OKRRetrievalService')
        this.initialized = true
    }

    static normalizeProjectNameForLookup(value) {
        return typeof value === 'string' ? value.trim().toLowerCase() : ''
    }

    static projectNamesMatch(projectNameA, projectNameB) {
        const a = OKRRetrievalService.normalizeProjectNameForLookup(projectNameA)
        const b = OKRRetrievalService.normalizeProjectNameForLookup(projectNameB)
        return !!a && !!b && (a === b || a.includes(b) || b.includes(a))
    }

    static normalizeLimit(limit) {
        const numericLimit = Number(limit)
        if (!Number.isFinite(numericLimit) || numericLimit <= 0) return DEFAULT_OKR_LIMIT
        return Math.min(Math.trunc(numericLimit), MAX_OKR_LIMIT)
    }

    getNow() {
        const now = typeof this.options.now === 'function' ? this.options.now() : Number(this.options.now)
        return Number.isFinite(now) ? now : Date.now()
    }

    async getAccessibleProjects(userId) {
        const projectService = new ProjectService({ database: this.options.database })
        await projectService.initialize()
        return projectService.getUserProjects(userId, {
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
            if (!projectFromId) throw new Error(`Target project not found or not accessible: "${normalizedProjectId}"`)
            if (
                normalizedProjectName &&
                !OKRRetrievalService.projectNamesMatch(projectFromId.name, normalizedProjectName)
            ) {
                throw new Error(
                    `Target project mismatch: projectId "${normalizedProjectId}" does not match projectName "${normalizedProjectName}".`
                )
            }
            return { projects, targetProject: projectFromId }
        }

        if (!normalizedProjectName) return { projects, targetProject: null }

        const exactMatches = projects.filter(
            project =>
                OKRRetrievalService.normalizeProjectNameForLookup(project.name) === normalizedProjectName.toLowerCase()
        )
        if (exactMatches.length === 1) return { projects, targetProject: exactMatches[0] }
        if (exactMatches.length > 1)
            throw new Error(`Multiple projects match "${normalizedProjectName}". Please use projectId.`)

        const partialMatches = projects.filter(project =>
            OKRRetrievalService.projectNamesMatch(project.name, normalizedProjectName)
        )
        if (partialMatches.length === 1) return { projects, targetProject: partialMatches[0] }
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

    resolveProjectsScope(projects, targetProject, allProjects, currentProjectId) {
        if (targetProject) return [targetProject]
        if (allProjects !== false) return projects

        const currentProject = projects.find(project => project.id === currentProjectId)
        if (!currentProject) throw new Error('Current project not found or not accessible for OKR retrieval.')
        return [currentProject]
    }

    async getProjectOKRs(project, ownerId, status, periodStart, periodEnd) {
        let query = this.options.database
            .collection(`okrs/${project.id}/${OKRS_COLLECTION}`)
            .where('ownerId', '==', ownerId)
        if (status !== 'all') query = query.where('status', '==', status)

        const snapshot = await query.get()
        const okrs = []
        const now = this.getNow()
        for (const doc of snapshot.docs) {
            const okr = await resolveOkrDataForProject(this.options.database, project, mapOKRData(doc.id, doc.data()))
            const pace = calculateOkrPace(okr, now)
            if (Number.isFinite(periodStart) && okr.periodEnd < periodStart) continue
            if (Number.isFinite(periodEnd) && okr.periodStart > periodEnd) continue
            okrs.push({
                ...okr,
                projectName: project.name || project.id,
                remaining: getRemainingText(okr.periodEnd, now),
                expectedProgressPercent: pace.expectedPercent,
                paceDeltaPercent: pace.delta,
                paceStatus: pace.status,
                paceLabel: pace.label,
            })
        }
        return okrs
    }

    async getOKRs(options = {}) {
        await this.initialize()
        const {
            userId,
            ownerId,
            currentProjectId = '',
            projectId = '',
            projectName = '',
            allProjects = false,
            status = OKR_STATUS_ACTIVE,
            periodStart,
            periodEnd,
            limit,
        } = options

        if (!userId) throw new Error('userId is required for getOKRs')
        const effectiveOwnerId = ownerId && ownerId === userId ? ownerId : userId
        const normalizedStatus = normalizeStatus(status)
        const normalizedLimit = OKRRetrievalService.normalizeLimit(limit)
        const normalizedPeriodStart = Number(periodStart)
        const normalizedPeriodEnd = Number(periodEnd)

        const { projects, targetProject } = await this.resolveProjectTarget(userId, projectId, projectName)
        const scopedProjects = this.resolveProjectsScope(projects, targetProject, allProjects, currentProjectId)

        const projectResults = await Promise.all(
            scopedProjects.map(project =>
                this.getProjectOKRs(
                    project,
                    effectiveOwnerId,
                    normalizedStatus,
                    normalizedPeriodStart,
                    normalizedPeriodEnd
                )
            )
        )

        const okrs = projectResults
            .flat()
            .sort((a, b) => {
                if (a.status !== b.status) return a.status === OKR_STATUS_ACTIVE ? -1 : 1
                if (a.periodEnd !== b.periodEnd) return a.periodEnd - b.periodEnd
                return String(a.label).localeCompare(String(b.label), undefined, { sensitivity: 'base' })
            })
            .slice(0, normalizedLimit)

        const effectiveTargetProject = targetProject || (allProjects === false ? scopedProjects[0] : null)
        return {
            okrs,
            count: okrs.length,
            appliedFilters: {
                status: normalizedStatus,
                allProjects: !effectiveTargetProject && allProjects !== false,
                projectId: effectiveTargetProject ? effectiveTargetProject.id : null,
                projectName: effectiveTargetProject ? effectiveTargetProject.name || effectiveTargetProject.id : null,
                ownerId: effectiveOwnerId,
                limit: normalizedLimit,
            },
        }
    }
}

module.exports = {
    OKRRetrievalService,
}
