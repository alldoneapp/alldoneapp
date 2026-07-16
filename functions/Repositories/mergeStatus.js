'use strict'

const admin = require('firebase-admin')
const { HttpsError } = require('firebase-functions/v2/https')

const MERGE_STATUS = Object.freeze({
    DRAFT: 'draft',
    CHECKS_RUNNING: 'checks_running',
    NEEDS_APPROVAL: 'needs_approval',
    BLOCKED: 'blocked',
    READY_TO_MERGE: 'ready_to_merge',
    MERGED: 'merged',
    CLOSED: 'closed',
})

const CACHE_TTL_MS = 5 * 60 * 1000
const FAILED_CHECK_STATES = new Set(['failed', 'failure', 'error', 'canceled', 'cancelled', 'timed_out'])
const RUNNING_CHECK_STATES = new Set([
    'created',
    'pending',
    'preparing',
    'running',
    'scheduled',
    'waiting_for_resource',
    'requested',
    'queued',
    'in_progress',
])

/**
 * @typedef {'gitlab'|'github'} MergeProvider
 * @typedef {'draft'|'checks_running'|'needs_approval'|'blocked'|'ready_to_merge'|'merged'|'closed'} MergeDisplayStatus
 * @typedef {{provider: MergeProvider, url: string, number: number, repo: string, status?: MergeDisplayStatus|null, statusUpdatedAt?: number|null, sourceVmJobId?: string|null}} TaskMergeRequest
 */

