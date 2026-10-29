import {
    SERVER_CATCH_UP_MS,
    VISIBLE_CONFIRMATION_MS,
    getAssistantReplies,
    getConfirmationDeadline,
    isConnectionLoss,
    replyConfirmsProcessing,
} from './annaSubmissionReconciliation'

const functionsError = (code, message) => Object.assign(new Error(message), { code, name: 'FirebaseError' })

describe('isConnectionLoss (AT-2921)', () => {
    it('recognises the callable SDK status-0 failure a backgrounded app produces', () => {
        expect(isConnectionLoss(functionsError('functions/internal', 'internal'))).toBe(true)
        expect(isConnectionLoss(functionsError('internal', 'internal'))).toBe(true)
    })

    it('recognises the client-side deadline and raw fetch failures', () => {
        expect(isConnectionLoss(functionsError('functions/deadline-exceeded', 'deadline-exceeded'))).toBe(true)
        expect(isConnectionLoss(new TypeError('Failed to fetch'))).toBe(true)
        expect(isConnectionLoss(new TypeError('Load failed'))).toBe(true)
    })

    it('keeps answers the server actually sent as real failures', () => {
        // An error body from the backend: upper-case status text or its own message.
        expect(isConnectionLoss(functionsError('functions/internal', 'INTERNAL'))).toBe(false)
        expect(isConnectionLoss(functionsError('functions/internal', 'Assistant crashed'))).toBe(false)
        expect(isConnectionLoss(functionsError('functions/resource-exhausted', 'Not enough Gold'))).toBe(false)
        expect(isConnectionLoss(functionsError('functions/permission-denied', 'internal'))).toBe(false)
        expect(isConnectionLoss(Object.assign(new Error('offline'), { code: 'offline' }))).toBe(false)
        expect(isConnectionLoss(new Error('internal'))).toBe(false)
        expect(isConnectionLoss(new TypeError('x is undefined'))).toBe(false)
        expect(isConnectionLoss(undefined)).toBe(false)
    })
})

describe('reply evidence', () => {
    it('maps chat runs by the message that triggered them and ignores other runs', () => {
        expect(
            getAssistantReplies([
                { id: 'q', creatorId: 'u1' },
                { id: 'a', assistantRun: { kind: 'chat', triggerMessageId: 'q', status: 'completed' } },
                { id: 'b', assistantRun: { kind: 'chat', triggerMessageId: 'r' } },
                { id: 'c', assistantRun: { kind: 'vm_job', triggerMessageId: 's', status: 'running' } },
                { id: 'd', assistantRun: { kind: 'chat', status: 'running' } },
            ])
        ).toEqual({ q: 'completed', r: 'running' })
        expect(getAssistantReplies(undefined)).toEqual({})
    })

    it('treats running, completed and stopped runs as processed, a failed run as not', () => {
        ;['running', 'completed', 'cancelled', 'cancel_requested'].forEach(status =>
            expect(replyConfirmsProcessing(status)).toBe(true)
        )
        expect(replyConfirmsProcessing('failed')).toBe(false)
        expect(replyConfirmsProcessing(undefined)).toBe(false)
    })
})

describe('getConfirmationDeadline', () => {
    it('waits for the server catch-up window after the message was saved', () => {
        expect(getConfirmationDeadline({ now: 1000, savedAt: 1000 })).toBe(1000 + SERVER_CATCH_UP_MS)
    })

    it('always gives a returning page a moment for the listener to deliver the reply', () => {
        const now = 10 * 60 * 1000
        expect(getConfirmationDeadline({ now, savedAt: 0 })).toBe(now + VISIBLE_CONFIRMATION_MS)
    })
})
