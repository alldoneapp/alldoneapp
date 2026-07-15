const admin = require('firebase-admin')
const crypto = require('crypto')
const { getFunctions } = require('firebase-admin/functions')
const { getEnvFunctions } = require('../envFunctionsHelper')

// ---------------------------------------------------------------------------
// Per-project "golden" E2B template.
//
// A cold VM job (new thread / contextless trigger) otherwise starts from E2B's
// bare managed template and re-clones + re-installs the connected repo's
// dependencies every time — slow, especially for large repos. Instead, we keep
// one warm snapshot per project ("golden") that already has the repo checked out
// with node_modules + the package-manager cache baked in. Cold jobs create their
// sandbox from that snapshot (E2B forks a fresh VM per create, so concurrency is
// free) and only reconcile deps incrementally if the lockfile drifted.
//
// The golden is refreshed EVENT-DRIVEN, never on a clock:
//   #2 self-healing — a cold job hashes the repo lockfile after cloning; if it
//      differs from the baked hash (or no golden exists) it claims a debounce
//      lease and enqueues exactly one rebuild. The job itself is never blocked;
//      the NEXT cold job lands on the fresh golden.
//   #1 on-demand — the rebuildProjectVmGolden callable enqueues the same build.
//
// The build itself runs no agent and costs no Gold — it is platform infra.
// It executes in the `runGoldenBuild` Cloud Tasks worker (see index.js).
// ---------------------------------------------------------------------------

const REGION = 'europe-west1'
const GOLDEN_BUILDER_WORKER_NAME = 'runGoldenBuild'
const E2B_API_BASE = 'https://api.e2b.dev'

// The golden is agent-agnostic (deps don't depend on the CLI), so it is built
// from one managed base. A codex job seeding from it installs the codex CLI on
// top via ensureAgentCliAvailable exactly as it would on a cold managed start —
// no regression, and the expensive dependency install is still skipped.
const GOLDEN_BASE_TEMPLATE = 'claude'

const GOLDEN_BUILD_SANDBOX_TIMEOUT_MS = 30 * 60 * 1000 // sandbox self-kill ceiling for a build
const GOLDEN_INSTALL_TIMEOUT_MS = 20 * 60 * 1000 // per install command (leaves headroom under the 30-min worker ceiling for clone + snapshot)
// Lease outlives the build sandbox timeout so a crashed build's lease expires and
// a later job can retry, but a healthy build never loses it mid-run.
const GOLDEN_REBUILD_LEASE_MS = 35 * 60 * 1000

// Delete a project's golden snapshot after this long without a cold job seeding from it.
// E2B snapshots persist indefinitely and cost storage, so unused ones are reclaimed; the
// next cold job for that project simply rebuilds one.
const GOLDEN_UNUSED_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

const REPO_DIR = '/home/user/repo'

function getGoldenBuilderQueueResource() {
    const projectId =
        process.env.GCLOUD_PROJECT ||
        process.env.GCP_PROJECT ||
        (() => {
            try {
                return admin.app().options.projectId
            } catch (_) {
                return undefined
            }
        })()
    return projectId ? `locations/${REGION}/functions/${GOLDEN_BUILDER_WORKER_NAME}` : GOLDEN_BUILDER_WORKER_NAME
}

function isTaskAlreadyExistsError(error) {
    return ['functions/task-already-exists', 'already-exists', 6].includes(error && error.code)
}

// E2B snapshot names become a template alias, so keep them to a safe charset.
function sanitizeGoldenName(projectId) {
    const slug = String(projectId || '')
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40)
    return `alldone-golden-${slug || 'project'}`
}

function hashLockfileContent(content) {
    return crypto
        .createHash('sha256')
        .update(content || '', 'utf8')
        .digest('hex')
}

