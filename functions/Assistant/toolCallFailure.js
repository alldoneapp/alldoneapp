/**
 * What a chat run does when one of its tool calls throws.
 *
 * It used to end the run on the spot: the tool-status line in the comment was swapped for
 * `Error executing <tool>: <message>`, the loop broke, and the model never saw the error. So a
 * run that had already done all its work and then made one pointless call ended with that error
 * as its entire visible answer (note 8b4wQWfKyLXpZFtqYsNC, 2026-09-28: summary written, title
 * set, then `update_task({ taskName })` with nothing to change — and the reply the user got was
 * "Error executing update_task: update_task requires at least one task change or a comment").
 *
 * Most tool errors are the model's to fix — wrong arguments, a missing field, a record that
 * does not exist — so the error is now handed back as that call's result and the run goes on.
 * Two kinds stay fatal because retrying cannot help: a cancelled run and a run out of time. And
 * a model that keeps failing is stopped after a few rounds, which is also what lets an unattended
 * run's `failOnToolExecutionError` still fire when a tool is genuinely broken.
 */

const { isAssistantRunCancelledError } = require('./assistantRunIdempotency')

const MAX_CONSECUTIVE_FAILED_TOOL_ROUNDS = 3
const FATAL_TOOL_ERROR_CODES = new Set(['ASSISTANT_TOOL_TIME_BUDGET'])
const MAX_TOOL_ERROR_MESSAGE_CHARS = 1000

function isRecoverableToolError(error) {
    if (!error) return false
    if (isAssistantRunCancelledError(error)) return false
    if (FATAL_TOOL_ERROR_CODES.has(error.code)) return false
    return true
}

function parseToolArgsSafely(toolCall) {
    try {
        const parsed = JSON.parse(toolCall?.function?.arguments || '{}')
        return parsed && typeof parsed === 'object' ? parsed : {}
    } catch (_) {
        return {}
    }
}

function truncateMessage(message) {
    const text = String(message || 'Unknown error')
    return text.length > MAX_TOOL_ERROR_MESSAGE_CHARS ? `${text.slice(0, MAX_TOOL_ERROR_MESSAGE_CHARS)}…` : text
}

/** A tool execution record (the shape buildConversationAfterToolExecutions reads) for a failed call. */
function buildFailedToolExecution(toolCall, error) {
    const toolName = toolCall?.function?.name || error?.toolName || 'tool'
    return {
        toolName,
        toolArgs: parseToolArgsSafely(toolCall),
        toolCallId: toolCall?.id,
        conversationSafeToolResult: {
            success: false,
            error: truncateMessage(error?.message),
            ...(error?.code ? { errorCode: String(error.code) } : {}),
            note: 'This tool call failed. Fix the arguments and retry only if the call is still needed; otherwise continue without it.',
        },
        failed: true,
        error,
    }
}

/** The record for a call that was not run because an earlier call in the same batch failed. */
function buildSkippedToolExecution(toolCall) {
    return {
        toolName: toolCall?.function?.name || 'tool',
        toolArgs: parseToolArgsSafely(toolCall),
        toolCallId: toolCall?.id,
        conversationSafeToolResult: {
            success: false,
            error: 'Not executed because an earlier tool call in the same step failed.',
            note: 'Retry this call if it is still needed.',
        },
        failed: true,
        skipped: true,
    }
}

/**
 * Count rounds without executable progress. A pending confirmation is not a completed write:
 * treating draft creation as success used to reset the guard between every failed confirmation.
 * Structured failures matter too, even when the tool did not throw.
 */
function countConsecutiveFailedRounds(previousCount, toolExecutions) {
    const executions = Array.isArray(toolExecutions) ? toolExecutions.filter(Boolean) : []
    if (executions.length === 0) return previousCount
    return executions.every(execution => {
        const result = execution.conversationSafeToolResult
        return (
            execution.failed ||
            result?.success === false ||
            (result?.saved === false && result?.needsConfirmation === true)
        )
    })
        ? previousCount + 1
        : 0
}

/** The error that actually happened in a round (skipped calls carry none). */
function getRoundFailure(toolExecutions) {
    const executions = Array.isArray(toolExecutions) ? toolExecutions : []
    const failed = executions.filter(execution => execution?.failed && execution.error)
    if (failed.length) return failed[failed.length - 1].error
    const blocked = executions.findLast(
        execution =>
            execution.conversationSafeToolResult?.success === false ||
            execution.conversationSafeToolResult?.needsConfirmation === true
    )
    if (!blocked) return null
    const result = blocked.conversationSafeToolResult
    const error = new Error(
        result.error ||
            result.message ||
            (result.needsConfirmation === true
                ? 'The wiki draft is not saved. Show its exact text and wait for the user to confirm; do not retry in this turn.'
                : 'The tool did not complete after repeated attempts.')
    )
    error.toolName = blocked.toolName
    return error
}

module.exports = {
    MAX_CONSECUTIVE_FAILED_TOOL_ROUNDS,
    isRecoverableToolError,
    buildFailedToolExecution,
    buildSkippedToolExecution,
    countConsecutiveFailedRounds,
    getRoundFailure,
}
