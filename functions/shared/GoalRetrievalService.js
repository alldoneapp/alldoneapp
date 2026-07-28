'use strict'

const { ProjectService } = require('./ProjectService')
const { mapGoalData, mapMilestoneData } = require('../Utils/MapDataFuncions')
const { ALL_USERS, BACKLOG_DATE_NUMERIC, BACKLOG_MILESTONE_ID } = require('../Utils/HelperFunctionsCloud')

const DEFAULT_GOAL_LIMIT = 100
const MAX_GOAL_LIMIT = 1000
const VALID_GOAL_STATUS = ['active', 'done', 'all']

class GoalRetrievalService {
    constructor(options = {}) {
        this.options = {
            database: null,
            ...options,
        }

        this.initialized = false
    }

    async initialize() {
        if (this.initialized) return

        if (!this.options.database) {
            throw new Error('Database interface is required for GoalRetrievalService')
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
        const a = GoalRetrievalService.normalizeProjectNameForLookup(projectNameA)
        const b = GoalRetrievalService.normalizeProjectNameForLookup(projectNameB)
        return !!a && !!b && (a === b || a.includes(b) || b.includes(a))
    }

    static normalizeStatus(status) {
        if (status === undefined || status === null || status === '') return 'active'

        const normalizedStatus = typeof status === 'string' ? status.trim().toLowerCase() : ''
        if (!VALID_GOAL_STATUS.includes(normalizedStatus)) {
            throw new Error(`Invalid status "${status}". Valid statuses are: ${VALID_GOAL_STATUS.join(', ')}.`)
        }

        return normalizedStatus
    }

    static normalizeLimit(limit) {
        const numericLimit = Number(limit)
        if (!Number.isFinite(numericLimit) || numericLimit <= 0) {
            return DEFAULT_GOAL_LIMIT
        }
        return Math.min(Math.trunc(numericLimit), MAX_GOAL_LIMIT)
    }

    static normalizeProgressRecord(progressRecord) {
        if (typeof progressRecord === 'number') {
            return {
                progress: progressRecord,
                doneDate: null,
            }
        }

        if (progressRecord && typeof progressRecord === 'object') {
            return {
                progress: Number.isFinite(Number(progressRecord.progress)) ? Number(progressRecord.progress) : null,
                doneDate: Number.isFinite(Number(progressRecord.doneDate)) ? Number(progressRecord.doneDate) : null,
            }
        }

        return {
            progress: null,
            doneDate: null,
        }
    }

    static compareNames(a, b) {
        return String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' })
    }

    getGoalsOwnerId(project, userId) {
        return project?.parentTemplateId ? userId : ALL_USERS
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
                !GoalRetrievalService.projectNamesMatch(projectFromId.name, normalizedProjectName)
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
                GoalRetrievalService.normalizeProjectNameForLookup(project.name) === normalizedProjectName.toLowerCase()
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
            GoalRetrievalService.projectNamesMatch(project.name, normalizedProjectName)
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

    resolveProjectsScope(projects, targetProject, allProjects, currentProjectId) {
        if (targetProject) return [targetProject]
        if (allProjects !== false) return projects

        const normalizedCurrentProjectId =
            typeof currentProjectId === 'string' ? currentProjectId.trim() : currentProjectId || ''
        const currentProject = projects.find(project => project.id === normalizedCurrentProjectId)
        if (!currentProject) {
            throw new Error('Current project not found or not accessible for goal retrieval.')
        }

        return [currentProject]
    }

    async getProjectGoals(projectId, ownerId) {
        const snapshot = await this.options.database
            .collection(`goals/${projectId}/items`)
            .where('ownerId', '==', ownerId)
            .get()

        const goals = []
        snapshot.forEach(doc => {
            goals.push(mapGoalData(doc.id, doc.data()))
        })
        return goals
    }

    async getProjectMilestones(projectId, ownerId, done) {
        const snapshot = await this.options.database
            .collection(`goalsMilestones/${projectId}/milestonesItems`)
            .where('done', '==', done)
            .where('ownerId', '==', ownerId)
            .orderBy('date', done ? 'desc' : 'asc')
            .get()

        const milestones = []
        snapshot.forEach(doc => {
            milestones.push(mapMilestoneData(doc.id, doc.data()))
        })
        return milestones
    }

    goalIsVisibleInOpenMilestone(goal, milestone) {
        return goal.startingMilestoneDate <= milestone.date && goal.completionMilestoneDate >= milestone.date
    }

    buildGoalBase(goal, project) {
        return {
            id: goal.id,
            name: goal.name,
            description: goal.description || '',
            progress: goal.progress,
            projectId: project.id,
            projectName: project.name || project.id,
            ownerId: goal.ownerId,
            assigneesIds: Array.isArray(goal.assigneesIds) ? goal.assigneesIds : [],
            commentsData: goal.commentsData || null,
        }
    }

    buildMilestoneSummary(milestone) {
        if (!milestone) return null

        return {
            id: milestone.id,
            date: milestone.date,
            extendedName: milestone.extendedName || '',
            ownerId: milestone.ownerId,
        }
    }

    buildActiveGoalEntries(project, goals, openMilestones, currentMilestoneOnly) {
        const currentMilestone = openMilestones[0] || null

        return goals
            .map(goal => {
                const visibleOpenMilestones = openMilestones.filter(milestone =>
                    this.goalIsVisibleInOpenMilestone(goal, milestone)
                )
                const isBacklog =
                    goal.completionMilestoneDate === BACKLOG_DATE_NUMERIC &&
                    goal.startingMilestoneDate === BACKLOG_DATE_NUMERIC &&
                    goal.progress !== 100

                if (currentMilestoneOnly) {
                    if (!currentMilestone || !this.goalIsVisibleInOpenMilestone(goal, currentMilestone)) {
                        return null
                    }

                    return {
                        ...this.buildGoalBase(goal, project),
                        status: 'active',
                        startingMilestoneDate: goal.startingMilestoneDate,
                        completionMilestoneDate: goal.completionMilestoneDate,
                        isBacklog: false,
                        matchedMilestone: this.buildMilestoneSummary(currentMilestone),
                        _sortBucket: 'active',
                        _sortDate: currentMilestone.date,
                        _sortIndex: Number(goal.sortIndexByMilestone?.[currentMilestone.id]) || 0,
                    }
                }

                if (visibleOpenMilestones.length === 0 && !isBacklog) {
                    return null
                }

                const firstVisibleMilestone = visibleOpenMilestones[0] || null
                const sortMilestoneId = firstVisibleMilestone
                    ? firstVisibleMilestone.id
                    : `${BACKLOG_MILESTONE_ID}${project.id}`

                return {
                    ...this.buildGoalBase(goal, project),
                    status: 'active',
                    startingMilestoneDate: goal.startingMilestoneDate,
                    completionMilestoneDate: goal.completionMilestoneDate,
                    isBacklog,
                    matchedMilestone: null,
                    _sortBucket: 'active',
                    _sortDate: firstVisibleMilestone ? firstVisibleMilestone.date : BACKLOG_DATE_NUMERIC,
                    _sortIndex: Number(goal.sortIndexByMilestone?.[sortMilestoneId]) || 0,
                }
            })
            .filter(Boolean)
    }

    buildDoneGoalEntries(project, goals, doneMilestones) {
        const doneMilestonesById = new Map(doneMilestones.map(milestone => [milestone.id, milestone]))

        return goals
            .map(goal => {
                const matchingMilestones = (Array.isArray(goal.parentDoneMilestoneIds)
                    ? goal.parentDoneMilestoneIds
                    : []
                )
                    .map(milestoneId => doneMilestonesById.get(milestoneId))
                    .filter(Boolean)
                    .sort((a, b) => b.date - a.date)

                if (matchingMilestones.length === 0) {
                    return null
                }

                const latestMilestone = matchingMilestones[0]
                const doneMilestoneItems = matchingMilestones.map(milestone => {
                    const progressRecord = GoalRetrievalService.normalizeProgressRecord(
                        goal.progressByDoneMilestone?.[milestone.id]
                    )

                    return {
                        milestoneId: milestone.id,
                        date: milestone.date,
                        extendedName: milestone.extendedName || '',
                        progress: progressRecord.progress,
                    }
                })

                return {
                    ...this.buildGoalBase(goal, project),
                    status: 'done',
                    doneMilestones: doneMilestoneItems,
                    latestDoneMilestoneDate: latestMilestone.date,
                    _sortBucket: 'done',
                    _sortDate: latestMilestone.date,
                    _sortIndex: Number(goal.sortIndexByMilestone?.[latestMilestone.id]) || 0,
                }
            })
            .filter(Boolean)
    }

    mergeAllStatusEntries(activeEntries, doneEntries) {
        const merged = new Map()

        activeEntries.forEach(entry => {
            merged.set(entry.id, { ...entry })
        })

        doneEntries.forEach(doneEntry => {
            const existing = merged.get(doneEntry.id)
            if (!existing) {
                merged.set(doneEntry.id, { ...doneEntry })
                return
            }

            merged.set(doneEntry.id, {
                ...existing,
                status: 'both',
                doneMilestones: doneEntry.doneMilestones,
                latestDoneMilestoneDate: doneEntry.latestDoneMilestoneDate,
                _sortBucket: 'active',
            })
        })

        return Array.from(merged.values())
    }

    sortProjectEntries(entries, status) {
        return [...entries].sort((a, b) => {
            if (status === 'done') {
                if (b._sortDate !== a._sortDate) return b._sortDate - a._sortDate
                if (b._sortIndex !== a._sortIndex) return b._sortIndex - a._sortIndex
                return GoalRetrievalService.compareNames(a.name, b.name)
            }

            if (status === 'all') {
                const aBucket = a._sortBucket === 'done' ? 1 : 0
                const bBucket = b._sortBucket === 'done' ? 1 : 0
                if (aBucket !== bBucket) return aBucket - bBucket

                if (aBucket === 0) {
                    if (a._sortDate !== b._sortDate) return a._sortDate - b._sortDate
                } else if (b._sortDate !== a._sortDate) {
                    return b._sortDate - a._sortDate
                }

                if (b._sortIndex !== a._sortIndex) return b._sortIndex - a._sortIndex
                return GoalRetrievalService.compareNames(a.name, b.name)
            }

            if (a._sortDate !== b._sortDate) return a._sortDate - b._sortDate
            if (b._sortIndex !== a._sortIndex) return b._sortIndex - a._sortIndex
            return GoalRetrievalService.compareNames(a.name, b.name)
        })
    }

    stripSortFields(entry) {
        const cleanedEntry = { ...entry }
        delete cleanedEntry._sortBucket
        delete cleanedEntry._sortDate
        delete cleanedEntry._sortIndex

        if (!cleanedEntry.matchedMilestone) {
            delete cleanedEntry.matchedMilestone
        }

        return cleanedEntry
    }

    async getGoals(options = {}) {
        await this.ensureInitialized()

        const {
            userId,
            projectId,
            projectName,
            allProjects = true,
            currentProjectId = '',
            status,
            currentMilestoneOnly = false,
            limit,
        } = options

        if (!userId) {
            throw new Error('userId is required for getGoals')
        }

        const normalizedStatus = GoalRetrievalService.normalizeStatus(status)
        const normalizedLimit = GoalRetrievalService.normalizeLimit(limit)
        const normalizedCurrentMilestoneOnly = currentMilestoneOnly === true

        const { projects, targetProject } = await this.resolveProjectTarget(userId, projectId, projectName)
        const scopedProjects = this.resolveProjectsScope(projects, targetProject, allProjects, currentProjectId)

        const projectResults = await Promise.all(
            scopedProjects.map(async project => {
                const ownerId = this.getGoalsOwnerId(project, userId)
                const needsOpenMilestones = normalizedStatus === 'active' || normalizedStatus === 'all'
                const needsDoneMilestones = normalizedStatus === 'done' || normalizedStatus === 'all'

                const [goals, openMilestones, doneMilestones] = await Promise.all([
                    this.getProjectGoals(project.id, ownerId),
                    needsOpenMilestones ? this.getProjectMilestones(project.id, ownerId, false) : Promise.resolve([]),
                    needsDoneMilestones ? this.getProjectMilestones(project.id, ownerId, true) : Promise.resolve([]),
                ])

                const activeEntries = needsOpenMilestones
                    ? this.buildActiveGoalEntries(project, goals, openMilestones, normalizedCurrentMilestoneOnly)
                    : []
                const doneEntries = needsDoneMilestones ? this.buildDoneGoalEntries(project, goals, doneMilestones) : []

                let combinedEntries
                if (normalizedStatus === 'active') {
                    combinedEntries = this.sortProjectEntries(activeEntries, 'active')
                } else if (normalizedStatus === 'done') {
                    combinedEntries = this.sortProjectEntries(doneEntries, 'done')
                } else {
                    combinedEntries = this.sortProjectEntries(
                        this.mergeAllStatusEntries(activeEntries, doneEntries),
                        'all'
                    )
                }

                return combinedEntries.map(entry => this.stripSortFields(entry))
            })
        )

        const goals = projectResults.flat().slice(0, normalizedLimit)
        const effectiveTargetProject = targetProject || (allProjects === false ? scopedProjects[0] : null)
        const effectiveAllProjects = !effectiveTargetProject && allProjects !== false

        return {
            goals,
            count: goals.length,
            appliedFilters: {
                status: normalizedStatus,
                allProjects: effectiveAllProjects,
                projectId: effectiveTargetProject ? effectiveTargetProject.id : null,
                projectName: effectiveTargetProject ? effectiveTargetProject.name || effectiveTargetProject.id : null,
                currentMilestoneOnly: normalizedCurrentMilestoneOnly,
                limit: normalizedLimit,
            },
        }
    }
}

module.exports = {
    GoalRetrievalService,
}