// Create a persistent snapshot from the build sandbox's current state via the E2B
// REST API (e2b@1.x exposes no createSnapshot() method — same reason pause/resume
// are called by hand in vmJobRunner). Reusing the same `name` assigns a new build
// to the existing snapshot template. The returned snapshotID is usable directly in
// Sandbox.create(). Creating a snapshot pauses the source sandbox.
async function createGoldenSnapshot(sandboxId, name, e2bApiKey) {
    const resp = await fetch(`${E2B_API_BASE}/sandboxes/${sandboxId}/snapshots`, {
        method: 'POST',
        headers: { 'X-API-KEY': e2bApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
    })
    if (!resp.ok) {
        const body = await resp.text().catch(() => '')
        throw new Error(`E2B snapshot ${resp.status}: ${body.substring(0, 200)}`)
    }
    const data = await resp.json().catch(() => ({}))
    const snapshotId = data && data.snapshotID
    if (!snapshotId) {
        throw new Error('E2B snapshot response did not include a snapshotID')
    }
    return snapshotId
}

// Detect the package manager and install dependencies inside the build sandbox.
// A per-project `setupCommand` override wins (it is how a repo carries a bespoke
// post-install step, e.g. alldone_app's replacement_node_modules/quill swap);
// otherwise auto-detect by lockfile. Returns the detected package manager label.
async function runGoldenInstall(sandbox, setupCommand) {
    const script = `set -e
cd ${REPO_DIR}
if [ -n "$SETUP_COMMAND" ]; then
  echo "GOLDEN_PM=custom"
  eval "$SETUP_COMMAND"
elif [ -f pnpm-lock.yaml ]; then
  echo "GOLDEN_PM=pnpm"
  corepack enable >/dev/null 2>&1 || true
  pnpm install --frozen-lockfile
elif [ -f yarn.lock ]; then
  echo "GOLDEN_PM=yarn"
  corepack enable >/dev/null 2>&1 || true
  yarn install --frozen-lockfile
elif [ -f package-lock.json ]; then
  echo "GOLDEN_PM=npm"
  npm ci
else
  echo "GOLDEN_PM=npm-nolock"
  npm install
fi
echo "GOLDEN_INSTALL_OK"
`
    // Write the script to a file and run it with envs (like setupGitRepo's git-setup.sh) so the
    // outer shell never sees — and never expands — $SETUP_COMMAND before bash does.
    await sandbox.files.write('/home/user/golden-install.sh', script)
    let stdout = ''
    let stderr = ''
    try {
        await sandbox.commands.run('bash /home/user/golden-install.sh', {
            envs: { SETUP_COMMAND: setupCommand || '' },
            timeoutMs: GOLDEN_INSTALL_TIMEOUT_MS,
            onStdout: d => {
                stdout += d
            },
            onStderr: d => {
                stderr += d
            },
        })
    } catch (err) {
        const detail = (stderr || (err && err.message) || '').substring(0, 400)
        throw new Error(`Dependency install failed while building the golden environment. ${detail}`)
    }
    const pm = ((stdout.match(/GOLDEN_PM=(\S+)/) || [])[1] || 'npm').replace(/-nolock$/, '')
    return { packageManager: pm }
}

// Read + hash whichever lockfile the repo uses, so drift can be detected cheaply
// on the next cold job without a rebuild.
async function readGoldenLockfileHash(sandbox) {
    for (const file of ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']) {
        try {
            const content = await sandbox.files.read(`${REPO_DIR}/${file}`)
            if (content != null) return { lockfile: file, lockfileHash: hashLockfileContent(content) }
        } catch (_) {
            // Not this lockfile — try the next.
        }
    }
    return { lockfile: null, lockfileHash: null }
}

function projectRef(projectId) {
    return admin.firestore().doc(`projects/${projectId}`)
}

// CAS a rebuild lease onto projects/{projectId}.vmGolden so a burst of cold jobs
// enqueues exactly one build. `status` is intentionally left as-is when a golden
// already exists (cold jobs keep serving the old snapshot while the new one
// builds); only `rebuildState` gates the enqueue. Returns { claimed, buildId }.
async function claimGoldenRebuildLease(projectId, requestUserId, reason) {
    const ref = projectRef(projectId)
    const now = Date.now()
    return admin.firestore().runTransaction(async transaction => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists) return { claimed: false }
        const g = (snapshot.data() || {}).vmGolden || {}
        if (g.rebuildState === 'building' && Number(g.rebuildLeaseExpiresAt) > now) {
            return { claimed: false }
        }
        const buildId = crypto.randomUUID()
        transaction.set(
            ref,
            {
                vmGolden: {
                    status: g.status || 'building',
                    rebuildState: 'building',
                    rebuildReason: reason || 'manual',
                    rebuildLeaseOwner: buildId,
                    rebuildLeaseExpiresAt: now + GOLDEN_REBUILD_LEASE_MS,
                    rebuildRequestedBy: requestUserId || null,
                    rebuildRequestedAt: now,
                    lastBuildId: buildId,
                    lastError: null,
                },
            },
            { merge: true }
        )
        return { claimed: true, buildId }
    })
}

