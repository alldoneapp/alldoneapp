/**
 * One live listener for the signed-in user's unread badges, instead of three per project.
 *
 * `feedsCount/{projectId}/{userId}/{followed|all}` and `chatNotifications/{projectId}/{userId}/*`
 * used to be watched per project: 39 of the ~320 listeners a boot opened on the dogfooding account,
 * for a few hundred bytes of data. Cloud Functions mirror both into
 * `users/{userId}/private/activityUnreadSummary` (functions/Feeds/activityUnreadSummary.js), and
 * `watchNewFeedsTab` / `watchChatNotifications` now subscribe here. Callers are unchanged: each
 * still registers per project and receives exactly what its old listener delivered.
 *
 * The summary is only trusted when it is provably complete for a project:
 *   - `mirrorVersion` is present, which only the triggers write. Until the functions are deployed,
 *     or for a user no trigger has fired for yet, nothing would keep the summary current.
 *   - `bootstrapped.{projectId}` is set. The triggers only mirror writes made after they exist, so
 *     the pre-existing state of a project is copied in once, by `reconcileProject`, in a transaction
 *     that re-reads every source document it writes.
 * Anything else - no mirror yet, a project not copied yet, a listener error or a summary that has
 * not answered within SUMMARY_FIRST_SNAPSHOT_TIMEOUT_MS - uses the old per-project listener for
 * that consumer, so a badge can be late to move onto the summary but never wrong.
 *
 * Own clears (reading a chat, opening Updates, interacting with an object) are mirrored into the
 * summary in the same batch (`queueSummary*` below), so the badge clears at once from the local
 * write instead of after the trigger's round trip. Other users' writes reach it via the triggers.
 * Once per session every watched project is re-reconciled in the background, which repairs any
 * mirror a failed trigger missed.
 */
import firebase from 'firebase/compat/app'

import { getDb } from '../firestore'
import store from '../../../redux/store'

export const ACTIVITY_SUMMARY_DOC_ID = 'activityUnreadSummary'
export const SUMMARY_FIRST_SNAPSHOT_TIMEOUT_MS = 5000
export const SUMMARY_RECONCILE_DELAY_MS = 60 * 1000
const FEED_TABS = ['followed', 'all']

export const getActivitySummaryRef = userId => getDb().doc(`users/${userId}/private/${ACTIVITY_SUMMARY_DOC_ID}`)

const isLoggedUser = userId => !!userId && store.getState()?.loggedUser?.uid === userId

export const stableStringify = value => {
    if (value === undefined) return 'undefined'
    if (value === null || typeof value !== 'object') return JSON.stringify(value)
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
    return `{${Object.keys(value)
        .sort()
        .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
        .join(',')}}`
}

export const readSummaryValue = (data, { kind, projectId, tab }) => {
    if (kind === 'feeds') return data?.feeds?.[projectId]?.[tab] ?? null
    const chats = data?.chats?.[projectId] || {}
    return Object.keys(chats)
        .sort()
        .map(commentId => ({ ...chats[commentId], commentId }))
}

export const isSummaryUsableFor = (data, projectId) =>
    Number(data?.mirrorVersion) >= 1 && data?.bootstrapped?.[projectId] === true

let session = null

const createSession = userId => ({
    userId,
    unsubscribe: null,
    data: null,
    received: false,
    failed: false,
    consumers: new Map(),
    reconciles: new Map(),
    reconciledThisSession: new Set(),
    firstSnapshotTimer: null,
    reconcileTimer: null,
    nextId: 1,
})

const emit = (consumer, value) => {
    const key = stableStringify(value)
    if (consumer.lastKey === key) return
    consumer.lastKey = key
    try {
        consumer.onData(value)
    } catch (error) {
        console.warn('[ActivitySummary] Consumer failed:', error)
    }
}

const startLegacy = consumer => {
    if (consumer.legacyUnsubscribe) return
    consumer.legacyUnsubscribe = consumer.legacySubscribe(value => emit(consumer, value))
}

const stopLegacy = consumer => {
    if (!consumer.legacyUnsubscribe) return
    const unsubscribe = consumer.legacyUnsubscribe
    consumer.legacyUnsubscribe = null
    try {
        unsubscribe()
    } catch (_) {}
}

