'use strict'

// Approvals: how a sensitive browser action stops being refused.
//
// The shape follows the VM's run-scoped tool approvals (`vmInteraction.js` + the `approvalAllowlist`
// on the job document), because it is the same question asked in the same place — "the agent wants
// to do something with a consequence; may it?" — and a second, differently-shaped answer to it is
// how a user learns that approving in one surface does not mean what it means in the other.
//
// Four properties are load-bearing:
//
// 1. A grant answers ONE question. It is keyed on the policy signature — (action, category, host,
//    element shape) — so "yes, book that table" cannot be replayed as "yes, delete the account".
// 2. Only the person who asked can approve. The approval is written by a Cloud Function against the
//    authenticated caller, and a request raised for user A is not answerable by user B.
// 3. A denial sticks for the run. Without that the model re-asks in a loop, and a user who declined
//    a purchase gets the same dialog until they click the wrong button.
// 4. Grants live on the RUN, not in a global collection, and never outlive it. There is no such
//    thing here as a standing permission to buy things on a host.

const crypto = require('crypto')

const { APPROVAL_SCOPES } = require('./browserToolContract')
const { redactObjectForAudit } = require('./browserRedaction')

const APPROVALS_COLLECTION = 'browserApprovals'
const DEFAULT_GRANT_TTL_MS = 15 * 60 * 1000
const MAX_GRANTS_PER_RUN = 20
const MAX_DENIED_SIGNATURES_PER_RUN = 40
const APPROVAL_REQUEST_TTL_MS = 30 * 60 * 1000

const APPROVAL_STATUS = {
    PENDING: 'pending',
    APPROVED: 'approved',
    DENIED: 'denied',
    EXPIRED: 'expired',
}

function newApprovalId() {
    return `bapr_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`
}

function approvalRef(db, approvalId) {
    return db.doc(`${APPROVALS_COLLECTION}/${approvalId}`)
}

function normalizeScope(scope) {
    return APPROVAL_SCOPES.includes(scope) ? scope : 'once'
}

/**
 * Find a usable grant for this exact signature. Pure, so the caller can run it inside the same
 * transaction that will consume it.
 */
function findApprovalGrant(run, signature, now = Date.now()) {
    const grants = Array.isArray(run?.approvalGrants) ? run.approvalGrants : []
    return (
        grants.find(grant => {
            if (!grant || grant.signature !== signature) return false
            if (Number(grant.expiresAt) && Number(grant.expiresAt) <= now) return false
            if (grant.scope === 'run') return true
            return Number(grant.usesLeft) > 0
        }) || null
    )
}

function isSignatureDenied(run, signature) {
    const denied = Array.isArray(run?.deniedSignatures) ? run.deniedSignatures : []
    return denied.includes(signature)
}

/** Spend one use of a `once` grant. Returns the grant list as it should be written back. */
function consumeApprovalGrant(run, signature, now = Date.now()) {
    const grants = Array.isArray(run?.approvalGrants) ? run.approvalGrants : []
    const grant = findApprovalGrant(run, signature, now)
    if (!grant) return { grant: null, grants }
    if (grant.scope === 'run') return { grant, grants }
    const nextGrants = grants
        .map(entry => (entry === grant ? { ...entry, usesLeft: Math.max(0, Number(entry.usesLeft) - 1) } : entry))
        .filter(entry => entry.scope === 'run' || Number(entry.usesLeft) > 0)
    return { grant, grants: nextGrants }
}

function buildApprovalRecord({
    approvalId,
    runId,
    stepId,
    projectId,
    objectId,
    objectType,
    assistantId,
    requestUserId,
    action,
    toolName,
    category,
    categories,
    signature,
    hostname,
    pageUrl,
    message,
    evidence,
    target,
    now,
}) {
    return {
        approvalId,
        runId,
        stepId: stepId || null,
        projectId: projectId || null,
        objectId: objectId || null,
        objectType: objectType || 'tasks',
        assistantId: assistantId || null,
        // Only this user may answer. A browsing run is raised by one person in one thread.
        requestUserId: requestUserId || null,
        toolName: toolName || null,
        action: action || null,
        category: category || null,
        categories: Array.isArray(categories) ? categories : [],
        signature: signature || '',
        hostname: hostname || null,
        pageUrl: pageUrl || null,
        message: message || '',
        evidence: Array.isArray(evidence) ? evidence.slice(0, 8) : [],
        // The element as OBSERVED, redacted — this is what the user is really approving, and it must
        // be readable without opening the page.
        target: target ? redactObjectForAudit(target) : null,
        status: APPROVAL_STATUS.PENDING,
        createdAt: now,
        expiresAt: now + APPROVAL_REQUEST_TTL_MS,
        respondedAt: null,
        respondedBy: null,
        scope: null,
    }
}

/**
 * Raise (or re-use) the approval request for a signature. Re-using is what stops a retry loop from
 * creating a new dialog per attempt; the pointer lives on the run document, which the caller has
 * already read.
 */
async function requestBrowserApproval(db, runRefForRun, run, request) {
    const now = Number(request.now) || Date.now()
    const signature = request.signature || ''
    const pending = run && run.pendingApprovals && typeof run.pendingApprovals === 'object' ? run.pendingApprovals : {}
    const existingId = pending[signature]

    if (existingId) {
        try {
            const existing = await approvalRef(db, existingId).get()
            const data = existing.exists ? existing.data() : null
            if (data && data.status === APPROVAL_STATUS.PENDING && Number(data.expiresAt) > now) {
                return { approvalId: existingId, record: data, reused: true }
            }
        } catch (error) {
            console.warn('🌐 BROWSER APPROVAL: could not read the pending request', {
                approvalId: existingId,
                error: error.message,
            })
        }
    }

    const approvalId = newApprovalId()
    const record = buildApprovalRecord({ ...request, approvalId, signature, now })
    await approvalRef(db, approvalId).set(record)
    await runRefForRun.set(
        { pendingApprovals: { ...pending, [signature]: approvalId }, lastActivityAt: now },
        { merge: true }
    )
    return { approvalId, record, reused: false }
}