// Release the lease (build finished/failed or could not be enqueued). Only the
// current lease owner may release — a newer build that superseded this one keeps
// its lease. Preserves any existing snapshot so a failed rebuild leaves the prior
// golden usable.
async function releaseGoldenRebuildLease(projectId, buildId, errorMessage) {
    const ref = projectRef(projectId)
    await admin
        .firestore()
        .runTransaction(async transaction => {
            const snapshot = await transaction.get(ref)
            if (!snapshot.exists) return
            const g = (snapshot.data() || {}).vmGolden || {}
            if (g.rebuildLeaseOwner && g.rebuildLeaseOwner !== buildId) return
            transaction.set(
                ref,
                {
                    vmGolden: {
                        status: g.snapshotId ? 'ready' : 'failed',
                        rebuildState: 'idle',
                        rebuildLeaseOwner: null,
                        rebuildLeaseExpiresAt: 0,
                        lastBuildId: buildId,
                        lastError: errorMessage ? String(errorMessage).slice(0, 500) : null,
                        lastFailedAt: errorMessage ? Date.now() : g.lastFailedAt || null,
                    },
                },
                { merge: true }
            )
        })
        .catch(error => console.warn('🌱 GOLDEN: release lease failed', { projectId, error: error.message }))
}

async function enqueueGoldenRebuild(projectId, buildId, requestUserId) {
    const queue = getFunctions().taskQueue(getGoldenBuilderQueueResource())
    try {
        await queue.enqueue(
            { buildId, projectId, requestUserId: requestUserId || null },
            { id: `golden-${sanitizeGoldenName(projectId)}-${buildId}`, dispatchDeadlineSeconds: 1800 }
        )
        return true
    } catch (error) {
        if (isTaskAlreadyExistsError(error)) return true
        throw error
    }
}

// True when the project has a usable golden snapshot to seed a cold sandbox from.
// Stays truthy DURING a rebuild (status remains 'ready' while the old snapshot is
// still served), so cold starts are never blocked waiting on a build.
function resolveGoldenTemplate(project) {
    const g = (project && project.vmGolden) || {}
    if (g.status === 'ready' && g.snapshotId) return g.snapshotId
    return null
}

// Mark the project's golden as used now, so the unused-TTL cleanup only deletes snapshots
// no cold job has seeded from in a long time. Best-effort, fire-and-forget.
function touchGoldenUsage(projectId) {
    projectRef(projectId)
        .set({ vmGolden: { lastUsedAt: Date.now() } }, { merge: true })
        .catch(() => {})
}

// Decide whether this cold job's repo has drifted from the baked golden and, if
// so, claim the debounce lease and enqueue exactly one rebuild. Best-effort:
// called from the hot job path, so it never throws. `force` bypasses the
// missing/drift check (used when a golden snapshot turned out to be unusable at
// create time, so a fresh one is built regardless of the recorded state).
// Returns { triggered }.
async function maybeTriggerGoldenRebuild({ projectId, requestUserId, project, currentLockfileHash, force = false }) {
    try {
        const g = (project && project.vmGolden) || {}
        const missing = !g.snapshotId || g.status !== 'ready'
        const drifted = !!currentLockfileHash && (!g.lockfileHash || g.lockfileHash !== currentLockfileHash)
        if (!force && !missing && !drifted) {
            touchGoldenUsage(projectId)
            return { triggered: false }
        }

        const reason = force ? 'broken' : missing ? 'missing' : 'drift'
        const { claimed, buildId } = await claimGoldenRebuildLease(projectId, requestUserId, reason)
        if (!claimed) return { triggered: false, reason: 'locked' }
        try {
            await enqueueGoldenRebuild(projectId, buildId, requestUserId)
        } catch (error) {
            console.warn('🌱 GOLDEN: enqueue failed, releasing lease', { projectId, error: error.message })
            await releaseGoldenRebuildLease(projectId, buildId, `enqueue failed: ${error.message}`)
            return { triggered: false, reason: 'enqueue_failed' }
        }
        console.log('🌱 GOLDEN: rebuild enqueued', { projectId, buildId, reason })
        return { triggered: true, buildId }
    } catch (error) {
        console.warn('🌱 GOLDEN: maybeTriggerGoldenRebuild failed', {
            projectId,
            error: error && error.message,
        })
        return { triggered: false, reason: 'error' }
    }
}

