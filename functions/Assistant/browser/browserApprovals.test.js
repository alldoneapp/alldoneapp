'use strict'

const { FirestoreDouble } = require('./__browserFirestoreDouble')
const {
    APPROVAL_STATUS,
    consumeApprovalGrant,
    findApprovalGrant,
    isSignatureDenied,
    listPendingBrowserApprovals,
    requestBrowserApproval,
    respondToBrowserApproval,
} = require('./browserApprovals')
const { runRef } = require('./browserAudit')

const NOW = 1_800_000_000_000
const SIGNATURE = 'sig-book-tickets'

function seedRun(db, overrides = {}) {
    db.documents.set('browserRuns/run1', {
        runId: 'run1',
        projectId: 'p1',
        requestUserId: 'user1',
        status: 'active',
        startedAt: NOW,
        lastActivityAt: NOW,
        ...overrides,
    })
    return db.documents.get('browserRuns/run1')
}

async function raiseRequest(db, overrides = {}) {
    const run = db.documents.get('browserRuns/run1')
    return requestBrowserApproval(db, runRef(db, 'run1'), run, {
        runId: 'run1',
        stepId: 'step1',
        projectId: 'p1',
        objectId: 'task1',
        assistantId: 'assistant1',
        requestUserId: 'user1',
        toolName: 'browser_click',
        action: 'click',
        category: 'booking',
        categories: ['booking'],
        signature: SIGNATURE,
        hostname: 'tickets.example',
        message: 'This would make a booking on tickets.example.',
        evidence: ['label matched booking'],
        target: { role: 'button', name: 'Jetzt buchen', password: 'must-not-be-stored' },
        allowRunScope: true,
        now: NOW,
        ...overrides,
    })
}