const evaluate = consumer => {
    if (!session || (!session.received && !session.failed)) return
    const data = session.data
    if (session.failed || !(Number(data?.mirrorVersion) >= 1)) {
        startLegacy(consumer)
        return
    }
    if (!isSummaryUsableFor(data, consumer.projectId)) {
        startLegacy(consumer)
        void reconcileProject(session.userId, consumer.projectId)
        return
    }
    emit(consumer, readSummaryValue(data, consumer))
    stopLegacy(consumer)
}

const evaluateAll = () => session?.consumers.forEach(evaluate)

/**
 * Copies one project's current source state into the summary (and marks it bootstrapped).
 * Chat notifications cannot be queried inside a transaction, so the query only nominates ids;
 * every id - including ones only the summary still lists - is re-read in the transaction, so the
 * committed state is consistent with the sources at commit time. Nothing is written when the
 * summary already matches.
 */
export async function reconcileProject(userId, projectId) {
    if (!session || session.userId !== userId || !projectId) return false
    if (session.reconciles.has(projectId)) return session.reconciles.get(projectId)

    const run = (async () => {
        const db = getDb()
        const { FieldPath, FieldValue } = firebase.firestore
        const summaryRef = getActivitySummaryRef(userId)
        const chatRef = commentId => db.doc(`chatNotifications/${projectId}/${userId}/${commentId}`)
        const nominated = await db.collection(`chatNotifications/${projectId}/${userId}`).get()

        await db.runTransaction(async transaction => {
            const summary = (await transaction.get(summaryRef)).data() || {}
            const summaryChats = summary.chats?.[projectId] || {}
            const commentIds = [...new Set([...nominated.docs.map(doc => doc.id), ...Object.keys(summaryChats)])]
            const feedSnapshots = await Promise.all(
                FEED_TABS.map(tab => transaction.get(db.doc(`feedsCount/${projectId}/${userId}/${tab}`)))
            )
            const chatSnapshots = await Promise.all(commentIds.map(id => transaction.get(chatRef(id))))

            const value = {
                bootstrapped: { [projectId]: true },
                feeds: { [projectId]: {} },
                chats: { [projectId]: {} },
            }
            const fields = []
            FEED_TABS.forEach((tab, index) => {
                const snapshot = feedSnapshots[index]
                const current = summary.feeds?.[projectId]?.[tab]
                const next = snapshot.exists ? snapshot.data() || {} : undefined
                if (stableStringify(current) === stableStringify(next)) return
                value.feeds[projectId][tab] = next === undefined ? FieldValue.delete() : next
                fields.push(new FieldPath('feeds', projectId, tab))
            })
            commentIds.forEach((commentId, index) => {
                const snapshot = chatSnapshots[index]
                const next = snapshot.exists ? snapshot.data() || {} : undefined
                if (stableStringify(summaryChats[commentId]) === stableStringify(next)) return
                value.chats[projectId][commentId] = next === undefined ? FieldValue.delete() : next
                fields.push(new FieldPath('chats', projectId, commentId))
            })
            if (summary.bootstrapped?.[projectId] !== true) fields.push(new FieldPath('bootstrapped', projectId))
            if (fields.length > 0) transaction.set(summaryRef, value, { mergeFields: fields })
        })
        return true
    })()
        .catch(error => {
            // Offline, or a transient failure: the legacy listener keeps serving this project.
            console.warn(`[ActivitySummary] Could not reconcile ${projectId}:`, error?.code || error)
            return false
        })
        .finally(() => session?.reconciles.delete(projectId))

    session.reconciles.set(projectId, run)
    return run
}

const scheduleSessionReconcile = () => {
    if (!session || session.reconcileTimer) return
    const current = session
    current.reconcileTimer = setTimeout(async () => {
        const projectIds = [...new Set([...current.consumers.values()].map(consumer => consumer.projectId))]
        for (const projectId of projectIds) {
            if (session !== current || current.reconciledThisSession.has(projectId)) continue
            current.reconciledThisSession.add(projectId)
            if (isSummaryUsableFor(current.data, projectId)) await reconcileProject(current.userId, projectId)
        }
    }, SUMMARY_RECONCILE_DELAY_MS)
}

const teardownSession = () => {
    if (!session) return
    clearTimeout(session.firstSnapshotTimer)
    clearTimeout(session.reconcileTimer)
    session.consumers.forEach(stopLegacy)
    try {
        session.unsubscribe?.()
    } catch (_) {}
    session = null
}

