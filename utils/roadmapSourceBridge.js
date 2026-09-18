import moment from 'moment'

import { getDb, mapGoalData, mapMilestoneData, mapProjectData } from './backends/firestore'
import { mapOKRData } from './backends/OKRs/okrsFirestore'
import { ALL_USERS } from '../components/GoalsView/GoalsHelper'
import {
    calculateOkrPace,
    calculateRevenueOkrCurrentValue,
    canUserSeeOkr,
    isRevenueOkr,
    normalizeOkrNumber,
} from '../components/TaskListView/OKRs/okrHelper'
import { PROJECT_COLOR_DEFAULT, PROJECT_COLOR_SYSTEM } from '../Themes/Modern/ProjectColors'

export const ALLDONE_ROADMAP_PROTOCOL_VERSION = 1

const normalizeProjectColor = color =>
    PROJECT_COLOR_SYSTEM[color]?.MARKER || PROJECT_COLOR_SYSTEM[PROJECT_COLOR_DEFAULT]?.MARKER || color || '#2563EB'

const cleanIdList = value => (Array.isArray(value) ? value : [])

export function getActiveRoadmapProjects(projects, user) {
    const projectIds = new Set(cleanIdList(user?.projectIds))
    const excludedIds = new Set([
        ...cleanIdList(user?.archivedProjectIds),
        ...cleanIdList(user?.templateProjectIds),
        ...cleanIdList(user?.guideProjectIds),
    ])

    return (Array.isArray(projects) ? projects : [])
        .filter(project => project?.id && projectIds.has(project.id) && !excludedIds.has(project.id))
        .map(project => ({
            id: project.id,
            name: project.name || 'Untitled project',
            color: normalizeProjectColor(project.color),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

function normalizeFocusAreas(catalog) {
    return Object.entries(catalog && typeof catalog === 'object' && !Array.isArray(catalog) ? catalog : {})
        .map(([id, area]) => ({
            id,
            name: typeof area?.name === 'string' ? area.name.trim().replace(/\s+/g, ' ') : '',
        }))
        .filter(area => area.name && area.name.toLowerCase() !== 'general')
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id))
}

function normalizeProject(project) {
    return {
        id: project.id,
        name: project.name || 'Untitled project',
        color: normalizeProjectColor(project.color),
        focusAreas: normalizeFocusAreas(project.focusAreas),
    }
}

function normalizeGoal(goal) {
    return {
        id: goal.id,
        name: goal.name || '',
        progress: normalizeOkrNumber(goal.progress),
        dynamicProgress: normalizeOkrNumber(goal.dynamicProgress),
        startingMilestoneDate: normalizeOkrNumber(goal.startingMilestoneDate),
        completionMilestoneDate: normalizeOkrNumber(goal.completionMilestoneDate),
        parentDoneMilestoneIds: Array.isArray(goal.parentDoneMilestoneIds) ? goal.parentDoneMilestoneIds : [],
        progressByDoneMilestone: goal.progressByDoneMilestone || {},
        dateByDoneMilestone: goal.dateByDoneMilestone || {},
        sortIndexByMilestone: goal.sortIndexByMilestone || {},
        scheduleMode: goal.scheduleMode || '',
        focusAreaId: typeof goal.focusAreaId === 'string' ? goal.focusAreaId : null,
    }
}

function normalizeMilestone(milestone) {
    return {
        id: milestone.id,
        name: milestone.extendedName || 'Milestone',
        date: normalizeOkrNumber(milestone.date),
        done: milestone.done === true,
        doneDate: normalizeOkrNumber(milestone.doneDate),
        milestoneType: milestone.milestoneType || '',
        periodStartDate: milestone.periodStartDate == null ? null : normalizeOkrNumber(milestone.periodStartDate),
        periodEndDate: milestone.periodEndDate == null ? null : normalizeOkrNumber(milestone.periodEndDate),
        periodKey: milestone.periodKey || '',
        cadence: milestone.cadence || '',
    }
}

function normalizeOkr(okr, resolvedCurrentValue = okr.currentValue) {
    const withResolvedValue = { ...okr, resolvedCurrentValue: normalizeOkrNumber(resolvedCurrentValue) }
    return {
        id: okr.id,
        label: okr.label || '',
        type: okr.type,
        currentValue: normalizeOkrNumber(okr.currentValue),
        resolvedCurrentValue: withResolvedValue.resolvedCurrentValue,
        targetValue: normalizeOkrNumber(okr.targetValue),
        unit: okr.unit || '',
        cadence: okr.cadence || '',
        periodStart: normalizeOkrNumber(okr.periodStart),
        periodEnd: normalizeOkrNumber(okr.periodEnd),
        status: okr.status || '',
        paceStatus: calculateOkrPace(withResolvedValue).status,
    }
}

export function getRoadmapNavigationPath({ projectId, userId, entityType, entityId }) {
    if (!projectId || !userId) return null
    if (entityType === 'goal' && entityId) return `/projects/${projectId}/goals/${entityId}`
    if (entityType === 'okr') return `/project/${projectId}/okrs`
    if (['project', 'focusArea', 'milestone'].includes(entityType)) {
        return `/projects/${projectId}/user/${userId}/goals/open`
    }
    return null
}

export function subscribeToRoadmapProject({ projectId, userId, onSnapshot, onError }) {
    const db = getDb()
    const unsubs = []
    let revenueUnsubs = []
    let disposed = false
    let project = null
    let goals = null
    let milestones = null
    let rawOkrs = null
    let okrs = null
    let revenuePending = new Set()
    const revenueValues = new Map()

    const reportError = (scope, error) => {
        if (disposed) return
        console.error(`Roadmap source: ${scope} subscription failed`, { projectId, error })
        onError(error)
    }

    const emit = () => {
        if (disposed || !project || !goals || !milestones || !okrs || revenuePending.size > 0) return
        onSnapshot({ project: normalizeProject(project), goals, milestones, okrs })
    }

    const rebuildOkrs = () => {
        if (!rawOkrs) return
        okrs = rawOkrs.map(okr => normalizeOkr(okr, revenueValues.get(okr.id) ?? okr.currentValue))
    }

    const subscribeRevenueOkrs = () => {
        revenueUnsubs.forEach(unsubscribe => unsubscribe())
        revenueUnsubs = []
        revenuePending = new Set()
        revenueValues.clear()
        rebuildOkrs()
        if (!project || !rawOkrs) return

        rawOkrs.filter(isRevenueOkr).forEach(okr => {
            revenuePending.add(okr.id)
            const periodStartDay = Number(moment(okr.periodStart).format('YYYYMMDD'))
            const periodEndDay = Number(moment(okr.periodEnd).format('YYYYMMDD'))
            const hourlyRate = normalizeOkrNumber(project.hourlyRatesData?.hourlyRates?.[userId])
            const unsubscribe = db
                .collection(`/statistics/${projectId}/${userId}`)
                .where('day', '>=', periodStartDay)
                .where('day', '<=', periodEndDay)
                .onSnapshot(
                    snapshot => {
                        let doneTimeMinutes = 0
                        snapshot.forEach(doc => {
                            doneTimeMinutes += normalizeOkrNumber(doc.data()?.doneTime)
                        })
                        revenueValues.set(okr.id, calculateRevenueOkrCurrentValue(doneTimeMinutes, hourlyRate))
                        revenuePending.delete(okr.id)
                        rebuildOkrs()
                        emit()
                    },
                    error => {
                        revenuePending.delete(okr.id)
                        revenueValues.set(okr.id, 0)
                        rebuildOkrs()
                        reportError('revenue OKR', error)
                        emit()
                    }
                )
            revenueUnsubs.push(unsubscribe)
        })
        emit()
    }

    unsubs.push(
        db.doc(`projects/${projectId}`).onSnapshot(
            doc => {
                if (!doc.exists) {
                    reportError('project', new Error('Project not found'))
                    return
                }
                project = mapProjectData(doc.id, doc.data())
                subscribeRevenueOkrs()
                emit()
            },
            error => reportError('project', error)
        )
    )

    unsubs.push(
        db
            .collection(`goals/${projectId}/items`)
            .where('readerIds', 'array-contains', userId)
            .where('ownerId', '==', ALL_USERS)
            .onSnapshot(
                snapshot => {
                    goals = snapshot.docs.map(doc => normalizeGoal(mapGoalData(doc.id, doc.data())))
                    emit()
                },
                error => reportError('goals', error)
            )
    )

    unsubs.push(
        db
            .collection(`goalsMilestones/${projectId}/milestonesItems`)
            .where('ownerId', '==', ALL_USERS)
            .orderBy('date', 'asc')
            .onSnapshot(
                snapshot => {
                    milestones = snapshot.docs.map(doc => normalizeMilestone(mapMilestoneData(doc.id, doc.data())))
                    emit()
                },
                error => reportError('milestones', error)
            )
    )

    unsubs.push(
        db
            .collection(`okrs/${projectId}/projectOkrs`)
            .where('readerIds', 'array-contains', userId)
            .where('ownerId', '==', userId)
            .onSnapshot(
                snapshot => {
                    rawOkrs = snapshot.docs
                        .map(doc => mapOKRData(doc.id, doc.data()))
                        .filter(okr => canUserSeeOkr(okr, userId))
                    subscribeRevenueOkrs()
                    emit()
                },
                error => reportError('OKRs', error)
            )
    )

    return () => {
        disposed = true
        unsubs.forEach(unsubscribe => unsubscribe())
        revenueUnsubs.forEach(unsubscribe => unsubscribe())
    }
}
