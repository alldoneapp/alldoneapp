import { getDb, getId, globalWatcherUnsub } from '../firestore'
import store from '../../../redux/store'
import { setOKRsInProjectInTasks } from '../../../redux/actions'
import {
    OKR_TYPE_MANUAL,
    OKR_TYPE_TIME_LOGGED_REVENUE,
    OKR_STATUS_ACTIVE,
    canUserSeeOkr,
    calculateOkrProgress,
    getOkrIsPublicFor,
    isOkrPrivate,
    getOkrPeriodForCadence,
    normalizeOkrType,
    normalizeOkrNumber,
} from '../../../components/TaskListView/OKRs/okrHelper'
import { FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'

export const OKRS_COLLECTION = 'projectOkrs'

export function mapOKRData(okrId, okr) {
    const currentValue = normalizeOkrNumber(okr.currentValue)
    const targetValue = normalizeOkrNumber(okr.targetValue)

    return {
        id: okr.id || okrId,
        objectType: 'okr',
        type: normalizeOkrType(okr.type),
        label: okr.label || '',
        currentValue,
        targetValue,
        unit: okr.unit || '',
        cadence: okr.cadence || 'monthly',
        periodStart: normalizeOkrNumber(okr.periodStart),
        periodEnd: normalizeOkrNumber(okr.periodEnd),
        status: okr.status || OKR_STATUS_ACTIVE,
        ownerId: okr.ownerId || '',
        projectId: okr.projectId || '',
        previousOkrId: okr.previousOkrId || null,
        created: okr.created || Date.now(),
        creatorId: okr.creatorId || '',
        lastEditionDate: okr.lastEditionDate || Date.now(),
        lastEditorId: okr.lastEditorId || '',
        renewalProcessedAt: okr.renewalProcessedAt || null,
        isPrivate: isOkrPrivate(okr),
        isPublicFor: getOkrIsPublicFor(okr),
        progress: calculateOkrProgress(currentValue, targetValue),
    }
}

export function watchProjectOKRs(projectId, ownerId, watcherKey) {
    if (!projectId || !ownerId) return

    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`okrs/${projectId}/${OKRS_COLLECTION}`)
        .where('ownerId', '==', ownerId)
        .where('status', '==', OKR_STATUS_ACTIVE)
        .onSnapshot(snapshot => {
            const okrs = []
            const { loggedUser } = store.getState()
            snapshot.forEach(doc => {
                const okr = mapOKRData(doc.id, doc.data())
                if (canUserSeeOkr(okr, loggedUser.uid)) okrs.push(okr)
            })
            okrs.sort((a, b) => {
                if (a.periodEnd !== b.periodEnd) return a.periodEnd - b.periodEnd
                return a.created - b.created
            })
            store.dispatch(setOKRsInProjectInTasks(projectId, okrs))
        })
}

export async function createOKR(projectId, data) {
    const { loggedUser, currentUser } = store.getState()
    const cadence = data.cadence || 'monthly'
    const type = normalizeOkrType(data.type)
    const { periodStart, periodEnd } = getOkrPeriodForCadence(cadence)
    const okrId = getId()
    const now = Date.now()

    const okr = {
        id: okrId,
        objectType: 'okr',
        type,
        projectId,
        ownerId: currentUser.uid,
        label: String(data.label || '').trim(),
        currentValue: type === OKR_TYPE_TIME_LOGGED_REVENUE ? 0 : normalizeOkrNumber(data.currentValue),
        targetValue: normalizeOkrNumber(data.targetValue),
        unit: String(data.unit || '').trim(),
        cadence,
        periodStart,
        periodEnd,
        status: OKR_STATUS_ACTIVE,
        previousOkrId: null,
        created: now,
        creatorId: loggedUser.uid,
        lastEditionDate: now,
        lastEditorId: loggedUser.uid,
        renewalProcessedAt: null,
        isPrivate: data.isPrivate || false,
        isPublicFor: data.isPrivate ? data.isPublicFor || [currentUser.uid] : [FEED_PUBLIC_FOR_ALL],
    }

    await getDb().doc(`okrs/${projectId}/${OKRS_COLLECTION}/${okrId}`).set(okr)
    return mapOKRData(okrId, okr)
}

export async function updateOKRCurrentValue(projectId, okrId, currentValue) {
    const { loggedUser } = store.getState()
    await getDb()
        .doc(`okrs/${projectId}/${OKRS_COLLECTION}/${okrId}`)
        .update({
            currentValue: normalizeOkrNumber(currentValue),
            lastEditionDate: Date.now(),
            lastEditorId: loggedUser.uid,
        })
}

export async function updateOKR(projectId, okr, data) {
    const { loggedUser } = store.getState()
    const cadence = data.cadence || okr.cadence || 'monthly'
    const type = normalizeOkrType(data.type || okr.type || OKR_TYPE_MANUAL)
    const cadenceChanged = cadence !== okr.cadence
    const period = cadenceChanged ? getOkrPeriodForCadence(cadence) : {}

    await getDb()
        .doc(`okrs/${projectId}/${OKRS_COLLECTION}/${okr.id}`)
        .update({
            label: String(data.label || '').trim(),
            type,
            currentValue: type === OKR_TYPE_TIME_LOGGED_REVENUE ? 0 : normalizeOkrNumber(data.currentValue),
            targetValue: normalizeOkrNumber(data.targetValue),
            unit: String(data.unit || '').trim(),
            cadence,
            ...period,
            isPrivate: data.isPrivate || false,
            isPublicFor: data.isPrivate ? data.isPublicFor || [okr.ownerId] : [FEED_PUBLIC_FOR_ALL],
            lastEditionDate: Date.now(),
            lastEditorId: loggedUser.uid,
        })
}

export async function updateOKRPrivacy(projectId, okrId, isPrivate, isPublicFor) {
    const { loggedUser } = store.getState()
    await getDb()
        .doc(`okrs/${projectId}/${OKRS_COLLECTION}/${okrId}`)
        .update({
            isPrivate,
            isPublicFor: isPrivate ? isPublicFor : [FEED_PUBLIC_FOR_ALL],
            lastEditionDate: Date.now(),
            lastEditorId: loggedUser.uid,
        })
}

export async function deleteOKR(projectId, okrId) {
    await getDb().doc(`okrs/${projectId}/${OKRS_COLLECTION}/${okrId}`).delete()
}
