/**
 * The one place that answers "which bucket holds this deployment's note bodies?".
 *
 * A note's body is not in its Firestore document — it is a Yjs binary at
 * `notesData/{projectId}/{noteId}` in a dedicated Storage bucket, one per
 * environment (`notescontentprod` / `notescontentstaging` / `notescontentdev`).
 * Every reader and writer therefore has to resolve that bucket name, and until
 * AT-2498 they did it in two incompatible ways:
 *
 *   - `NoteService`, `noteContextHelper` and the assistant's `create_note` /
 *     `update_note` handlers treat the DEPLOYED PROJECT as authoritative and
 *     ignore a configured value that disagrees with it;
 *   - `searchHelper.getNoteContent` and the copy/template/delete paths trusted
 *     `defineString('GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET')` as written.
 *
 * Those two rules returned the same answer right up until the production value
 * of that parameter became `notescontentdev`. From 2026-08-29 the writers kept
 * writing to `notescontentprod` while the search indexer read
 * `notescontentdev` — a bucket in another project that the production
 * `firebase-adminsdk` service account cannot read — so `getNoteContent` threw
 * `storage.objects.get denied` on EVERY note create and update, and no note
 * body reached Typesense at all. The failure was invisible from the product:
 * notes saved fine, the assistant reported success, and only search went quietly
 * stale.
 *
 * Hence one resolver, used by everything. Deployed project identity wins,
 * because it is the only input that cannot be wrong: a misconfigured parameter
 * (or a developer's `.env`) must never point production note content at a
 * staging bucket, in either direction. When there is no deployed identity to go
 * on (local scripts, tests) the configured value is honoured as before.
 */

const PRODUCTION_PROJECT_ID = 'alldonealeph'
const STAGING_PROJECT_ID = 'alldonestaging'

const PRODUCTION_NOTES_BUCKET = 'notescontentprod'
const STAGING_NOTES_BUCKET = 'notescontentstaging'
const FALLBACK_NOTES_BUCKET = 'notescontentdev'

const BUCKET_BY_PROJECT_ID = {
    [PRODUCTION_PROJECT_ID]: PRODUCTION_NOTES_BUCKET,
    [STAGING_PROJECT_ID]: STAGING_NOTES_BUCKET,
}

// A mismatch is a deployment-wide condition, not a per-call one: warning on
// every note would bury the signal in the same log stream it needs to stand out
// in. Warn once per distinct (project, configured) pair per instance.
const reportedMismatches = new Set()

/**
 * Which project is this code actually deployed in?
 * Ordered cheapest-first; every source is optional and any of them may be absent
 * in tests or local scripts, in which case the answer is `null` (= unknown).
 * @param {object} [deps]
 * @param {object} [deps.env] process.env override, for tests
 * @param {object} [deps.admin] firebase-admin override, for tests
 * @returns {string|null}
 */
const resolveDeployedProjectId = ({ env = process.env, admin } = {}) => {
    const fromEnv = (env && (env.GCLOUD_PROJECT || env.GCP_PROJECT)) || null
    if (fromEnv) return fromEnv

    if (env && env.FIREBASE_CONFIG) {
        try {
            const parsed = JSON.parse(env.FIREBASE_CONFIG)
            if (parsed && parsed.projectId) return parsed.projectId
        } catch (_) {
            // A malformed FIREBASE_CONFIG is not worth failing a note read over.
        }
    }

    try {
        const adminSdk = admin || require('firebase-admin')
        const projectId = adminSdk && adminSdk.app && adminSdk.app().options && adminSdk.app().options.projectId
        if (projectId) return projectId
    } catch (_) {
        // No initialized app (tests, cold module load) — treat as unknown.
    }

    return null
}

/**
 * The bucket a given deployment MUST use, or null when the project is unknown
 * (i.e. neither production nor staging, so nothing to enforce).
 * @param {string|null|undefined} projectId
 * @returns {string|null}
 */
const getExpectedNotesBucket = projectId => BUCKET_BY_PROJECT_ID[projectId] || null

/**
 * Resolve the notes Storage bucket for this deployment.
 *
 * @param {object} [options]
 * @param {string} [options.configuredBucket] value read from env/params by the caller
 * @param {string} [options.projectId] deployed project id, resolved here when omitted
 * @param {object} [options.env] process.env override, for tests
 * @param {object} [options.admin] firebase-admin override, for tests
 * @param {object} [options.logger] console-like sink, for tests
 * @returns {string} a bucket name; never empty
 */
const resolveNotesBucketName = ({ configuredBucket, projectId, env, admin, logger = console } = {}) => {
    const deployedProjectId = projectId === undefined ? resolveDeployedProjectId({ env, admin }) : projectId
    const expectedBucket = getExpectedNotesBucket(deployedProjectId)
    const configured = typeof configuredBucket === 'string' ? configuredBucket.trim() : ''

    if (expectedBucket) {
        if (configured && configured !== expectedBucket) {
            const key = `${deployedProjectId}:${configured}`
            if (!reportedMismatches.has(key)) {
                reportedMismatches.add(key)
                logger.warn(
                    `[notesStorageBucket] Configured notes bucket "${configured}" does not match project ` +
                        `"${deployedProjectId}" (expected "${expectedBucket}"). Using "${expectedBucket}". ` +
                        `Fix GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET for this environment.`
                )
            }
        }
        return expectedBucket
    }

    return configured || FALLBACK_NOTES_BUCKET
}

/**
 * Convenience wrapper for the many call sites whose only source is the Firebase
 * Functions parameter. Keeps the `defineString` require lazy — importing
 * `firebase-functions/params` at module scope breaks plain-node scripts.
 * @param {object} [options] forwarded to `resolveNotesBucketName`
 * @returns {string}
 */
const getNotesBucketName = (options = {}) => {
    let configuredBucket = options.configuredBucket

    // The parameter is consulted FIRST, because that is the single source every
    // call site used before this module existed. Reading `process.env` ahead of it
    // would be a new precedence rule, and the point here is to add the deployed
    // project guard without moving anything else.
    if (configuredBucket === undefined) {
        try {
            const { defineString } = require('firebase-functions/params')
            configuredBucket = defineString('GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET').value()
        } catch (_) {
            // Parameter machinery unavailable (plain-node scripts) — fall through.
        }
    }

    if (!configuredBucket) {
        const env = options.env || process.env
        configuredBucket = env.GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET || undefined
    }

    return resolveNotesBucketName({ ...options, configuredBucket })
}

const __resetMismatchWarnings = () => reportedMismatches.clear()

module.exports = {
    PRODUCTION_PROJECT_ID,
    STAGING_PROJECT_ID,
    PRODUCTION_NOTES_BUCKET,
    STAGING_NOTES_BUCKET,
    FALLBACK_NOTES_BUCKET,
    resolveDeployedProjectId,
    getExpectedNotesBucket,
    resolveNotesBucketName,
    getNotesBucketName,
    __resetMismatchWarnings,
}
