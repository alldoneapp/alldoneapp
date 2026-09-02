'use strict'

const { buildVmGoldBillingDimensions } = require('./vmGoldDimensions')

describe('vmGoldDimensions.buildVmGoldBillingDimensions', () => {
    test('reads the three fields a pendingWebhooks / vmJobs document carries', () => {
        expect(
            buildVmGoldBillingDimensions({
                agentModel: 'gpt-5.6-sol',
                tokenBillingExempt: false,
                correlationId: 'run-1',
                // Everything else on the doc is irrelevant to billing and must not leak into
                // the ledger context, which has its own allowlist.
                objective: 'do the thing',
                userId: 'u1',
            })
        ).toEqual({ model: 'gpt-5.6-sol', billingExempt: false, correlationId: 'run-1' })
    })

    test('marks a subscription / BYOK run exempt', () => {
        expect(
            buildVmGoldBillingDimensions({ agentModel: 'opus', tokenBillingExempt: true, correlationId: 'run-2' })
        ).toEqual({ model: 'opus', billingExempt: true, correlationId: 'run-2' })
    })

    // A job document written before AT-2487 has no tokenBillingExempt. Reporting `false` there
    // would claim Alldone paid for those tokens, which is precisely the fact we cannot know.
    test('leaves an absent tokenBillingExempt undeclared rather than guessing billed', () => {
        expect(buildVmGoldBillingDimensions({ agentModel: 'opus' })).toEqual({ model: 'opus' })
        expect(buildVmGoldBillingDimensions({ agentModel: 'opus', tokenBillingExempt: 'true' })).toEqual({
            model: 'opus',
        })
    })

    test('survives the empty, partial and non-object cases every refund path can hand it', () => {
        expect(buildVmGoldBillingDimensions()).toEqual({})
        expect(buildVmGoldBillingDimensions(null)).toEqual({})
        expect(buildVmGoldBillingDimensions('nope')).toEqual({})
        expect(buildVmGoldBillingDimensions({ agentModel: '   ', correlationId: '  ' })).toEqual({})
    })

    // How the runner and proxy call it: the pending doc is the fresher of the two, because the
    // runner re-asserts credentialMode/tokenBillingExempt onto it once the route is resolved.
    test('a spread of vmJob then pendingWebhook keeps the pending doc winning', () => {
        const vmJob = { agentModel: 'opus', tokenBillingExempt: false, correlationId: 'run-3' }
        const pendingWebhook = { correlationId: 'run-3', tokenBillingExempt: true }
        expect(buildVmGoldBillingDimensions({ ...vmJob, ...pendingWebhook })).toEqual({
            model: 'opus',
            billingExempt: true,
            correlationId: 'run-3',
        })
    })
})
