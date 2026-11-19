import fs from 'node:fs'
import path from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import approvalPolicy from './approval-policy.cjs'

const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))

// Resolve the checked-out branch so the policy can tell `git push origin HEAD` on a feature
// branch (the flow the platform prompt mandates) apart from the same command run while sitting
// on the base branch. Read fresh on every approval: the agent creates its branch mid-run.
// GIT_DIR is relocated for the Codex sandbox, so honour it when present.
function resolveCurrentBranch() {
    try {
        const gitDir = process.env.GIT_DIR || path.join(input.cwd || '/home/user/repo', '.git')
        const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim()
        const match = head.match(/^ref:\s*refs\/heads\/(.+)$/)
        return match ? match[1].trim() : ''
    } catch (error) {
        return ''
    }
}
const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`)
let sessionId = input.providerState?.sessionId || null
let interaction = null
let output = ''
let assistantText = ''
let usage = null
let approvedToolConsumed = false
// "Allow for this run" grants, carried across turns by the host on the pendingWebhooks doc.
const sessionAllowlist = Array.isArray(input.approvalAllowlist) ? [...input.approvalAllowlist] : []

const options = {
    cwd: input.cwd,
    additionalDirectories: Array.isArray(input.additionalDirectories) ? input.additionalDirectories : [],
    model: input.model || undefined,
    effort: input.effort || undefined,
    permissionMode: input.permissionMode,
    allowDangerouslySkipPermissions: input.permissionMode === 'bypassPermissions',
    settingSources: Array.isArray(input.settingSources) ? input.settingSources : ['user', 'project', 'local'],
    // Tools that schedule later work keep the session (and so the run) open after the final answer.
    ...(Array.isArray(input.disallowedTools) && input.disallowedTools.length
        ? { disallowedTools: input.disallowedTools }
        : {}),
    ...(sessionId ? { resume: sessionId } : {}),
    // The project's assistant tools (vmMcpProxy); the runner sets this only when there are any.
    ...(input.mcpServers && typeof input.mcpServers === 'object' && Object.keys(input.mcpServers).length
        ? { mcpServers: input.mcpServers }
        : {}),
}
// Under bypassPermissions the SDK approves every tool before consulting canUseTool and warns
// on stderr when one is passed anyway (CLAUDE_SDK_CAN_USE_TOOL_SHADOWED), so only gated modes
// get the callback.
if (input.permissionMode !== 'bypassPermissions') {
    options.canUseTool = async (toolName, toolInput) => {
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
            (input.approvedTool?.action === 'approve' || input.approvedTool?.action === 'approve_for_run')
        ) {
            approvedToolConsumed = true
            return { behavior: 'allow', updatedInput: toolInput }
        }

        const review = approvalPolicy.assessClaudeToolApproval(toolName, toolInput, {
            cwd: input.cwd,
            level: input.approvalPolicy,
            baseBranch: input.baseBranch || '',
            currentBranch: resolveCurrentBranch(),
            sessionAllowlist: sessionAllowlist,
            // Directories the runner deliberately mounted as writable (the relocated Git metadata,
            // for example). Without them the policy reads a normal part of the flow as a write
            // "outside the working directory".
            writableRoots: Array.isArray(input.additionalDirectories) ? input.additionalDirectories : [],
        })
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
                // Empty for operations that must always pause, which suppresses the host's
                // "Allow for this run" button.
                signature: review.signature || '',
            },
        }
        return {
            behavior: 'deny',
            message: 'The host application will ask the user and resume this session in a new turn.',
        }
    }
}

// The answers to canUseTool travel to the CLI over its stdin, so in a gated run stdin has to stay
// open until the agent is done (AT-3093). Given a plain string prompt, the SDK treats the run as
// one turn and closes stdin at the first result. A background command that ends later starts
// another turn in the same process, and every permission check in that turn then fails with
// "Tool permission request failed: AbortError: Stream closed": the interactive run on AT-3093
// finished its change and failed to push it five times. So a gated run sends its prompt as a
// stream that this bridge closes itself, once the last turn has ended and no background task is
// left. Ungated runs keep the string prompt; nothing travels back to the CLI there.
const INPUT_SETTLE_MS = Number.isFinite(input.inputSettleMs) ? input.inputSettleMs : 5000
// Background tasks keep the CLI running either way (it waits for them with stdin closed, too).
// This cap is for the case where the tracking below misses a task's end: then the CLI would wait
// for input that never comes. After this long without any message, stdin closes and the CLI goes
// on as it did with the string prompt.
const INPUT_IDLE_CAP_MS = Number.isFinite(input.inputIdleCapMs) ? input.inputIdleCapMs : 60 * 60 * 1000
let inputOpen = Boolean(options.canUseTool)
let releaseInput = () => {}
const inputReleased = new Promise(resolve => {
    releaseInput = resolve
})
let inputTimer = null
let turnOpen = true
let taskSetReported = false
const liveTasks = new Set()

async function* promptStream() {
    // The message the SDK itself writes for a string prompt.
    yield {
        type: 'user',
        session_id: '',
        message: { role: 'user', content: [{ type: 'text', text: input.prompt }] },
        parent_tool_use_id: null,
    }
    await inputReleased
}

function closeInput() {
    clearTimeout(inputTimer)
    inputTimer = null
    if (!inputOpen) return
    inputOpen = false
    releaseInput()
}

function trackRunState(message) {
    if (message?.type === 'result') {
        turnOpen = false
    } else if (message?.type === 'system' && message.subtype === 'init') {
        // Every turn, including the one a finished background task starts, opens with init.
        turnOpen = true
    } else if (message?.type === 'assistant' && !message.parent_tool_use_id) {
        turnOpen = true
    } else if (message?.type === 'system' && message.subtype === 'background_tasks_changed') {
        // The full set of live tasks, so it replaces whatever the edge events added.
        taskSetReported = true
        liveTasks.clear()
        for (const task of Array.isArray(message.tasks) ? message.tasks : []) {
            if (task?.task_id && !task.ambient) liveTasks.add(task.task_id)
        }
    } else if (message?.type === 'system' && message.subtype === 'task_started') {
        // CLIs that predate background_tasks_changed only send these edges.
        if (!taskSetReported && message.task_id && message.is_backgrounded !== false && !message.skip_transcript) {
            liveTasks.add(message.task_id)
        }
    } else if (message?.type === 'system' && message.subtype === 'task_notification') {
        if (message.task_id) liveTasks.delete(message.task_id)
    }

    clearTimeout(inputTimer)
    inputTimer = null
    if (!inputOpen || turnOpen) return
    inputTimer = setTimeout(closeInput, liveTasks.size === 0 ? INPUT_SETTLE_MS : INPUT_IDLE_CAP_MS)
}

try {
    const prompt = inputOpen ? promptStream() : input.prompt
    for await (const message of query({ prompt, options })) {
        emit(message)
        trackRunState(message)
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
} finally {
    // A pending close timer would otherwise keep the process alive after the query ended.
    closeInput()
}
