import {
    ASSISTANT_LOADING_TIMEOUT_MS,
    getAssistantRunLastActivityTime,
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

    test('keeps a running reply live while its run records new activity, even with an old comment time', () => {
        const message = {
            isLoading: true,
            commentText: '',
            assistantRun: {
                kind: 'chat',
                status: 'running',
                activity: { phase: 'tool', startedAt: now - 15_000 },
                activityHistory: [
                    { phase: 'thinking', startedAt: now - 34 * 60 * 1000 },
                    { phase: 'composing', startedAt: now - 20_000 },
                ],
            },
        }
        expect(getAssistantRunLastActivityTime(message.assistantRun)).toBe(now - 15_000)
        expect(resolveEffectiveMessageLoading(message, now - 29 * 60 * 1000, now)).toBe(true)
    })

    test('still expires a run whose last activity is older than the timeout', () => {
        const assistantRun = {
            kind: 'chat',
            status: 'running',
            activity: { phase: 'tool', startedAt: now - ASSISTANT_LOADING_TIMEOUT_MS - 1 },
        }
        expect(resolveEffectiveMessageLoading({ isLoading: true, assistantRun }, now - 30 * 60 * 1000, now)).toBe(false)
    })

    test('ignores the activity of a settled run', () => {
        expect(
            getAssistantRunLastActivityTime({ status: 'completed', activity: { phase: 'composing', startedAt: now } })
        ).toBe(0)
    })
})
