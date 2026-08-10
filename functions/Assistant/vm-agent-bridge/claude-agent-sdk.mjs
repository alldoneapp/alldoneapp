import fs from 'node:fs'
import { query } from '@anthropic-ai/claude-agent-sdk'
import approvalPolicy from './approval-policy.cjs'

const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`)
let sessionId = input.providerState?.sessionId || null
let interaction = null
let output = ''
let assistantText = ''
let usage = null
let approvedToolConsumed = false

const options = {
    cwd: input.cwd,
    additionalDirectories: Array.isArray(input.additionalDirectories) ? input.additionalDirectories : [],
    model: input.model || undefined,
    effort: input.effort || undefined,
    permissionMode: input.permissionMode,
    allowDangerouslySkipPermissions: input.permissionMode === 'bypassPermissions',
    settingSources: Array.isArray(input.settingSources) ? input.settingSources : ['user', 'project', 'local'],
    ...(sessionId ? { resume: sessionId } : {}),
    canUseTool: async (toolName, toolInput) => {
        if (toolName === 'ExitPlanMode') {
            interaction = {
                kind: 'plan_review',
                providerRequestId: '',
                payload: { plan: toolInput?.plan || output || assistantText || '' },
            }
            return {
                behavior: 'deny',
                message: 'The host application will show this plan to the user and resume after their decision.',
            }
        }
        if (toolName === 'AskUserQuestion') {
            interaction = {
                kind: 'clarification',
                providerRequestId: '',
                payload: { questions: toolInput?.questions || [] },
            }
            return {
                behavior: 'deny',
                message: 'The host application will collect the answer and resume this session in a new turn.',
            }
        }

        if (
            input.approvedTool?.toolName === toolName &&
            !approvedToolConsumed &&
            input.approvedTool?.action === 'approve'
        ) {
            approvedToolConsumed = true
            return { behavior: 'allow', updatedInput: toolInput }
        }

        const review = approvalPolicy.assessClaudeToolApproval(toolName, toolInput, input.cwd)
        if (review.autoApprove) {
            return { behavior: 'allow', updatedInput: toolInput }
        }

        interaction = {
            kind: 'tool_approval',
            providerRequestId: '',
            payload: {
                toolName,
                reason: `Auto-review escalated this operation because it involves ${review.reason}.${
                    toolInput?.description || toolInput?.reason ? ` ${toolInput.description || toolInput.reason}` : ''
                }`,
                command: toolInput?.command || '',
                cwd: toolInput?.cwd || input.cwd,
            },
        }
        return {
            behavior: 'deny',
            message: 'The host application will ask the user and resume this session in a new turn.',
        }
    },
}

try {
    for await (const message of query({ prompt: input.prompt, options })) {
        emit(message)
        if (message?.session_id) sessionId = message.session_id
        if (message?.type === 'assistant' && Array.isArray(message?.message?.content)) {
            assistantText += message.message.content
                .filter(block => block?.type === 'text' && block.text)
                .map(block => block.text)
                .join('\n')
        }
        if (message?.type === 'result') {
            if (typeof message.result === 'string') output = message.result
            if (message.usage) {
                const cache =
                    (message.usage.cache_creation_input_tokens || 0) + (message.usage.cache_read_input_tokens || 0)
                const inputTokens = message.usage.input_tokens || 0
                const outputTokens = message.usage.output_tokens || 0
                usage = {
                    inputTokens,
                    outputTokens,
                    cacheTokens: cache,
                    totalTokens: inputTokens + outputTokens + cache,
                    costUsd: typeof message.total_cost_usd === 'number' ? message.total_cost_usd : null,
                }
            }
        }
    }

    const providerState = { sessionId }
    if (interaction) {
        emit({ type: 'alldone.interaction', interaction: { ...interaction, providerState } })
    } else if (input.phase === 'planning') {
        emit({
            type: 'alldone.interaction',
            interaction: {
                kind: 'plan_review',
                providerRequestId: '',
                payload: { plan: output || assistantText },
                providerState,
            },
        })
    } else {
        emit({ type: 'alldone.completed', output, usage, providerState })
    }
} catch (error) {
    emit({ type: 'alldone.bridge_error', message: error?.message || String(error), providerState: { sessionId } })
    process.exitCode = 1
}
