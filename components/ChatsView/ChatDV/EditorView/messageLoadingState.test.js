import {
    ASSISTANT_LOADING_TIMEOUT_MS,
    isAwaitingVmInteraction,
    resolveEffectiveMessageLoading,
} from './messageLoadingState'

describe('assistant message loading state', () => {
    const now = 1_000_000

    test('expires a stale running assistant spinner', () => {
        expect(
            resolveEffectiveMessageLoading(
                { isLoading: true, assistantRun: { kind: 'vm_job', status: 'running' } },
                now - ASSISTANT_LOADING_TIMEOUT_MS - 1,
                now
            )
        ).toBe(false)
    })

    test.each(['plan_review', 'clarification', 'tool_approval'])(
        'keeps an awaiting %s interaction visible beyond the stale-spinner timeout',
        kind => {
            const assistantRun = {
                kind: 'vm_job',
                status: 'awaiting_user',
                interaction: { kind, requestId: 'request-1' },
            }

            expect(isAwaitingVmInteraction(assistantRun)).toBe(true)
            expect(
                resolveEffectiveMessageLoading(
                    { isLoading: true, assistantRun },
                    now - ASSISTANT_LOADING_TIMEOUT_MS - 1,
                    now
                )
            ).toBe(true)
        }
    )

    test('does not invent a loading state for a settled comment', () => {
        expect(
            resolveEffectiveMessageLoading(
                { isLoading: false, assistantRun: { kind: 'vm_job', status: 'awaiting_user' } },
                now,
                now
            )
        ).toBe(false)
    })
})