/**
 * Answer a request. Runs in a transaction over BOTH documents because the grant it writes onto the
 * run is the thing the next tool call reads — a grant written outside the transaction that flips the
 * request to `approved` can be seen by a step that then also sees the request as still pending.
 */
async function respondToBrowserApproval(db, { approvalId, userId, action, scope = 'once', now = Date.now() }) {
    if (!approvalId) throw new Error('approvalId is required')
    if (!['approve', 'deny'].includes(action)) throw new Error('Unsupported approval action')

    return db.runTransaction(async transaction => {
        const requestRef = approvalRef(db, approvalId)
        const snapshot = await transaction.get(requestRef)
        if (!snapshot.exists) throw new Error('This approval request no longer exists.')
        const record = snapshot.data()

        if (record.requestUserId && userId && record.requestUserId !== userId) {
            throw new Error('Only the person who started this browsing run can answer its approval request.')
        }
        if (record.status !== APPROVAL_STATUS.PENDING) {
            return { alreadyAnswered: true, status: record.status, approvalId }
        }
        if (Number(record.expiresAt) && Number(record.expiresAt) <= now) {
            transaction.set(requestRef, { status: APPROVAL_STATUS.EXPIRED, respondedAt: now }, { merge: true })
            return { expired: true, status: APPROVAL_STATUS.EXPIRED, approvalId }
        }

        const runDocRef = db.doc(`browserRuns/${record.runId}`)
        const runSnapshot = await transaction.get(runDocRef)
        const run = runSnapshot.exists ? runSnapshot.data() : null
        if (!run) throw new Error('The browsing run for this approval no longer exists.')

        const pending =
            run.pendingApprovals && typeof run.pendingApprovals === 'object' ? { ...run.pendingApprovals } : {}
        delete pending[record.signature]

        if (action === 'deny') {
            const denied = Array.isArray(run.deniedSignatures) ? run.deniedSignatures : []
            const nextDenied = denied.includes(record.signature)
                ? denied
                : [...denied, record.signature].slice(-MAX_DENIED_SIGNATURES_PER_RUN)
            transaction.set(
                requestRef,
                { status: APPROVAL_STATUS.DENIED, respondedAt: now, respondedBy: userId || null, scope: null },
                { merge: true }
            )
            transaction.set(
                runDocRef,
                { pendingApprovals: pending, deniedSignatures: nextDenied, lastActivityAt: now },
                { merge: true }
            )
            return { status: APPROVAL_STATUS.DENIED, approvalId }
        }

        const effectiveScope = normalizeScope(scope)
        const grants = Array.isArray(run.approvalGrants) ? run.approvalGrants : []
        const grant = {
            signature: record.signature,
            category: record.category || null,
            action: record.action || null,
            hostname: record.hostname || null,
            approvalId,
            scope: effectiveScope,
            grantedBy: userId || null,
            grantedAt: now,
            // Never outlives the run, and a "for this run" grant is still time-bounded: a run may
            // stay open for minutes, and an approval given at the start of it should not still be
            // live at the end.
            expiresAt: now + DEFAULT_GRANT_TTL_MS,
            usesLeft: effectiveScope === 'run' ? null : 1,
        }
        const nextGrants = [...grants.filter(entry => entry && entry.signature !== record.signature), grant].slice(
            -MAX_GRANTS_PER_RUN
        )

        transaction.set(
            requestRef,
            {
                status: APPROVAL_STATUS.APPROVED,
                respondedAt: now,
                respondedBy: userId || null,
                scope: effectiveScope,
            },
            { merge: true }
        )
        transaction.set(
            runDocRef,
            { pendingApprovals: pending, approvalGrants: nextGrants, lastActivityAt: now },
            { merge: true }
        )
        return { status: APPROVAL_STATUS.APPROVED, approvalId, scope: effectiveScope }
    })
}

/** The pending requests a user still has to answer, newest first. */
async function listPendingBrowserApprovals(db, { userId, projectId = null, limit = 20, now = Date.now() }) {
    if (!db || !userId) return []
    let query = db
        .collection(APPROVALS_COLLECTION)
        .where('requestUserId', '==', userId)
        .where('status', '==', APPROVAL_STATUS.PENDING)
    if (projectId) query = query.where('projectId', '==', projectId)
    const snapshot = await query.limit(Math.min(Math.max(Number(limit) || 20, 1), 50)).get()
    const records = []
    snapshot.forEach(doc => {
        const record = doc.data()
        if (Number(record.expiresAt) && Number(record.expiresAt) <= now) return
        records.push(record)
    })
    return records.sort((first, second) => Number(second.createdAt || 0) - Number(first.createdAt || 0))
}

module.exports = {
    APPROVALS_COLLECTION,
    APPROVAL_REQUEST_TTL_MS,
    APPROVAL_STATUS,
    DEFAULT_GRANT_TTL_MS,
    MAX_DENIED_SIGNATURES_PER_RUN,
    MAX_GRANTS_PER_RUN,
    approvalRef,
    buildApprovalRecord,
    consumeApprovalGrant,
    findApprovalGrant,
    isSignatureDenied,
    listPendingBrowserApprovals,
    normalizeScope,
    requestBrowserApproval,
    respondToBrowserApproval,
}
