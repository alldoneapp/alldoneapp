import moment from 'moment'

import { getDb, mapGoalData, mapMilestoneData, mapProjectData } from './backends/firestore'
import { mapOKRData } from './backends/OKRs/okrsFirestore'
import {
    calculateOkrPace,
    calculateRevenueOkrCurrentValue,
    canUserSeeOkr,
    isRevenueOkr,
    normalizeOkrNumber,
} from '../components/TaskListView/OKRs/okrHelper'
import {
    ALL_USERS,
    getActiveRoadmapProjects,
    normalizeRoadmapGoal,
    normalizeRoadmapMilestone,
    normalizeRoadmapOkr,
    normalizeRoadmapProject,
} from '../functions/Roadmap/roadmapSourceModel'

// The normalizers live in functions/Roadmap/roadmapSourceModel.js: alldone.team reads the same
// snapshot outside the embed window through POST /api/roadmap/source (roadmapSourceApi.js).
export { getActiveRoadmapProjects, normalizeRoadmapGoal }

export const ALLDONE_ROADMAP_PROTOCOL_VERSION = 1

const paceStatusOf = okr => calculateOkrPace(okr).status

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
        onSnapshot({ project: normalizeRoadmapProject(project), goals, milestones, okrs })
    }

    const rebuildOkrs = () => {
        if (!rawOkrs) return
        okrs = rawOkrs.map(okr => normalizeRoadmapOkr(okr, revenueValues.get(okr.id) ?? okr.currentValue, paceStatusOf))
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
                    goals = snapshot.docs.map(doc => normalizeRoadmapGoal(mapGoalData(doc.id, doc.data())))
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
                    milestones = snapshot.docs.map(doc =>
                        normalizeRoadmapMilestone(mapMilestoneData(doc.id, doc.data()))
                    )
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
