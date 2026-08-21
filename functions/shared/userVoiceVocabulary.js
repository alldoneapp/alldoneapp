'use strict'

/**
 * The PER-USER half of the dictation vocabulary (PT-4648): the cached document, the workspace scan
 * that fills it, and the read path the rambler takes on every dictation.
 *
 * `voiceVocabularyTerms.js` decides WHAT is worth saying to Deepgram. This module decides WHEN the
 * workspace is looked at, and it exists almost entirely to answer that second question, because the
 * naive version of this feature is a workspace scan on the transcription critical path — which
 * currently runs in ~1s and must stay there.
 *
 * THE STRATEGY: cached, with stale-while-revalidate
 * ------------------------------------------------
 * Contacts, project names and assistant names change on the order of weeks. The transcript needs
 * them in milliseconds. So the terms live in ONE document, `users/{uid}/private/voiceVocabulary`,
 * and a dictation pays exactly one document read for them.
 *
 *   - FRESH cache (< VOCABULARY_TTL_MS): used as-is. This is the overwhelmingly common path.
 *   - STALE cache: used ANYWAY for this dictation, and a rebuild is started alongside it. A
 *     day-old contact list is a rounding error next to the alternative, which is making the user
 *     wait for a scan before their audio is even sent.
 *   - NO cache (a user's first ever dictation): the build is awaited, but bounded by
 *     COLD_BUILD_TIMEOUT_MS. A user should not have to dictate twice before the feature works, and
 *     a slow workspace must not cost them their dictation either — past the bound we fall back to
 *     the static glossary and the rebuild still lands for next time.
 *
 * Why not Firestore triggers on contact/project/assistant writes: that pays on every contact edit
 * across every project for every member, to keep a list fresh that is consumed only when somebody
 * dictates. Why not a scheduled rebuild for all users: same objection, plus it scans the workspaces
 * of users who have never touched the microphone. The lazy cache is self-limiting — a user who
 * never dictates costs nothing, and one who dictates fifty times a day still rebuilds once a day.
 *
 * EVERY FAILURE PATH DEGRADES TO THE STATIC GLOSSARY. Nothing in this module is allowed to throw
 * into the rambler: losing the personalized spelling boost is a bad day, losing the dictation is a
 * broken feature. That is why `getUserVocabularyTerms` has no rejecting path at all.
 */

const { buildDynamicTerms, extractCandidatesFromProject } = require('./voiceVocabularyTerms')

/** Contacts marked public for everyone use this sentinel in `isPublicFor`. */
const FEED_PUBLIC_FOR_ALL = 0

const VOICE_VOCABULARY_DOC_PATH = userId => `users/${userId}/private/voiceVocabulary`

/**
 * How long a built vocabulary is considered fresh. A day matches the rate at which the underlying
 * data actually changes, and bounds the rebuild cost at one workspace scan per dictating user per
 * day regardless of how much they dictate.
 */
const VOCABULARY_TTL_MS = 24 * 60 * 60 * 1000

/**
 * The bound on a COLD build — the only case where a dictation waits for the scan. Generous enough
 * for a large workspace, short enough that the worst case is a barely-noticeable pause rather than
 * a dictation that feels broken.
 */
const COLD_BUILD_TIMEOUT_MS = 4000

/**
 * The bound on the single cached document read, which sits directly in front of the Deepgram call
 * on EVERY dictation. Short on purpose: this read is normally tens of milliseconds, and anything
 * near this bound means Firestore is degraded, in which case the static glossary now beats the
 * personalized one later.
 */
const CACHE_READ_TIMEOUT_MS = 1500

/**
 * Scan caps. These exist because workspace size is unbounded in practice: the reporting account has
 * 78 projects, and an all-projects scan there is exactly the O(projects) cost this feature must not
 * introduce. Guides, templates and archived projects are already excluded by the ACTIVE-project
 * scope below, which is what removes the bulk of them.
 *
 * A cap that truncates silently reads as "we looked at everything" when it did not, so
 * `buildUserVocabulary` reports what it skipped and the caller logs it.
 */