function cleanResultUrl(value) {
    return String(value || '')
        .replace(/^[<(\[]+/, '')
        .replace(/[>)\],.;:'"]+$/, '')
}

function getConnectedRepoIdentity(gitContext) {
    try {
        const repoUrl = new URL(gitContext.repoUrl)
        return {
            origin: repoUrl.origin.toLowerCase(),
            path: repoUrl.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, ''),
        }
    } catch (_) {
        return null
    }
}

/**
 * Extract the MR/PR URL the VM agent already returned, accepting only a URL for the
 * connected repository. This prevents unrelated links in the final answer from being
 * associated with the task.
 */
function extractMergeRequestReference(output, gitContext) {
    if (!gitContext || !gitContext.enabled || !gitContext.provider || !gitContext.repoUrl) return null
    const repo = getConnectedRepoIdentity(gitContext)
    if (!repo) return null

    const candidates = String(output || '').match(/https?:\/\/[^\s]+/gi) || []
    for (const candidate of candidates) {
        try {
            const parsed = new URL(cleanResultUrl(candidate))
            if (parsed.origin.toLowerCase() !== repo.origin) continue
            const path = parsed.pathname.replace(/^\/+|\/+$/g, '')
            const escapedRepoPath = repo.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            const pattern =
                gitContext.provider === 'github'
                    ? new RegExp(`^${escapedRepoPath}/pull/(\\d+)$`, 'i')
                    : new RegExp(`^${escapedRepoPath}/-/merge_requests/(\\d+)$`, 'i')
            const match = path.match(pattern)
            if (!match) continue

            return {
                provider: gitContext.provider,
                url: `${parsed.origin}/${path}`,
                number: Number(match[1]),
                repo: repo.path,
            }
        } catch (_) {}
    }
    return null
}

function normalizeGitlabMergeStatus(mergeRequest = {}, approvals = null) {
    const state = String(mergeRequest.state || '').toLowerCase()
    const detailed = String(mergeRequest.detailed_merge_status || mergeRequest.merge_status || '').toLowerCase()
    const pipelineState = String(mergeRequest.head_pipeline?.status || '').toLowerCase()
    const approvalsLeft = Number(approvals?.approvals_left)
    const hasConflicts = mergeRequest.has_conflicts === true || detailed === 'conflict'
    const checksFailed = FAILED_CHECK_STATES.has(pipelineState) || detailed === 'ci_must_pass'
    const checksRunning =
        RUNNING_CHECK_STATES.has(pipelineState) || ['checking', 'unchecked', 'ci_still_running'].includes(detailed)
    const approvalsMissing =
        (Number.isFinite(approvalsLeft) && approvalsLeft > 0) ||
        ['not_approved', 'approvals_syncing'].includes(detailed)

    let status
    if (state === 'merged' || mergeRequest.merged_at) status = MERGE_STATUS.MERGED
    else if (state === 'closed') status = MERGE_STATUS.CLOSED
    else if (mergeRequest.draft || mergeRequest.work_in_progress) status = MERGE_STATUS.DRAFT
    else if (hasConflicts || checksFailed) status = MERGE_STATUS.BLOCKED
    else if (checksRunning) status = MERGE_STATUS.CHECKS_RUNNING
    else if (approvalsMissing) status = MERGE_STATUS.NEEDS_APPROVAL
    else if (['can_be_merged', 'mergeable'].includes(detailed)) status = MERGE_STATUS.READY_TO_MERGE
    else status = MERGE_STATUS.BLOCKED

    return {
        status,
        providerState: detailed || state || null,
        checks: pipelineState || null,
        approvals: Number.isFinite(approvalsLeft) ? { missing: Math.max(0, approvalsLeft) } : null,
        hasConflicts,
    }
}

function getLatestGithubReviews(reviews) {
    const latestByReviewer = new Map()
    ;(Array.isArray(reviews) ? reviews : []).forEach(review => {
        const reviewer = review?.user?.login
        if (reviewer) latestByReviewer.set(reviewer, String(review.state || '').toLowerCase())
    })
    return Array.from(latestByReviewer.values())
}

function normalizeGithubMergeStatus(pullRequest = {}, checkRuns = {}, combinedStatus = {}, reviews = []) {
    const state = String(pullRequest.state || '').toLowerCase()
    const mergeableState = String(pullRequest.mergeable_state || '').toLowerCase()
    const runs = Array.isArray(checkRuns.check_runs) ? checkRuns.check_runs : []
    const legacyState = String(combinedStatus.state || '').toLowerCase()
    const reviewStates = getLatestGithubReviews(reviews)
    const failedConclusions = new Set([
        'failure',
        'cancelled',
        'timed_out',
        'action_required',
        'startup_failure',
        'stale',
    ])
    const checksFailed =
        runs.some(
            run => run.status === 'completed' && failedConclusions.has(String(run.conclusion || '').toLowerCase())
        ) ||
        ['failure', 'error'].includes(legacyState) ||
        mergeableState === 'unstable'
    const checksRunning =
        runs.some(run => String(run.status || '').toLowerCase() !== 'completed') ||
        legacyState === 'pending' ||
        mergeableState === 'unknown'
    const hasConflicts = pullRequest.mergeable === false || mergeableState === 'dirty'
    const changesRequested = reviewStates.includes('changes_requested')
    const reviewersRequested =
        (Array.isArray(pullRequest.requested_reviewers) && pullRequest.requested_reviewers.length > 0) ||
        (Array.isArray(pullRequest.requested_teams) && pullRequest.requested_teams.length > 0)
    const approvalsMissing = reviewersRequested || (mergeableState === 'blocked' && !changesRequested)

    let status
    if (pullRequest.merged || pullRequest.merged_at) status = MERGE_STATUS.MERGED
    else if (state === 'closed') status = MERGE_STATUS.CLOSED
    else if (pullRequest.draft) status = MERGE_STATUS.DRAFT
    else if (hasConflicts || checksFailed || changesRequested) status = MERGE_STATUS.BLOCKED
    else if (checksRunning) status = MERGE_STATUS.CHECKS_RUNNING
    else if (approvalsMissing) status = MERGE_STATUS.NEEDS_APPROVAL
    else if (pullRequest.mergeable === true || ['clean', 'has_hooks'].includes(mergeableState)) {
        status = MERGE_STATUS.READY_TO_MERGE
    } else status = MERGE_STATUS.BLOCKED

    return {
        status,
        providerState: mergeableState || state || null,
        checks: checksFailed ? 'failed' : checksRunning ? 'running' : runs.length || legacyState ? 'passed' : null,
        approvals: {
            missing: approvalsMissing,
            changesRequested,
        },
        hasConflicts,
    }
}

async function requestJson(url, headers, { optional = false } = {}) {
    let response
    try {
        response = await fetch(url, { headers })
    } catch (_) {
        if (optional) return null
        throw new HttpsError('unavailable', 'Could not reach the repository provider.')
    }
    if (!response.ok) {
        if (optional) return null
        if (response.status === 401 || response.status === 403) {
            throw new HttpsError('permission-denied', 'The connected repository credential cannot read this MR/PR.')
        }
        if (response.status === 404) throw new HttpsError('not-found', 'The MR/PR could not be found.')
        throw new HttpsError('unavailable', `The repository provider returned HTTP ${response.status}.`)
    }
    return response.json().catch(() => ({}))
}

async function fetchGitlabStatus(reference, tokenData) {
    const parsed = new URL(reference.url)
    const host = tokenData.host || parsed.origin
    const headers = { 'PRIVATE-TOKEN': tokenData.token }
    const base = `${host}/api/v4/projects/${encodeURIComponent(reference.repo)}/merge_requests/${reference.number}`
    const [mergeRequest, approvals] = await Promise.all([
        requestJson(`${base}?with_merge_status_recheck=true`, headers),
        requestJson(`${base}/approvals`, headers, { optional: true }),
    ])
    return normalizeGitlabMergeStatus(mergeRequest, approvals)
}

async function fetchGithubStatus(reference, tokenData) {
    const parsed = new URL(reference.url)
    const apiBase =
        tokenData.apiBase ||
        (/github\.com$/i.test(parsed.hostname) ? 'https://api.github.com' : `${parsed.origin}/api/v3`)
    const headers = {
        Authorization: `Bearer ${tokenData.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Alldone-App',
    }
    const pullRequest = await requestJson(`${apiBase}/repos/${reference.repo}/pulls/${reference.number}`, headers)
    const sha = pullRequest?.head?.sha
    const [checkRuns, combinedStatus, reviews] = sha
        ? await Promise.all([
              requestJson(`${apiBase}/repos/${reference.repo}/commits/${sha}/check-runs?per_page=100`, headers, {
                  optional: true,
              }),
              requestJson(`${apiBase}/repos/${reference.repo}/commits/${sha}/status`, headers, { optional: true }),
              requestJson(
                  `${apiBase}/repos/${reference.repo}/pulls/${reference.number}/reviews?per_page=100`,
                  headers,
                  {
                      optional: true,
                  }
              ),
          ])
        : [{}, {}, []]
    return normalizeGithubMergeStatus(pullRequest, checkRuns || {}, combinedStatus || {}, reviews || [])
}

async function assertReferenceMatchesConnectedProject(db, projectId, reference) {
    const projectDoc = await db.doc(`projects/${projectId}`).get()
    if (!projectDoc.exists) throw new HttpsError('not-found', 'Project not found.')
    const project = projectDoc.data() || {}
    const repoUrl = reference.provider === 'github' ? project.githubRepoUrl : project.gitlabRepoUrl
    const validated = extractMergeRequestReference(reference.url, {
        enabled: true,
        provider: reference.provider,
        repoUrl,
    })
    if (!validated || validated.repo !== reference.repo || validated.number !== Number(reference.number)) {
        throw new HttpsError('failed-precondition', 'This MR/PR does not belong to the connected project repository.')
    }
}

async function loadProviderToken(db, projectId, taskId, reference, preferredUserId) {
    const candidateUserIds = [preferredUserId]
    if (reference.sourceVmJobId) {
        const job = await db
            .doc(`vmJobs/${reference.sourceVmJobId}`)
            .get()
            .catch(() => null)
        const jobData = job?.exists ? job.data() || {} : {}
        const sourceUserId =
            jobData.projectId === projectId && jobData.objectId === taskId ? jobData.requestUserId : null
        if (sourceUserId && !candidateUserIds.includes(sourceUserId)) candidateUserIds.push(sourceUserId)
    }

    for (const userId of candidateUserIds.filter(Boolean)) {
        const authDoc = await db.doc(`users/${userId}/private/${reference.provider}Auth_${projectId}`).get()
        if (authDoc.exists && authDoc.data()?.token) return authDoc.data()
    }
    throw new HttpsError(
        'failed-precondition',
        `No connected ${reference.provider} credential can refresh this status.`
    )
}

async function fetchProviderStatus(reference, tokenData) {
    return reference.provider === 'github'
        ? fetchGithubStatus(reference, tokenData)
        : fetchGitlabStatus(reference, tokenData)
}

function buildStoredReference(reference, normalized, previous = {}) {
    const now = Date.now()
    return {
        provider: reference.provider,
        url: reference.url,
        number: reference.number,
        repo: reference.repo,
        sourceVmJobId: reference.sourceVmJobId || previous.sourceVmJobId || null,
        createdAt: previous.createdAt || now,
        status: normalized.status,
        statusUpdatedAt: now,
        providerState: normalized.providerState,
        checks: normalized.checks,
        approvals: normalized.approvals,
        hasConflicts: normalized.hasConflicts,
    }
}

async function refreshTaskMergeStatus({ userId, projectId, taskId, force = false }) {
    const db = admin.firestore()
    const taskRef = db.doc(`items/${projectId}/tasks/${taskId}`)
    const taskDoc = await taskRef.get()
    if (!taskDoc.exists) throw new HttpsError('not-found', 'Task not found.')
    const current = taskDoc.data()?.vmMergeRequest
    if (!current?.url || !current?.provider) return { mergeRequest: null }

    const age = Date.now() - Number(current.statusUpdatedAt || 0)
    if (!force && current.status && age >= 0 && age < CACHE_TTL_MS) return { mergeRequest: current, cached: true }

    await assertReferenceMatchesConnectedProject(db, projectId, current)
    const tokenData = await loadProviderToken(db, projectId, taskId, current, userId)
    const normalized = await fetchProviderStatus(current, tokenData)
    const mergeRequest = buildStoredReference(current, normalized, current)
    await taskRef.set({ vmMergeRequest: mergeRequest }, { merge: true })
    return { mergeRequest, cached: false }
}

/** Best-effort association called after a successful coding VM run. */
async function associateVmMergeRequestWithTask({ vmJob, gitContext, output }) {
    if (!vmJob || (vmJob.objectType && vmJob.objectType !== 'tasks')) return null
    const extracted = extractMergeRequestReference(output, gitContext)
    if (!extracted) return null

    const db = admin.firestore()
    const reference = { ...extracted, sourceVmJobId: vmJob.correlationId }
    let stored = {
        ...reference,
        createdAt: Date.now(),
        status: null,
        statusUpdatedAt: null,
    }
    try {
        const tokenData = await loadProviderToken(db, vmJob.projectId, vmJob.objectId, reference, vmJob.requestUserId)
        stored = buildStoredReference(reference, await fetchProviderStatus(reference, tokenData))
    } catch (error) {
        console.warn('VM merge status: initial provider refresh failed', {
            correlationId: vmJob.correlationId,
            provider: reference.provider,
            error: error.message,
        })
    }

    await Promise.all([
        db.doc(`items/${vmJob.projectId}/tasks/${vmJob.objectId}`).set({ vmMergeRequest: stored }, { merge: true }),
        db.doc(`vmJobs/${vmJob.correlationId}`).set({ mergeRequest: stored }, { merge: true }),
    ])
    return stored
}

module.exports = {
    MERGE_STATUS,
    CACHE_TTL_MS,
    extractMergeRequestReference,
    normalizeGitlabMergeStatus,
    normalizeGithubMergeStatus,
    refreshTaskMergeStatus,
    associateVmMergeRequestWithTask,
    __private__: {
        buildStoredReference,
        getLatestGithubReviews,
    },
}