// The Cloud Tasks worker body. Builds the project's golden snapshot from a fresh
// sandbox: clone the connected repo (reusing the job runner's git setup), install
// deps, snapshot, and record the pointer on the project doc. Runs no agent, spends
// no Gold. Idempotent: only the current lease owner writes the result.
async function runGoldenBuild({ buildId, projectId, requestUserId }) {
    if (!buildId || !projectId) {
        console.error('🌱 GOLDEN: runGoldenBuild missing buildId/projectId', { buildId, projectId })
        return
    }
    const e2bApiKey = getEnvFunctions().E2B_API_KEY
    if (!e2bApiKey) {
        await releaseGoldenRebuildLease(projectId, buildId, 'E2B_API_KEY is not configured')
        return
    }

    const db = admin.firestore()
    const projectSnap = await db.doc(`projects/${projectId}`).get()
    const project = projectSnap.exists ? projectSnap.data() : null
    const g = (project && project.vmGolden) || {}
    // A newer build superseded this one before it started — do nothing.
    if (!project || (g.rebuildLeaseOwner && g.rebuildLeaseOwner !== buildId)) {
        console.warn('🌱 GOLDEN: build superseded before start', {
            projectId,
            buildId,
            currentOwner: g.rebuildLeaseOwner || null,
        })
        return
    }

    // Reuse the job runner's repo-context loader (project repo config + this user's
    // token) and git setup (clone/fetch + Codex-safe metadata split).
    const runner = require('./vmJobRunner')
    const loadRepoContext = runner.__private__.loadRepoContext
    const setupGitRepo = runner.__private__.setupGitRepo

    const gitContext = await loadRepoContext({ projectId, requestUserId })
    if (!gitContext || !gitContext.enabled) {
        await releaseGoldenRebuildLease(
            projectId,
            buildId,
            'No connected repository, or the requesting user has no token for it'
        )
        return
    }

    const { Sandbox } = require('e2b')
    const correlationId = `golden-${buildId}`
    let sandbox = null
    try {
        console.log('🌱 GOLDEN: building', { projectId, buildId, provider: gitContext.provider })
        sandbox = await Sandbox.create(GOLDEN_BASE_TEMPLATE, {
            apiKey: e2bApiKey,
            timeoutMs: GOLDEN_BUILD_SANDBOX_TIMEOUT_MS,
            allowInternetAccess: true,
        })
        await setupGitRepo(sandbox, gitContext, correlationId)
        const { packageManager } = await runGoldenInstall(sandbox, (g.setupCommand || '').trim())
        const { lockfile, lockfileHash } = await readGoldenLockfileHash(sandbox)
        const name = sanitizeGoldenName(projectId)
        const snapshotId = await createGoldenSnapshot(sandbox.sandboxId, name, e2bApiKey)

        await db.doc(`projects/${projectId}`).set(
            {
                vmGolden: {
                    snapshotId,
                    name,
                    lockfile: lockfile || null,
                    lockfileHash: lockfileHash || null,
                    packageManager,
                    baseTemplate: GOLDEN_BASE_TEMPLATE,
                    status: 'ready',
                    rebuildState: 'idle',
                    rebuildLeaseOwner: null,
                    rebuildLeaseExpiresAt: 0,
                    builtAt: Date.now(),
                    // Initialize lastUsedAt so the unused-TTL cleanup query always matches a ready
                    // golden; cold jobs refresh it via touchGoldenUsage when they seed from it.
                    lastUsedAt: Date.now(),
                    builtByUserId: requestUserId || null,
                    lastBuildId: buildId,
                    lastError: null,
                    deletedAt: null,
                    deletedReason: null,
                },
            },
            { merge: true }
        )
        console.log('🌱 GOLDEN: built', { projectId, buildId, snapshotId, packageManager, lockfile })
    } catch (error) {
        console.error('🌱 GOLDEN: build failed', { projectId, buildId, error: error && error.message })
        await releaseGoldenRebuildLease(projectId, buildId, (error && error.message) || 'Golden build failed')
    } finally {
        if (sandbox && sandbox.sandboxId) {
            await Sandbox.kill(sandbox.sandboxId, { apiKey: e2bApiKey }).catch(() => {})
        }
    }
}