const MAX_PROJECTS_SCANNED = 25
const MAX_CONTACTS_PER_PROJECT = 200
const MAX_ASSISTANTS_PER_PROJECT = 50

/** Concurrency of the per-project scan. High enough to stay fast, low enough to be a good citizen. */
const PROJECT_SCAN_CONCURRENCY = 5

function isFresh(updatedAt, now, ttlMs = VOCABULARY_TTL_MS) {
    const stamp = Number(updatedAt)
    if (!Number.isFinite(stamp) || stamp <= 0) return false
    const age = now - stamp
    // A future stamp is clock skew, not freshness — treat it as fresh rather than rebuilding in a
    // loop, since the rebuild would write the same skewed stamp again.
    if (age < 0) return true
    return age < ttlMs
}

function sanitizeStoredTerms(value) {
    if (!Array.isArray(value)) return []
    return value.filter(term => typeof term === 'string' && term.trim()).map(term => term.trim())
}

/**
 * The cached document, or null. Never throws: a missing document, a permission problem or a
 * malformed payload all mean "no usable cache", which the caller handles as a cold miss.
 */
async function readCachedVocabulary(db, userId) {
    try {
        const snapshot = await db.doc(VOICE_VOCABULARY_DOC_PATH(userId)).get()
        if (!snapshot.exists) return null
        const data = snapshot.data() || {}
        const terms = sanitizeStoredTerms(data.terms)
        return { terms, updatedAt: Number(data.updatedAt) || 0 }
    } catch (error) {
        console.warn('[voiceVocabulary] Cached read failed, falling back to a rebuild:', error?.message || error)
        return null
    }
}

/**
 * Active projects only: archived, template and guide projects are excluded.
 *
 * This mirrors `getDelegationScopeProjectIdsFromUserData`, and it is the single most effective cost
 * control here — on the reporting account it removes 64 guide projects, which contain other
 * people's names and would crowd out the user's actual colleagues.
 */
function resolveScopeProjectIds(userData) {
    const excluded = new Set()
    for (const key of ['archivedProjectIds', 'templateProjectIds', 'guideProjectIds']) {
        const ids = userData?.[key]
        if (!Array.isArray(ids)) continue
        for (const id of ids) if (typeof id === 'string' && id.trim()) excluded.add(id.trim())
    }

    const scoped = []
    const ids = Array.isArray(userData?.projectIds) ? userData.projectIds : []
    for (const id of ids) {
        if (typeof id !== 'string') continue
        const trimmed = id.trim()
        if (trimmed && !excluded.has(trimmed) && !scoped.includes(trimmed)) scoped.push(trimmed)
    }
    return scoped
}

async function mapWithConcurrency(items, limit, mapper) {
    const results = []
    let cursor = 0
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++
            results[index] = await mapper(items[index], index)
        }
    })
    await Promise.all(workers)
    return results
}

/**
 * One project's raw material: its name, the contacts the user is actually allowed to see, and its
 * assistants.
 *
 * The `isPublicFor` filter is not optional. This runs through the Admin SDK, which bypasses
 * security rules, so without it a private contact belonging to a colleague would end up in this
 * user's keyterm list — a quiet data leak through a spelling hint. It mirrors the query
 * `ContactRetrievalService` already uses, so it needs no new index.
 *
 * A project that fails to read contributes nothing and does not fail the build: a vocabulary
 * missing one project's names is still far better than no vocabulary.
 */