describe('browser approvals', () => {
    describe('raising a request', () => {
        it('records what the user is actually approving, redacted', async () => {
            const db = new FirestoreDouble()
            seedRun(db)
            const { approvalId } = await raiseRequest(db)
            const record = db.documents.get(`browserApprovals/${approvalId}`)

            expect(record.status).toBe(APPROVAL_STATUS.PENDING)
            expect(record.category).toBe('booking')
            expect(record.target.name).toBe('Jetzt buchen')
            expect(record.target.password).not.toBe('must-not-be-stored')
            expect(record.requestUserId).toBe('user1')
        })

        it('re-uses the pending request instead of raising a new one per retry', async () => {
            const db = new FirestoreDouble()
            seedRun(db)
            const first = await raiseRequest(db)
            const second = await raiseRequest(db)
            expect(second.approvalId).toBe(first.approvalId)
            expect(second.reused).toBe(true)
            expect(db.listCollection('browserApprovals')).toHaveLength(1)
        })
    })

    describe('answering', () => {
        it('turns an approval into a grant that the exact signature can spend once', async () => {
            const db = new FirestoreDouble()
            seedRun(db)
            const { approvalId } = await raiseRequest(db)

            const response = await respondToBrowserApproval(db, {
                approvalId,
                userId: 'user1',
                action: 'approve',
                now: NOW,
            })
            expect(response.status).toBe(APPROVAL_STATUS.APPROVED)

            const run = db.documents.get('browserRuns/run1')
            expect(findApprovalGrant(run, SIGNATURE, NOW)).toBeTruthy()
            expect(findApprovalGrant(run, 'another-signature', NOW)).toBeNull()

            const { grants } = consumeApprovalGrant(run, SIGNATURE, NOW)
            expect(findApprovalGrant({ approvalGrants: grants }, SIGNATURE, NOW)).toBeNull()
        })

        it('keeps a "for this run" grant usable more than once', async () => {
            const db = new FirestoreDouble()
            seedRun(db)
            const { approvalId } = await raiseRequest(db)
            await respondToBrowserApproval(db, {
                approvalId,
                userId: 'user1',
                action: 'approve',
                scope: 'run',
                now: NOW,
            })

            const run = db.documents.get('browserRuns/run1')
            const { grants } = consumeApprovalGrant(run, SIGNATURE, NOW)
            expect(findApprovalGrant({ approvalGrants: grants }, SIGNATURE, NOW)).toBeTruthy()
        })

        it('refuses a run-scoped answer for a category the policy never allows it for', async () => {
            // The UI hides the button; this is the half that matters, because a client can ask for
            // whatever it likes. A payment approval always means "this one payment".
            const db = new FirestoreDouble()
            seedRun(db)
            const { approvalId } = await raiseRequest(db, {
                category: 'payment',
                categories: ['payment'],
                allowRunScope: false,
            })
            const response = await respondToBrowserApproval(db, {
                approvalId,
                userId: 'user1',
                action: 'approve',
                scope: 'run',
                now: NOW,
            })
            expect(response.scope).toBe('once')
            expect(response.scopeDowngraded).toBe(true)

            const run = db.documents.get('browserRuns/run1')
            const { grants } = consumeApprovalGrant(run, SIGNATURE, NOW)
            expect(findApprovalGrant({ approvalGrants: grants }, SIGNATURE, NOW)).toBeNull()
        })

        it('expires a grant even inside a run that is still open', async () => {
            const db = new FirestoreDouble()
            seedRun(db)
            const { approvalId } = await raiseRequest(db)
            await respondToBrowserApproval(db, {
                approvalId,
                userId: 'user1',
                action: 'approve',
                scope: 'run',
                now: NOW,
            })
            const run = db.documents.get('browserRuns/run1')
            expect(findApprovalGrant(run, SIGNATURE, NOW + 60 * 60 * 1000)).toBeNull()
        })

        it('makes a denial stick for the rest of the run', async () => {
            const db = new FirestoreDouble()
            seedRun(db)
            const { approvalId } = await raiseRequest(db)
            await respondToBrowserApproval(db, { approvalId, userId: 'user1', action: 'deny', now: NOW })

            const run = db.documents.get('browserRuns/run1')
            expect(isSignatureDenied(run, SIGNATURE)).toBe(true)
            expect(findApprovalGrant(run, SIGNATURE, NOW)).toBeNull()
        })

        it('refuses an answer from anybody other than the person who asked', async () => {
            const db = new FirestoreDouble()
            seedRun(db)
            const { approvalId } = await raiseRequest(db)
            await expect(
                respondToBrowserApproval(db, { approvalId, userId: 'colleague', action: 'approve', now: NOW })
            ).rejects.toThrow(/only the person who started this browsing run/i)
            expect(db.documents.get('browserRuns/run1').approvalGrants).toBeUndefined()
        })

        it('refuses an answer that arrives after the request expired', async () => {
            const db = new FirestoreDouble()
            seedRun(db)
            const { approvalId } = await raiseRequest(db)
            const late = await respondToBrowserApproval(db, {
                approvalId,
                userId: 'user1',
                action: 'approve',
                now: NOW + 60 * 60 * 1000,
            })
            expect(late.status).toBe(APPROVAL_STATUS.EXPIRED)
            expect(db.documents.get('browserRuns/run1').approvalGrants).toBeUndefined()
        })

        it('does not answer the same request twice', async () => {
            const db = new FirestoreDouble()
            seedRun(db)
            const { approvalId } = await raiseRequest(db)
            await respondToBrowserApproval(db, { approvalId, userId: 'user1', action: 'deny', now: NOW })
            const second = await respondToBrowserApproval(db, {
                approvalId,
                userId: 'user1',
                action: 'approve',
                now: NOW,
            })
            expect(second.alreadyAnswered).toBe(true)
            expect(db.documents.get('browserRuns/run1').approvalGrants).toBeUndefined()
        })

        it('rejects an unsupported action rather than treating it as an approval', async () => {
            const db = new FirestoreDouble()
            seedRun(db)
            const { approvalId } = await raiseRequest(db)
            await expect(
                respondToBrowserApproval(db, { approvalId, userId: 'user1', action: 'approve_everything', now: NOW })
            ).rejects.toThrow(/unsupported approval action/i)
        })
    })

    describe('listing', () => {
        it('returns only this user’s live requests', async () => {
            const db = new FirestoreDouble()
            seedRun(db)
            const mine = await raiseRequest(db)
            db.documents.set('browserApprovals/other', {
                approvalId: 'other',
                requestUserId: 'someone-else',
                status: APPROVAL_STATUS.PENDING,
                projectId: 'p1',
                expiresAt: NOW + 1000,
            })

            const pending = await listPendingBrowserApprovals(db, { userId: 'user1', now: NOW })
            expect(pending.map(entry => entry.approvalId)).toEqual([mine.approvalId])
        })
    })
})