// Delete a golden snapshot from the E2B team account. A snapshot is a template, so this
// hits DELETE /templates/{snapshotId} (e2b@1.x has no deleteSnapshot()). 404 = already gone.
async function deleteGoldenSnapshot(snapshotId, e2bApiKey) {
    const resp = await fetch(`${E2B_API_BASE}/templates/${encodeURIComponent(snapshotId)}`, {
        method: 'DELETE',
        headers: { 'X-API-KEY': e2bApiKey },
    })
    if (resp.status === 404) return false
    if (!resp.ok) {
        const body = await resp.text().catch(() => '')
        throw new Error(`E2B delete template ${resp.status}: ${body.substring(0, 200)}`)
    }
    return true
}

// Scheduled reclaimer: delete golden snapshots no cold job has seeded from in GOLDEN_UNUSED_TTL_MS,
// and reset the project pointer so a future cold job rebuilds. Skips goldens mid-rebuild. The query
// matches only projects whose vmGolden.lastUsedAt is old (ready goldens always have it set).
async function cleanupUnusedVmGoldenSnapshots({ now = Date.now(), ttlMs = GOLDEN_UNUSED_TTL_MS } = {}) {
    const stats = { scanned: 0, deleted: 0, alreadyGone: 0, failed: 0 }
    const e2bApiKey = getEnvFunctions().E2B_API_KEY
    if (!e2bApiKey) {
        console.warn('🌱 GOLDEN CLEANUP: E2B_API_KEY not configured; skipping')
        return stats
    }
    const db = admin.firestore()
    const cutoff = now - ttlMs
    const snap = await db.collection('projects').where('vmGolden.lastUsedAt', '<', cutoff).get()
    for (const doc of snap.docs) {
        const g = (doc.data() || {}).vmGolden || {}
        if (!g.snapshotId || g.rebuildState === 'building') continue
        stats.scanned++
        try {
            const deleted = await deleteGoldenSnapshot(g.snapshotId, e2bApiKey)
            if (deleted) stats.deleted++
            else stats.alreadyGone++
            await doc.ref.set(
                {
                    vmGolden: {
                        status: 'idle',
                        snapshotId: null,
                        lockfile: null,
                        lockfileHash: null,
                        rebuildState: 'idle',
                        rebuildLeaseOwner: null,
                        rebuildLeaseExpiresAt: 0,
                        deletedAt: now,
                        deletedReason: 'unused_ttl',
                    },
                },
                { merge: true }
            )
        } catch (error) {
            stats.failed++
            console.warn('🌱 GOLDEN CLEANUP: delete failed', { projectId: doc.id, error: error.message })
        }
    }
    console.log('🌱 GOLDEN CLEANUP: completed', stats)
    return stats
}

module.exports = {
    GOLDEN_BASE_TEMPLATE,
    GOLDEN_REBUILD_LEASE_MS,
    GOLDEN_UNUSED_TTL_MS,
    getGoldenBuilderQueueResource,
    sanitizeGoldenName,
    hashLockfileContent,
    createGoldenSnapshot,
    runGoldenInstall,
    readGoldenLockfileHash,
    claimGoldenRebuildLease,
    releaseGoldenRebuildLease,
    enqueueGoldenRebuild,
    resolveGoldenTemplate,
    maybeTriggerGoldenRebuild,
    touchGoldenUsage,
    deleteGoldenSnapshot,
    cleanupUnusedVmGoldenSnapshots,
    runGoldenBuild,
}
