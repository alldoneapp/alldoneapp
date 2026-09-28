const {
    MAX_CONSECUTIVE_FAILED_TOOL_ROUNDS,
    isRecoverableToolError,
    buildFailedToolExecution,
    buildSkippedToolExecution,
    countConsecutiveFailedRounds,
    getRoundFailure,
} = require('./toolCallFailure')
const { AssistantRunCancelledError } = require('./assistantRunIdempotency')

const call = (name, args = '{}', id = `call-${name}`) => ({ id, function: { name, arguments: args } })

describe('isRecoverableToolError', () => {
    test('treats ordinary tool errors as the model’s to fix', () => {
        expect(isRecoverableToolError(new Error('update_task requires at least one task change or a comment'))).toBe(
            true
        )
        expect(isRecoverableToolError(new Error('Tool not permitted: delete_everything'))).toBe(true)
    })

    test('keeps cancellation and an exhausted time budget fatal', () => {
        expect(isRecoverableToolError(new AssistantRunCancelledError())).toBe(false)
        const outOfTime = new Error('This run reached its time limit before finishing.')
        outOfTime.code = 'ASSISTANT_TOOL_TIME_BUDGET'
        expect(isRecoverableToolError(outOfTime)).toBe(false)
        expect(isRecoverableToolError(null)).toBe(false)
    })
})

describe('failed and skipped executions', () => {
    test('carry the call id and the error as a result the model can read', () => {
        const error = new Error('update_task requires at least one task change or a comment')
        const execution = buildFailedToolExecution(call('update_task', '{"taskName":"Re-Design Juno"}'), error)

        expect(execution).toMatchObject({
            toolName: 'update_task',
            toolArgs: { taskName: 'Re-Design Juno' },
            toolCallId: 'call-update_task',
            failed: true,
            conversationSafeToolResult: {
                success: false,
                error: 'update_task requires at least one task change or a comment',
            },
        })
    })

    test('survive arguments that are not valid JSON', () => {
        expect(buildFailedToolExecution(call('update_note', '{oops'), new SyntaxError('bad')).toolArgs).toEqual({})
    })

    test('mark a skipped call as not executed', () => {
        expect(buildSkippedToolExecution(call('create_task'))).toMatchObject({
            toolCallId: 'call-create_task',
            skipped: true,
            conversationSafeToolResult: { success: false },
        })
    })
})

describe('countConsecutiveFailedRounds', () => {
    const failed = { failed: true, error: new Error('x') }
    const ok = { conversationSafeToolResult: { success: true } }

    test('counts only rounds in which every call failed, and resets on any success', () => {
        let count = 0
        count = countConsecutiveFailedRounds(count, [failed])
        count = countConsecutiveFailedRounds(count, [failed, { failed: true, skipped: true }])
        expect(count).toBe(2)
        expect(countConsecutiveFailedRounds(count, [failed, ok])).toBe(0)
        expect(MAX_CONSECUTIVE_FAILED_TOOL_ROUNDS).toBe(3)
    })

    test('reports the real error of a round, never a skipped call', () => {
        expect(getRoundFailure([failed, { failed: true, skipped: true }])).toBe(failed.error)
        expect(getRoundFailure([ok])).toBeNull()
    })
})