const ensureSession = userId => {
    if (session && session.userId !== userId) teardownSession()
    if (session) return session
    session = createSession(userId)
    const current = session
    current.firstSnapshotTimer = setTimeout(() => {
        if (session !== current || current.received) return
        current.failed = true
        evaluateAll()
    }, SUMMARY_FIRST_SNAPSHOT_TIMEOUT_MS)
    current.unsubscribe = getActivitySummaryRef(userId).onSnapshot(
        snapshot => {
            if (session !== current) return
            current.received = true
            current.failed = false
            current.data = snapshot.data() || {}
            evaluateAll()
            if (Number(current.data.mirrorVersion) >= 1) scheduleSessionReconcile()
        },
        error => {
            if (session !== current) return
            console.warn('[ActivitySummary] Summary listener failed, using per-project listeners:', error?.code)
            current.failed = true
            evaluateAll()
        }
    )
    return current
}

/**
 * Registers one consumer: `kind` 'feeds' (with `tab`) or 'chats'. `onData` receives exactly what
 * the old per-project listener delivered (the feedsCount data, or the notification list), and
 * `legacySubscribe(emit)` must open that old listener and return its unsubscribe.
 */
export function subscribeActivitySummary({ userId, projectId, kind, tab, onData, legacySubscribe }) {
    // Only the signed-in user's own summary is readable; anything else keeps the direct listener.
    if (!isLoggedUser(userId)) {
        const consumer = { onData, lastKey: undefined }
        const unsubscribe = legacySubscribe(value => emit(consumer, value))
        return () => unsubscribe()
    }

    const current = ensureSession(userId)
    const id = current.nextId++
    const consumer = { id, projectId, kind, tab, onData, legacySubscribe, legacyUnsubscribe: null, lastKey: undefined }
    current.consumers.set(id, consumer)
    evaluate(consumer)

    return () => {
        if (!session || session !== current) return
        stopLegacy(consumer)
        current.consumers.delete(id)
        if (current.consumers.size === 0) teardownSession()
    }
}

/** The summary's copy of one unread chat notification, if the summary is live for that project. */
export const getSummaryChatNotification = (projectId, commentId) => {
    if (!session || !isSummaryUsableFor(session.data, projectId)) return null
    return session.data.chats?.[projectId]?.[commentId] || null
}

// ---- Own writes, mirrored in the same batch so the badge moves with the local write ----

const summaryDelete = () => firebase.firestore.FieldValue.delete()

export function queueSummaryFeedTabClear(batch, userId, projectId, tab) {
    if (!isLoggedUser(userId) || !projectId || !tab) return false
    batch.set(getActivitySummaryRef(userId), { feeds: { [projectId]: { [tab]: summaryDelete() } } }, { merge: true })
    return true
}

export function queueSummaryFeedObjectClear(batch, userId, projectId, objectType, objectId) {
    if (!isLoggedUser(userId) || !projectId || !objectType || !objectId) return false
    const tabs = {}
    FEED_TABS.forEach(tab => {
        tabs[tab] = { [objectType]: { [objectId]: summaryDelete() } }
    })
    batch.set(getActivitySummaryRef(userId), { feeds: { [projectId]: tabs } }, { merge: true })
    return true
}

/** `data === null` removes the notification; otherwise it replaces it (a restore). */
export function queueSummaryChatNotificationWrite(batch, userId, projectId, commentId, data) {
    if (!isLoggedUser(userId) || !projectId || !commentId) return false
    const ref = getActivitySummaryRef(userId)
    if (data === null) {
        batch.set(ref, { chats: { [projectId]: { [commentId]: summaryDelete() } } }, { merge: true })
    } else {
        batch.set(
            ref,
            { chats: { [projectId]: { [commentId]: data } } },
            { mergeFields: [new firebase.firestore.FieldPath('chats', projectId, commentId)] }
        )
    }
    return true
}

export function queueSummaryChatNotificationPatch(batch, userId, projectId, commentId, patch) {
    if (!isLoggedUser(userId) || !projectId || !commentId) return false
    // Only patch an entry the summary already holds: a merge onto a missing entry would create a
    // partial notification the badge would count.
    if (!getSummaryChatNotification(projectId, commentId)) return false
    batch.set(getActivitySummaryRef(userId), { chats: { [projectId]: { [commentId]: patch } } }, { merge: true })
    return true
}

/** chatNotifications/{projectId}/{userId}/{commentId} → its parts, or null. */
export const parseChatNotificationPath = path => {
    const parts = String(path || '').split('/')
    return parts.length === 4 && parts[0] === 'chatNotifications'
        ? { projectId: parts[1], userId: parts[2], commentId: parts[3] }
        : null
}

export const resetActivitySummaryForTests = () => teardownSession()