async function scanProject(db, userId, projectId) {
    try {
        const [projectDoc, contactsSnapshot, assistantsSnapshot] = await Promise.all([
            db.doc(`projects/${projectId}`).get(),
            db
                .collection(`projectsContacts/${projectId}/contacts`)
                .where('isPublicFor', 'array-contains-any', [FEED_PUBLIC_FOR_ALL, userId])
                .limit(MAX_CONTACTS_PER_PROJECT)
                .get(),
            db.collection(`assistants/${projectId}/items`).limit(MAX_ASSISTANTS_PER_PROJECT).get(),
        ])

        return {
            projectId,
            projectName: projectDoc.exists ? projectDoc.data()?.name || '' : '',
            contacts: contactsSnapshot.docs.map(doc => doc.data() || {}),
            assistants: assistantsSnapshot.docs.map(doc => doc.data() || {}),
            failed: false,
        }
    } catch (error) {
        console.warn(`[voiceVocabulary] Project scan failed for ${projectId}:`, error?.message || error)
        return { projectId, projectName: '', contacts: [], assistants: [], failed: true }
    }
}

/**
 * Scans the user's active projects and returns the ranked, capped dynamic term list plus the stats
 * needed to see what the scan actually covered.
 *
 * `excludeTerms` is the static glossary: a term every user already gets must not also consume one
 * of this user's slots.
 */
async function buildUserVocabulary({ db, userId, userData, now = Date.now(), excludeTerms = [] }) {
    const scopeProjectIds = resolveScopeProjectIds(userData)
    const scannedProjectIds = scopeProjectIds.slice(0, MAX_PROJECTS_SCANNED)
    const skippedProjectCount = scopeProjectIds.length - scannedProjectIds.length

    const scanned = await mapWithConcurrency(scannedProjectIds, PROJECT_SCAN_CONCURRENCY, projectId =>
        scanProject(db, userId, projectId)
    )

    const candidates = []
    let contactCount = 0
    let failedProjectCount = 0
    for (const project of scanned) {
        if (project.failed) failedProjectCount += 1
        contactCount += project.contacts.length
        candidates.push(...extractCandidatesFromProject(project))
    }

    const built = buildDynamicTerms(candidates, { now, excludeTerms })
    return {
        ...built,
        stats: {
            scopeProjectCount: scopeProjectIds.length,
            scannedProjectCount: scannedProjectIds.length,
            skippedProjectCount,
            failedProjectCount,
            contactCount,
            candidateCount: candidates.length,
        },
    }
}

/**
 * Builds and persists. The write is best-effort: a vocabulary we could not store is still perfectly
 * usable for the dictation in flight, it just gets rebuilt next time.
 */
async function rebuildAndStoreVocabulary({ db, userId, userData, now = Date.now(), excludeTerms = [] }) {
    const built = await buildUserVocabulary({ db, userId, userData, now, excludeTerms })
    try {
        await db.doc(VOICE_VOCABULARY_DOC_PATH(userId)).set(
            {
                terms: built.terms,
                updatedAt: now,
                // Stored for observability only — never read back into a decision, so a stale or
                // hand-edited value cannot change behaviour.
                stats: built.stats,
                droppedCount: built.droppedCount,
            },
            { merge: true }
        )
    } catch (error) {
        console.warn('[voiceVocabulary] Failed to persist the rebuilt vocabulary:', error?.message || error)
    }
    return built
}

/** Sentinel so a timeout is distinguishable from a legitimate `null` result. */
const TIMED_OUT = Symbol('voiceVocabularyTimedOut')

function withTimeout(promise, timeoutMs, timeoutValue = null) {
    return new Promise(resolve => {
        let settled = false
        const timer = setTimeout(() => {
            if (settled) return
            settled = true
            resolve(timeoutValue)
        }, timeoutMs)
        promise
            .then(value => {
                if (settled) return
                settled = true
                clearTimeout(timer)
                resolve(value)
            })
            .catch(() => {
                if (settled) return
                settled = true
                clearTimeout(timer)
                resolve(null)
            })
    })
}

