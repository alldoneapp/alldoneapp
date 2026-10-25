import { getDb, runHttpsCallableFunction } from '../firestore'
import {
    getKnowledgeBasePath,
    getKnowledgePageRevisionsPath,
    getKnowledgePagesPath,
    getKnowledgeRunsPath,
    isKnowledgePageVisible,
} from '../../../functions/KnowledgeBase/knowledgeBaseModel'

// The project wiki is read straight from Firestore (members may read the whole
// knowledgeBases/{projectId} tree) and written only through callables: no client may write it.

const RECENT_RUNS_LIMIT = 10
const REVISIONS_LIMIT = 20

function reportListenerError(scope, projectId, onError) {
    return error => {
        // Offline a listener simply waits; anything else is worth a line in the console.
        if (error?.code !== 'unavailable') console.warn(`[wiki] ${scope} listener failed`, { projectId, error })
        if (onError) onError(error)
    }
}

export function watchKnowledgeBase(projectId, onChange, onError) {
    const db = getDb()
    if (!db || !projectId) return () => {}
    return db
        .doc(getKnowledgeBasePath(projectId))
        .onSnapshot(
            snapshot => onChange(snapshot.exists ? snapshot.data() || {} : null),
            reportListenerError('settings', projectId, onError)
        )
}

export function mapKnowledgePage(slug, data = {}) {
    return {
        slug,
        title: data.title || slug,
        summary: data.summary || '',
        body: data.body || '',
        revision: Number(data.revision) || 0,
        sourceKeys: Array.isArray(data.sourceKeys) ? data.sourceKeys : [],
        sourceLabels: data.sourceLabels && typeof data.sourceLabels === 'object' ? data.sourceLabels : {},
        links: Array.isArray(data.links) ? data.links : [],
        updatedAt: Number(data.updatedAt) || null,
        updatedBy: data.updatedBy || null,
        archived: data.archived === true,
        needsRebuild: data.needsRebuild === true,
    }
}

// Pages waiting for a rebuild still contain what a withdrawn source said, so they are left out here
// exactly as they are left out of every assistant's prompt.
export function watchKnowledgePages(projectId, onChange, onError) {
    const db = getDb()
    if (!db || !projectId) return () => {}
    return db.collection(getKnowledgePagesPath(projectId)).onSnapshot(
        snapshot => {
            const pages = snapshot.docs
                .map(doc => mapKnowledgePage(doc.id, doc.data()))
                .filter(isKnowledgePageVisible)
                .sort((left, right) => left.title.localeCompare(right.title))
            const pendingRebuilds = snapshot.docs.filter(doc => {
                const data = doc.data() || {}
                return data.needsRebuild === true && data.archived !== true
            }).length
            onChange(pages, { pendingRebuilds })
        },
        reportListenerError('pages', projectId, onError)
    )
}

export function watchKnowledgeRuns(projectId, onChange, onError) {
    const db = getDb()
    if (!db || !projectId) return () => {}
    return db
        .collection(getKnowledgeRunsPath(projectId))
        .orderBy('startedAt', 'desc')
        .limit(RECENT_RUNS_LIMIT)
        .onSnapshot(
            snapshot => onChange(snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() || {}) }))),
            reportListenerError('runs', projectId, onError)
        )
}

export async function getKnowledgePageRevisions(projectId, slug) {
    const db = getDb()
    if (!db || !projectId || !slug) return []
    const snapshot = await db
        .collection(getKnowledgePageRevisionsPath(projectId, slug))
        .orderBy('revision', 'desc')
        .limit(REVISIONS_LIMIT)
        .get()
    return snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() || {}) }))
}

export function saveKnowledgeBaseSettings(projectId, settings) {
    return runHttpsCallableFunction('setKnowledgeBaseSettings', { projectId, settings })
}

export function requestKnowledgeBaseRefresh(projectId) {
    return runHttpsCallableFunction('requestKnowledgeBaseRefresh', { projectId })
}

// Takes a correction back. The same function backs the assistant's undo_knowledge_correction tool.
export function undoKnowledgeCorrection(projectId, correctionId) {
    return runHttpsCallableFunction('undoKnowledgeCorrection', { projectId, correctionId })
}
