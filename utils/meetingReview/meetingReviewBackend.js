import { getDb, runHttpsCallableFunction } from '../backends/firestore'
import { awaitWriteAck } from '../backends/offlineWriteAck'
import {
    MEETING_CATEGORY_RULES_COLLECTION,
    MEETING_REVIEWS_COLLECTION,
    MEETING_SERIES_CATEGORIES_COLLECTION,
    toMeetingDocId,
} from '../../functions/shared/meetingReview/meetingReviewConstants'

/**
 * AT-3137 — Firestore access for the private meeting review data.
 *
 * Everything lives under users/{uid}/… which firestore.rules make readable and writable by that
 * user only, so a rating or category is never visible to the other members of a shared project.
 * Writes go through `awaitWriteAck` (docs/claude/offline.md): offline, a rating lands in the local
 * cache and the sheet closes instead of hanging on a server ack.
 */

const userCollection = (uid, name) => getDb().collection(`users/${uid}/${name}`)

const snapshotToMap = snapshot => {
    const map = {}
    snapshot.forEach(doc => {
        map[doc.id] = { ...doc.data(), docId: doc.id }
    })
    return map
}

export const getMeetingReviewDocId = taskId => toMeetingDocId(taskId)

export const watchMeetingReviewsInRange = (uid, fromMs, toMs, onChange, onError) =>
    userCollection(uid, MEETING_REVIEWS_COLLECTION)
        .where('startMs', '>=', fromMs)
        .where('startMs', '<', toMs)
        .onSnapshot(
            snapshot => onChange(snapshotToMap(snapshot)),
            error => {
                console.error('[meetingReview] reviews listener failed', error)
                if (onError) onError(error)
            }
        )

export const watchMeetingReview = (uid, taskId, onChange) =>
    userCollection(uid, MEETING_REVIEWS_COLLECTION)
        .doc(getMeetingReviewDocId(taskId))
        .onSnapshot(
            doc => onChange(doc.exists ? { ...doc.data(), docId: doc.id } : null),
            error => console.error('[meetingReview] review listener failed', error)
        )

export const watchMeetingSeriesCategories = (uid, onChange) =>
    userCollection(uid, MEETING_SERIES_CATEGORIES_COLLECTION).onSnapshot(
        snapshot => onChange(snapshotToMap(snapshot)),
        error => console.error('[meetingReview] series listener failed', error)
    )

export const watchMeetingCategoryRules = (uid, onChange) =>
    userCollection(uid, MEETING_CATEGORY_RULES_COLLECTION).onSnapshot(
        snapshot => onChange(Object.values(snapshotToMap(snapshot))),
        error => console.error('[meetingReview] rules listener failed', error)
    )

export const saveMeetingReview = (uid, taskId, update) =>
    awaitWriteAck(
        userCollection(uid, MEETING_REVIEWS_COLLECTION).doc(getMeetingReviewDocId(taskId)).set(update, { merge: true }),
        'meeting review'
    )

/** Undo: put the document back exactly as it was before the last action (or remove it). */
export const restoreMeetingReview = (uid, taskId, previous) => {
    const ref = userCollection(uid, MEETING_REVIEWS_COLLECTION).doc(getMeetingReviewDocId(taskId))
    if (!previous) return awaitWriteAck(ref.delete(), 'meeting review undo')
    const { docId, ...data } = previous
    return awaitWriteAck(ref.set(data), 'meeting review undo')
}

export const saveMeetingSeriesCategory = (uid, seriesId, category, nowMs = Date.now()) => {
    const docId = toMeetingDocId(seriesId)
    if (!docId) return Promise.resolve()
    const ref = userCollection(uid, MEETING_SERIES_CATEGORIES_COLLECTION).doc(docId)
    return awaitWriteAck(ref.set({ seriesId, category, updatedAt: nowMs }), 'meeting series category')
}

export const restoreMeetingSeriesCategory = (uid, seriesId, previous) => {
    const docId = toMeetingDocId(seriesId)
    if (!docId) return Promise.resolve()
    const ref = userCollection(uid, MEETING_SERIES_CATEGORIES_COLLECTION).doc(docId)
    if (!previous) return awaitWriteAck(ref.delete(), 'meeting series category undo')
    const { docId: ignored, ...data } = previous
    return awaitWriteAck(ref.set(data), 'meeting series category undo')
}

export const getMeetingCategoryRuleDocId = pattern => toMeetingDocId(pattern)

export const saveMeetingCategoryRule = (uid, rule) =>
    awaitWriteAck(
        userCollection(uid, MEETING_CATEGORY_RULES_COLLECTION).doc(getMeetingCategoryRuleDocId(rule.pattern)).set(rule),
        'meeting category rule'
    )

export const deleteMeetingCategoryRule = (uid, pattern) =>
    awaitWriteAck(
        userCollection(uid, MEETING_CATEGORY_RULES_COLLECTION).doc(getMeetingCategoryRuleDocId(pattern)).delete(),
        'meeting category rule delete'
    )

/** One-off read of the reviews of a statistics period (the live listener covers recent days only). */
export const fetchMeetingReviewsInRange = async (uid, fromMs, toMs) => {
    const snapshot = await userCollection(uid, MEETING_REVIEWS_COLLECTION)
        .where('startMs', '>=', fromMs)
        .where('startMs', '<', toMs)
        .get()
    return snapshotToMap(snapshot)
}

/** The caller's calendar tasks in a period (functions/MeetingReview/meetingStatsData.js). */
export const fetchMeetingStatsTasks = (fromMs, toMs) =>
    runHttpsCallableFunction('getMeetingTimeStatsDataSecondGen', { fromMs, toMs }, { timeout: 60000 })

/**
 * AT-3145 — the working hours the "Time to work" figure uses (the meeting link settings doc, see
 * utils/meetingTimeToday.js). Read once for the line in the statistics that links to where they
 * are edited; null when the user never saved any (the default hours apply).
 */
export const fetchWorkingHoursSettings = async uid => {
    const doc = await getDb().doc(`users/${uid}/bookingSettings/default`).get()
    return doc.exists ? doc.data() || {} : null
}