/**
 * The read path taken on every dictation.
 *
 * Returns `{ terms, cacheState, pendingRebuild }`:
 *   - `terms` are the user's dynamic terms, ready to be merged with the static glossary.
 *   - `cacheState` is one of `fresh` | `stale` | `cold` | `unavailable`, for the log line.
 *   - `pendingRebuild` is a promise the caller SHOULD await near the end of the request when it is
 *     non-null. Cloud Run may freeze the container once a response is returned, so a rebuild that
 *     is never awaited is a rebuild that may never finish — but awaiting it late means it has run
 *     alongside transcription and cleanup and costs no wall clock in practice.
 *
 * Never rejects.
 */
async function getUserVocabularyTerms({ db, userId, userData, now = Date.now(), excludeTerms = [] }) {
    try {
        if (!db || !userId) return { terms: [], cacheState: 'unavailable', pendingRebuild: null }

        // The cache read is bounded too, not just the cold build. This one document read sits
        // directly in front of the Deepgram call, so an unbounded read means a slow or degraded
        // Firestore delays the user's dictation — the exact failure this whole module exists to
        // avoid. A read we could not complete in time is reported as an outage and we do NOT then
        // attempt a build: Firestore is evidently slow, and a build would only compound the delay.
        const cached = await withTimeout(readCachedVocabulary(db, userId), CACHE_READ_TIMEOUT_MS, TIMED_OUT)
        if (cached === TIMED_OUT) {
            console.warn('[voiceVocabulary] Cached read timed out, using the static glossary')
            return { terms: [], cacheState: 'unavailable', pendingRebuild: null }
        }

        if (cached && isFresh(cached.updatedAt, now)) {
            return { terms: cached.terms, cacheState: 'fresh', pendingRebuild: null }
        }

        if (cached) {
            // Stale: serve it now, refresh for next time. The user's contact list did not change
            // enough in a day to be worth delaying their audio for.
            const pendingRebuild = rebuildAndStoreVocabulary({ db, userId, userData, now, excludeTerms }).catch(
                error => {
                    console.warn('[voiceVocabulary] Background rebuild failed:', error?.message || error)
                    return null
                }
            )
            return { terms: cached.terms, cacheState: 'stale', pendingRebuild }
        }

        // Cold: no document at all. Wait for the build, but only briefly — see COLD_BUILD_TIMEOUT_MS.
        const build = rebuildAndStoreVocabulary({ db, userId, userData, now, excludeTerms }).catch(error => {
            console.warn('[voiceVocabulary] Cold build failed:', error?.message || error)
            return null
        })
        const built = await withTimeout(build, COLD_BUILD_TIMEOUT_MS)
        // A build whose every project failed to read is NOT a cold build that worked and found
        // nothing — it is an outage. Reporting it as `cold` would make the log line say the
        // personalization is running fine on an empty workspace, which is the one thing the log is
        // there to distinguish.
        const scanned = built?.stats?.scannedProjectCount || 0
        const scanCollapsed = scanned > 0 && built?.stats?.failedProjectCount === scanned
        if (built?.terms && !scanCollapsed) {
            return { terms: built.terms, cacheState: 'cold', pendingRebuild: null }
        }
        // Timed out or failed: this dictation uses the static glossary only, and the build is still
        // running — hand it back so the caller can let it finish and land in the cache.
        return { terms: [], cacheState: 'unavailable', pendingRebuild: build }
    } catch (error) {
        console.warn('[voiceVocabulary] Vocabulary lookup failed, using the static glossary:', error?.message || error)
        return { terms: [], cacheState: 'unavailable', pendingRebuild: null }
    }
}

module.exports = {
    VOICE_VOCABULARY_DOC_PATH,
    VOCABULARY_TTL_MS,
    COLD_BUILD_TIMEOUT_MS,
    CACHE_READ_TIMEOUT_MS,
    MAX_PROJECTS_SCANNED,
    MAX_CONTACTS_PER_PROJECT,
    MAX_ASSISTANTS_PER_PROJECT,
    FEED_PUBLIC_FOR_ALL,
    isFresh,
    resolveScopeProjectIds,
    readCachedVocabulary,
    scanProject,
    buildUserVocabulary,
    rebuildAndStoreVocabulary,
    getUserVocabularyTerms,
}
