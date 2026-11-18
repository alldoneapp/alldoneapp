import { getDb, runHttpsCallableFunction } from '../firestore'
import {
    getAssistantProfilePath,
    getAssistantProfileRevisionId,
    getAssistantProfileRevisionsPath,
    getAssistantProfileRunsPath,
} from '../../../functions/AssistantProfile/assistantProfileModel'

// The assistant profile (AT-3072) is read straight from Firestore (only its owner may read the
// assistantProfiles/{uid} tree) and written only through callables: no client may write it.

const REVISIONS_LIMIT = 15
const RUNS_LIMIT = 5

function reportListenerError(scope, onError) {
    return error => {
        // Offline a listener simply waits; anything else is worth a line in the console.
        if (error?.code !== 'unavailable') console.warn(`[assistant profile] ${scope} listener failed`, { error })
        if (onError) onError(error)
    }
}

export function watchAssistantProfile(userId, onChange, onError) {
    const db = getDb()
    if (!db || !userId) return () => {}
    return db
        .doc(getAssistantProfilePath(userId))
        .onSnapshot(
            snapshot => onChange(snapshot.exists ? snapshot.data() || {} : null),
            reportListenerError('profile', onError)
        )
}

export function mapAssistantProfileRevision(id, data = {}) {
    return {
        id,
        revision: Number(data.revision) || 0,
        mode: data.mode || 'run',
        text: typeof data.text === 'string' ? data.text : '',
        previousText: typeof data.previousText === 'string' ? data.previousText : '',
        summary: typeof data.summary === 'string' ? data.summary : '',
        createdAt: Number(data.createdAt) || null,
        restoredFromRevision: Number.isFinite(data.restoredFromRevision) ? data.restoredFromRevision : null,
    }
}

export function watchAssistantProfileRevisions(userId, onChange, onError) {
    const db = getDb()
    if (!db || !userId) return () => {}
    return db
        .collection(getAssistantProfileRevisionsPath(userId))
        .orderBy('revision', 'desc')
        .limit(REVISIONS_LIMIT)
        .onSnapshot(
            snapshot => onChange(snapshot.docs.map(doc => mapAssistantProfileRevision(doc.id, doc.data() || {}))),
            reportListenerError('revisions', onError)
        )
}

export function watchAssistantProfileRuns(userId, onChange, onError) {
    const db = getDb()
    if (!db || !userId) return () => {}
    return db
        .collection(getAssistantProfileRunsPath(userId))
        .orderBy('startedAt', 'desc')
        .limit(RUNS_LIMIT)
        .onSnapshot(
            snapshot => onChange(snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() || {}) }))),
            reportListenerError('runs', onError)
        )
}

export async function getAssistantProfileRevision(userId, revision) {
    const db = getDb()
    if (!db || !userId || !Number.isInteger(revision) || revision < 1) return null
    const snapshot = await db
        .doc(`${getAssistantProfileRevisionsPath(userId)}/${getAssistantProfileRevisionId(revision)}`)
        .get()
    return snapshot.exists ? mapAssistantProfileRevision(snapshot.id, snapshot.data() || {}) : null
}

export function saveAssistantProfileSettings(settings) {
    return runHttpsCallableFunction('setAssistantProfileSettings', { settings })
}

export function requestAssistantProfileRefresh() {
    return runHttpsCallableFunction('requestAssistantProfileRefresh', {})
}

export function restoreAssistantProfileRevision(revision) {
    return runHttpsCallableFunction('restoreAssistantProfileRevision', { revision })
}
