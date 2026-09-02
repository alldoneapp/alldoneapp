'use strict'

jest.mock('firebase-admin', () => ({ firestore: jest.fn() }))
jest.mock('firebase-admin/firestore', () => ({
    FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
}))

const { sanitizeContext, GOLD_CONTEXT_FIELDS, GOLD_CONTEXT_BOOLEAN_FIELDS } = require('./goldTransactions')

describe('goldTransactions.sanitizeContext', () => {
    test('keeps the existing trimmed string link fields', () => {
        expect(
            sanitizeContext({ projectId: ' p1 ', objectId: 'o1', objectType: 'tasks', channel: 'assistant' })
        ).toEqual({ projectId: 'p1', objectId: 'o1', objectType: 'tasks', channel: 'assistant' })
    })

    test('drops unknown keys and empty strings, as before', () => {
        expect(sanitizeContext({ projectId: '   ', secret: 'nope', amount: 5 })).toEqual({})
    })

    // AT-2487: the ledger is the only place the exact model string survives, because the
    // rollup slugs it into a field-name-safe key.
    test('records the model and the VM run id verbatim', () => {
        expect(sanitizeContext({ model: ' openrouter:deepseek/deepseek-chat ', correlationId: ' abc-123 ' })).toEqual({
            model: 'openrouter:deepseek/deepseek-chat',
            correlationId: 'abc-123',
        })
    })

    test('records billingExempt in both directions', () => {
        expect(sanitizeContext({ billingExempt: true })).toEqual({ billingExempt: true })
        expect(sanitizeContext({ billingExempt: false })).toEqual({ billingExempt: false })
    })

    // The tristate is the point. A charge site with no concept of billing exemption passes
    // nothing, and writing `false` there would assert something the caller never claimed —
    // turning "not applicable" into "Alldone paid for the tokens" across every non-VM source.
    test('leaves billingExempt ABSENT for anything that is not a real boolean', () => {
        expect(sanitizeContext({})).toEqual({})
        expect(sanitizeContext({ billingExempt: undefined })).toEqual({})
        expect(sanitizeContext({ billingExempt: null })).toEqual({})
        expect(sanitizeContext({ billingExempt: 'true' })).toEqual({})
        expect(sanitizeContext({ billingExempt: 0 })).toEqual({})
    })

    test('the two field lists stay disjoint so a boolean cannot be dropped by the string pass', () => {
        GOLD_CONTEXT_BOOLEAN_FIELDS.forEach(field => expect(GOLD_CONTEXT_FIELDS).not.toContain(field))
    })
})
