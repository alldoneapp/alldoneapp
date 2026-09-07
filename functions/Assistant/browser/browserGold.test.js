'use strict'

const { FirestoreDouble } = require('./__browserFirestoreDouble')
const {
    BROWSER_GOLD_SOURCE,
    BROWSER_STEP_GOLD,
    buildIdempotencyKey,
    chargeGoldForBrowserStep,
    hasGoldForBrowserStep,
} = require('./browserGold')

function createDeductDouble({ fail = false, alreadyProcessed = false } = {}) {
    const calls = []
    const deduct = async (userId, amount, context) => {
        calls.push({ userId, amount, context })
        if (fail) return { success: false, message: 'Insufficient gold' }
        return { success: true, alreadyProcessed, amount, newBalance: 100 - amount }
    }
    return { deduct, calls }
}

describe('browser gold', () => {
    describe('the billed unit', () => {
        it('is one executed step at the mcp_tool_call price', () => {
            // Kept equal on purpose — the two are the same kind of thing from the user's side.
            expect(BROWSER_STEP_GOLD).toBe(1)
            expect(BROWSER_GOLD_SOURCE).toBe('browser_automation')
        })

        it('charges through the shared ledger with the linking context', async () => {
            const db = new FirestoreDouble()
            const { deduct, calls } = createDeductDouble()
            const result = await chargeGoldForBrowserStep({
                db,
                userId: 'user1',
                runId: 'brun_1',
                stepId: 'bstep_1',
                projectId: 'p1',
                objectId: 'task1',
                objectType: 'tasks',
                toolName: 'browser_navigate',
                hostname: 'tickets.example',
                deductGoldImpl: deduct,
            })

            expect(result.charged).toBe(true)
            expect(calls).toHaveLength(1)
            expect(calls[0].amount).toBe(BROWSER_STEP_GOLD)
            expect(calls[0].context).toMatchObject({
                source: 'browser_automation',
                channel: 'assistant',
                projectId: 'p1',
                objectId: 'task1',
                objectType: 'tasks',
                // Joins the ledger entry back to browserRuns; without it seven steps on one thread
                // are indistinguishable from seven unrelated charges.
                correlationId: 'brun_1',
            })
            expect(calls[0].context.note).toContain('browser_navigate')
        })
    })

    describe('idempotency', () => {
        it('keys the charge on the step id, which is minted once per tool call', () => {
            expect(buildIdempotencyKey('bstep_1')).toBe('browser_step:bstep_1')
        })

        it('passes that key to the ledger so a replay cannot charge twice', async () => {
            const { deduct, calls } = createDeductDouble()
            await chargeGoldForBrowserStep({
                db: new FirestoreDouble(),
                userId: 'user1',
                runId: 'brun_1',
                stepId: 'bstep_7',
                deductGoldImpl: deduct,
            })
            expect(calls[0].context.idempotencyKey).toBe('browser_step:bstep_7')
        })

        it('reports a replayed charge as not newly charged', async () => {
            const { deduct } = createDeductDouble({ alreadyProcessed: true })
            const result = await chargeGoldForBrowserStep({
                db: new FirestoreDouble(),
                userId: 'user1',
                runId: 'brun_1',
                stepId: 'bstep_1',
                deductGoldImpl: deduct,
            })
            expect(result.charged).toBe(false)
            expect(result.alreadyProcessed).toBe(true)
        })
    })

    describe('failure behaviour', () => {
        it('records the charge on the step so an audit does not need the ledger', async () => {
            const db = new FirestoreDouble()
            const { deduct } = createDeductDouble()
            await chargeGoldForBrowserStep({
                db,
                userId: 'user1',
                runId: 'brun_1',
                stepId: 'bstep_1',
                deductGoldImpl: deduct,
            })
            expect(db.documents.get('browserRuns/brun_1/steps/bstep_1')).toMatchObject({
                goldCharged: true,
                goldAmount: BROWSER_STEP_GOLD,
            })
        })

        it('never throws when the ledger refuses, and says so on the step', async () => {
            const db = new FirestoreDouble()
            const { deduct } = createDeductDouble({ fail: true })
            const result = await chargeGoldForBrowserStep({
                db,
                userId: 'user1',
                runId: 'brun_1',
                stepId: 'bstep_1',
                deductGoldImpl: deduct,
            })
            expect(result.charged).toBe(false)
            expect(db.documents.get('browserRuns/brun_1/steps/bstep_1')).toMatchObject({
                goldCharged: false,
                goldError: 'Insufficient gold',
            })
        })

        it('never throws when the ledger itself throws', async () => {
            const result = await chargeGoldForBrowserStep({
                db: new FirestoreDouble(),
                userId: 'user1',
                runId: 'brun_1',
                stepId: 'bstep_1',
                deductGoldImpl: async () => {
                    throw new Error('firestore unavailable')
                },
            })
            expect(result.charged).toBe(false)
            expect(result.error).toBe('firestore unavailable')
        })

        it('charges nothing without a user or a step', async () => {
            const { deduct, calls } = createDeductDouble()
            await chargeGoldForBrowserStep({ db: null, userId: '', stepId: 'x', deductGoldImpl: deduct })
            await chargeGoldForBrowserStep({ db: null, userId: 'u', stepId: '', deductGoldImpl: deduct })
            expect(calls).toHaveLength(0)
        })
    })

    describe('the pre-flight balance check', () => {
        it('refuses a step the user cannot pay for', async () => {
            const db = new FirestoreDouble({ 'users/user1': { gold: 0 } })
            expect((await hasGoldForBrowserStep(db, 'user1')).ok).toBe(false)
        })

        it('allows a step the user can pay for', async () => {
            const db = new FirestoreDouble({ 'users/user1': { gold: 12 } })
            const check = await hasGoldForBrowserStep(db, 'user1')
            expect(check.ok).toBe(true)
            expect(check.gold).toBe(12)
        })

        it('fails OPEN on an unreadable balance rather than taking browsing down', async () => {
            // The charge still uses requireSufficientBalance, so a genuinely empty balance cannot
            // go negative — this only decides whether the step is attempted.
            const broken = {
                doc: () => ({
                    get: async () => {
                        throw new Error('firestore unavailable')
                    },
                }),
            }
            expect((await hasGoldForBrowserStep(broken, 'user1')).ok).toBe(true)
            expect((await hasGoldForBrowserStep(new FirestoreDouble(), 'missing-user')).ok).toBe(true)
        })
    })
})
