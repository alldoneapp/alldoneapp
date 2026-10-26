import { getDb, runHttpsCallableFunction } from '../firestore'
import {
    getKnowledgeBasePath,
    getKnowledgePagePath,
    getKnowledgePageRevisionsPath,
    getKnowledgePagesPath,
    getKnowledgeRunsPath,
    isKnowledgePageVisible,
} from '../../../functions/KnowledgeBase/knowledgeBaseModel'
import { getWikiRevisionDocId } from '../../../functions/KnowledgeBase/knowledgeWikiFeedModel'

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

const getRevisionPath = (projectId, slug, revision) =>
    `${getKnowledgePageRevisionsPath(projectId, slug)}/${getWikiRevisionDocId(revision)}`

const readData = async path => {
    const snapshot = await getDb().doc(path).get()
    return snapshot.exists ? snapshot.data() || {} : null
}

/**
 * One revision of a page, the revision before it and the page as it is now: what the change view
 * needs to show what that revision changed (components/WikiView/wikiDiff.resolveWikiChange). A
 * revision whose text was removed because a source was withdrawn comes back `redacted`, exactly as
 * stored, so the view can never show more than the wiki itself still holds.
 */
export async function getKnowledgePageChange(projectId, slug, revision) {
    const db = getDb()
    const number = Number(revision)
    if (!db || !projectId || !slug || !Number.isInteger(number) || number < 1) return null
    const [current, previous, page] = await Promise.all([
        readData(getRevisionPath(projectId, slug, number)),
        number > 1 ? readData(getRevisionPath(projectId, slug, number - 1)) : null,
        readData(getKnowledgePagePath(projectId, slug)),
    ])
    return {
        revision: current ? { id: getWikiRevisionDocId(number), ...current } : null,
        previous,
        page: page ? mapKnowledgePage(slug, page) : null,
    }
}

/**
 * What a page changed since one of its revisions (AT-2878): the page as it is now, its newest
 * revision, the base revision the comparison starts from and the latest revisions (for the list of
 * single changes in the range and the range buttons). Every text comes from a stored revision, so a
 * redacted one comes back exactly as stored. `base` 0 is the page before it existed.
 */
export async function getKnowledgePageRange(projectId, slug, base) {
    const db = getDb()
    const baseNumber = Number(base)
    if (!db || !projectId || !slug || !Number.isInteger(baseNumber) || baseNumber < 0) return null
    const [pageData, revisions] = await Promise.all([
        readData(getKnowledgePagePath(projectId, slug)),
        getKnowledgePageRevisions(projectId, slug),
    ])
    const page = pageData ? mapKnowledgePage(slug, pageData) : null
    const latestNumber = Number(page?.revision) || 0
    // The newest revisions are usually among those just read; a base further back is read on its own.
    const findOrRead = async number => {
        const listed = revisions.find(revision => Number(revision.revision) === number)
        if (listed) return listed
        const stored = await readData(getRevisionPath(projectId, slug, number))
        return stored ? { id: getWikiRevisionDocId(number), ...stored } : null
    }
    const [latest, baseRevision] = await Promise.all([
        latestNumber > 0 ? findOrRead(latestNumber) : null,
        baseNumber > 0 && baseNumber < latestNumber ? findOrRead(baseNumber) : null,
    ])
    return { page, latest, base: baseRevision, revisions }
}

/**
 * The number of the newest revision of a page made before `timestamp`, or 0 when the page did not
 * exist yet: where "the last 7 days" of a page starts when they reach past its loaded revisions.
 * A single-field range on `createdAt`, which Firestore indexes automatically.
 */
export async function getKnowledgeRevisionNumberBefore(projectId, slug, timestamp) {
    const db = getDb()
    if (!db || !projectId || !slug || !Number.isFinite(Number(timestamp))) return null
    const snapshot = await db
        .collection(getKnowledgePageRevisionsPath(projectId, slug))
        .where('createdAt', '<', Number(timestamp))
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get()
    const number = snapshot.empty ? 0 : Number(snapshot.docs[0].data()?.revision)
    return Number.isInteger(number) && number >= 0 ? number : null
}

/**
 * The title a page had in one revision, for its line in the Updates feed (which stores no page
 * text). An archive or a redacted revision has none, so the page's current title is used, and null
 * when that was removed too.
 */
export async function getKnowledgeRevisionTitle(projectId, slug, revision) {
    if (!getDb() || !projectId || !slug) return null
    const stored = await readData(getRevisionPath(projectId, slug, revision))
    if (typeof stored?.title === 'string' && stored.title.trim()) return stored.title
    const page = await readData(getKnowledgePagePath(projectId, slug))
    return typeof page?.title === 'string' && page.title.trim() ? page.title : null
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
