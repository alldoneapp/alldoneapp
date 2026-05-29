const admin = require('firebase-admin')
const { getEnvFunctions } = require('../envFunctionsHelper')
const { VM_JOB_GOLD_SOURCE, VM_JOB_GOLD_REFUND_SOURCE, VM_GOLD_PER_MINUTE, VM_TOKENS_PER_GOLD } = require('./vmJob')

// Hard ceiling on a single VM run. Kept below the worker's onTaskDispatched
// timeout (1800s) so we always tear down and finalize cleanly. Deliberately well
// under the function timeout so a hung agent surfaces as a failure in minutes
// rather than dead-waiting the full window.
const MAX_VM_RUNTIME_MS = 12 * 60 * 1000 // 12 minutes
// Don't refresh the live status comment more often than this (Firestore write rate).
const PROGRESS_UPDATE_INTERVAL_MS = 3000

// Per-task-type guidance prepended to the agent's objective.
const TASK_TYPE_PROFILES = {
    research:
        'You are an autonomous research agent. Do thorough multi-source web research and produce a clear, well-structured written report with sources.',
    document:
        'You are an autonomous agent that produces polished documents. Generate the requested deliverable (document, spreadsheet, or slides) and summarize what you produced.',
    prototype:
        'You are an autonomous coding agent. Write working code / a small prototype to satisfy the objective, then explain what you built and how to run it.',
    data:
        'You are an autonomous data agent. Acquire, clean and analyze the relevant data, then report the findings with any key figures.',
}

/**
 * Update the single live status comment in place (created when the job started).
 * Falls back to creating a new comment if no commentId was recorded.
 */
async function writeStatusComment(pendingWebhook, text, { isFinal = false, output = null } = {}) {
    const { projectId, objectType = 'tasks', objectId, assistantId, statusCommentId } = pendingWebhook
    const db = admin.firestore()
    const commentPathBase = `chatComments/${projectId}/${objectType}/${objectId}/comments`

    const commentId = statusCommentId || Date.now().toString() + '-' + Math.random().toString(36).substring(2, 10)
    const commentPayload = {
        creatorId: assistantId,
        commentText: text,
        originalContent: text,
        commentType: 'STAYWARD_COMMENT',
        lastChangeDate: admin.firestore.Timestamp.now(),
        fromAssistant: true,
    }
    if (isFinal && output != null) {
        commentPayload.webhookData = { output, correlationId: pendingWebhook.correlationId, kind: 'vm_job' }
    }

    try {
        if (statusCommentId) {
            await db.doc(`${commentPathBase}/${commentId}`).set(commentPayload, { merge: true })
        } else {
            commentPayload.created = Date.now()
            await db.doc(`${commentPathBase}/${commentId}`).set(commentPayload)
        }
    } catch (error) {
        console.warn('🖥️ VM JOB: Failed writing status comment', {
            correlationId: pendingWebhook.correlationId,
            error: error.message,
        })
        return
    }

    // Keep the chat object / parent object comment preview in sync.
    if (isFinal) {
        try {
            const chatRef = db.doc(`chatObjects/${projectId}/chats/${objectId}`)
            const chatDoc = await chatRef.get()
            if (chatDoc.exists) {
                const current = chatDoc.data().commentsData || { amount: 0 }
                await chatRef.update({
                    commentsData: {
                        lastCommentOwnerId: assistantId,
                        lastComment: text.substring(0, 100),
                        lastCommentType: 'STAYWARD_COMMENT',
                        amount: current.amount || 0,
                    },
                    lastEditionDate: Date.now(),
                    lastEditorId: assistantId,
                })
            }
        } catch (error) {
            console.warn('🖥️ VM JOB: Failed updating chat object on finalize', {
                correlationId: pendingWebhook.correlationId,
                error: error.message,
            })
        }
    }
}

/**
 * Build the prompt fed to Claude Code inside the sandbox.
 */
function buildAgentPrompt(vmJob) {
    const profile = TASK_TYPE_PROFILES[vmJob.taskType] || TASK_TYPE_PROFILES.research
    const parts = [profile, '', `# Objective`, vmJob.objective]
    if (vmJob.deliverable) {
        parts.push('', `# Expected deliverable`, vmJob.deliverable)
    }
    if (vmJob.packagedContext) {
        parts.push(
            '',
            `# Background context (provided from the app — the file context.md in your working directory has the same content)`,
            vmJob.packagedContext
        )
    }
    parts.push(
        '',
        'Work autonomously to completion. Your final message will be delivered verbatim to the user as the result, so make it a complete, self-contained answer.'
    )
    return parts.join('\n')
}

// --- Live activity feed from agent stream events ---

const MAX_ACTIVITY_LINES = 15

function truncate(value, n) {
    const s = String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
    return s.length > n ? s.substring(0, n) + '…' : s
}

// Map a Claude Code tool_use block to a friendly, human-readable activity line.
function claudeToolLabel(name, input) {
    const i = input || {}
    switch (name) {
        case 'WebSearch':
            return `🔍 Searching the web${i.query ? `: "${truncate(i.query, 80)}"` : '…'}`
        case 'WebFetch':
            return `🌐 Reading ${truncate(i.url || '', 80)}`
        case 'Bash':
            return `💻 ${truncate(i.command || 'running a command', 100)}`
        case 'Read':
            return `📄 Reading ${truncate(i.file_path || i.path || '', 80)}`
        case 'Write':
            return `✍️ Writing ${truncate(i.file_path || i.path || '', 80)}`
        case 'Edit':
        case 'MultiEdit':
            return `✏️ Editing ${truncate(i.file_path || i.path || '', 80)}`
        case 'Glob':
        case 'Grep':
            return `🔎 Searching files${i.pattern ? `: ${truncate(i.pattern, 60)}` : '…'}`
        case 'TodoWrite':
            return '🗒️ Planning the work…'
        default:
            return `🔧 ${name || 'tool'}`
    }
}

// Claude Code stream-json event → mutate state { activity[], finalResult, assistantText }.
// Final answer comes from the terminal `result` event.
function appendClaudeActivity(evt, state) {
    if (!evt || typeof evt !== 'object') return
    if (evt.type === 'result') {
        if (typeof evt.result === 'string') state.finalResult = evt.result
        if (evt.usage) {
            const u = evt.usage
            const cache = (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
            const input = u.input_tokens || 0
            const output = u.output_tokens || 0
            state.usage = {
                inputTokens: input,
                outputTokens: output,
                cacheTokens: cache,
                totalTokens: input + output + cache,
                costUsd: typeof evt.total_cost_usd === 'number' ? evt.total_cost_usd : null,
            }
        }
        return
    }
    if (evt.type === 'assistant' && evt.message && Array.isArray(evt.message.content)) {
        for (const b of evt.message.content) {
            if (b && b.type === 'text' && b.text) {
                state.assistantText += b.text
                if (b.text.trim()) state.activity.push(`💬 ${truncate(b.text, 200)}`)
            } else if (b && b.type === 'tool_use') {
                state.activity.push(claudeToolLabel(b.name, b.input))
            }
        }
    }
}

// OpenAI Codex `exec --json` event → mutate state. There is no `result` event; the
// final answer is the last `agent_message` item's text.
function appendCodexActivity(evt, state) {
    if (!evt || typeof evt !== 'object') return
    if (evt.type === 'error') {
        state.activity.push(`⚠️ ${truncate(evt.message || evt.error || 'error', 160)}`)
        return
    }
    if (evt.type === 'turn.completed') {
        const u = evt.usage || {}
        const input = u.input_tokens || 0
        const output = u.output_tokens || 0
        const cache = u.cached_input_tokens || 0
        state.usage = {
            inputTokens: input,
            outputTokens: output,
            cacheTokens: cache,
            totalTokens: u.total_tokens || input + output + cache,
            costUsd: null,
        }
        return
    }
    const item = evt.item
    if (!item || typeof item !== 'object') return
    const completed = evt.type === 'item.completed' || evt.type === 'item.done'
    switch (item.type) {
        case 'agent_message':
            if (typeof item.text === 'string' && item.text) {
                state.assistantText = item.text // last agent message is the final answer
                if (completed && item.text.trim()) state.activity.push(`💬 ${truncate(item.text, 200)}`)
            }
            break
        case 'reasoning':
            if (completed && item.text) state.activity.push(`💭 ${truncate(item.text, 160)}`)
            break
        case 'command_execution':
            if (completed) state.activity.push(`💻 ${truncate(item.command || 'command', 100)}`)
            break
        case 'web_search':
            if (completed) state.activity.push(`🔍 Searching${item.query ? `: "${truncate(item.query, 80)}"` : '…'}`)
            break
        case 'file_change':
            if (completed) state.activity.push('✏️ Editing files')
            break
        case 'mcp_tool_call':
            if (completed) state.activity.push(`🔧 ${truncate(item.tool || item.name || 'tool', 60)}`)
            break
        case 'todo_list':
        case 'plan_update':
            if (completed) state.activity.push('🗒️ Planning the work…')
            break
        default:
            break
    }
}

function renderActivityLog(lines) {
    return `🖥️ Working in a VM…\n\n${lines.slice(-MAX_ACTIVITY_LINES).join('\n')}`
}

// Per-agent configuration. The assistant picks the agent per task; we map it to the
// matching E2B prebuilt template, API key, sandbox env, headless command, and parser.
// E2B_*_TEMPLATE env vars are optional overrides — they default to E2B's prebuilt names.
const AGENT_CONFIGS = {
    claude: {
        label: 'Claude Code',
        defaultTemplate: 'claude',
        templateEnvKey: 'E2B_CLAUDE_TEMPLATE',
        apiKeyField: 'ANTHROPIC_API_KEY',
        installGuard: '(command -v claude >/dev/null 2>&1 || npm install -g @anthropic-ai/claude-code >/dev/null 2>&1)',
        runCommand:
            'claude -p "$(cat /home/user/prompt.txt)" --output-format stream-json --verbose --dangerously-skip-permissions </dev/null',
        sandboxEnv: apiKey => ({
            ANTHROPIC_API_KEY: apiKey,
            CI: 'true',
            DISABLE_AUTOUPDATER: '1',
            DISABLE_TELEMETRY: '1',
            DISABLE_ERROR_REPORTING: '1',
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        }),
        handleEvent: appendClaudeActivity,
    },
    codex: {
        label: 'Codex',
        defaultTemplate: 'codex',
        templateEnvKey: 'E2B_CODEX_TEMPLATE',
        apiKeyField: 'OPEN_AI_KEY', // reuse the existing OpenAI key
        installGuard: '(command -v codex >/dev/null 2>&1 || npm install -g @openai/codex >/dev/null 2>&1)',
        runCommand: 'codex exec --full-auto --skip-git-repo-check --json "$(cat /home/user/prompt.txt)" </dev/null',
        sandboxEnv: apiKey => ({
            CODEX_API_KEY: apiKey,
            OPENAI_API_KEY: apiKey,
            CI: 'true',
        }),
        handleEvent: appendCodexActivity,
    },
}

const DEFAULT_AGENT = 'claude'

/**
 * Run the selected agent (Claude Code or Codex) headless in a fresh E2B sandbox and
 * return its final output. Parses the agent's JSON event stream to surface live activity:
 * onActivity(text) is called (throttled by the caller) as events arrive.
 */
async function runAgentInSandbox(vmJob, config, apiKey, e2bApiKey, onActivity) {
    const { Sandbox } = require('e2b')
    const env = getEnvFunctions()
    // Template defaults to E2B's prebuilt name for this agent; the env var is an optional override.
    const template = env[config.templateEnvKey] || process.env[config.templateEnvKey] || config.defaultTemplate
    const createOpts = { apiKey: e2bApiKey, timeoutMs: MAX_VM_RUNTIME_MS }

    console.log('🖥️ VM JOB: creating sandbox', {
        correlationId: vmJob.correlationId,
        agent: config.label,
        template,
        timeoutMs: MAX_VM_RUNTIME_MS,
    })
    const sandbox = template ? await Sandbox.create(template, createOpts) : await Sandbox.create(createOpts)
    console.log('🖥️ VM JOB: sandbox created', {
        correlationId: vmJob.correlationId,
        sandboxId: sandbox.sandboxId || sandbox.id || null,
    })

    try {
        const prompt = buildAgentPrompt(vmJob)
        await sandbox.files.write('/home/user/prompt.txt', prompt)
        await sandbox.files.write('/home/user/context.md', vmJob.packagedContext || '')

        const state = { activity: [], finalResult: '', assistantText: '', usage: null }
        let stdoutBuf = ''
        let stderr = ''

        // The agent emits one JSON event per line. Parse complete lines, let the
        // agent-specific handler update activity + capture the final answer, and push
        // a fresh activity log to the chat whenever a new line is added.
        const handleLine = rawLine => {
            const line = rawLine.trim()
            if (!line) return
            let evt
            try {
                evt = JSON.parse(line)
            } catch (_) {
                return // non-JSON noise (e.g. stray install output) — ignore
            }
            const before = state.activity.length
            config.handleEvent(evt, state)
            if (state.activity.length > before && typeof onActivity === 'function') {
                onActivity(renderActivityLog(state.activity))
            }
        }
        const handleStdout = data => {
            stdoutBuf += data
            let idx
            while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
                handleLine(stdoutBuf.slice(0, idx))
                stdoutBuf = stdoutBuf.slice(idx + 1)
            }
        }
        const handleStderr = data => {
            stderr += data
        }

        // Run the agent headless. The prompt is passed as a positional argument (NOT piped
        // via stdin — reading stdin can hang non-interactively), and stdin is from /dev/null
        // so any unexpected interactive read gets EOF instead of blocking until the timeout.
        const command = `cd /home/user && ${config.installGuard} && ${config.runCommand}`

        console.log('🖥️ VM JOB: running agent command', { correlationId: vmJob.correlationId, agent: config.label })
        let result
        try {
            result = await sandbox.commands.run(`bash -lc '${command.replace(/'/g, `'\\''`)}'`, {
                envs: config.sandboxEnv(apiKey),
                timeoutMs: MAX_VM_RUNTIME_MS,
                onStdout: handleStdout,
                onStderr: handleStderr,
            })
        } catch (runError) {
            // The command was killed (e.g. timeout) before returning — log whatever it
            // produced so we can see where the agent got stuck, then rethrow.
            console.error('🖥️ VM JOB: command errored/terminated', {
                correlationId: vmJob.correlationId,
                agent: config.label,
                error: runError.message,
                events: state.activity.length,
                lastActivity: state.activity.slice(-3),
                stdoutBufLen: stdoutBuf.length,
                stderrLen: stderr.length,
                stderrPreview: stderr ? stderr.substring(0, 800) : '',
            })
            throw runError
        }
        if (stdoutBuf.trim()) handleLine(stdoutBuf) // flush any trailing partial line
        console.log('🖥️ VM JOB: command finished', {
            correlationId: vmJob.correlationId,
            agent: config.label,
            exitCode: result?.exitCode,
            events: state.activity.length,
            finalResultLen: (state.finalResult || state.assistantText).length,
            stderrLen: stderr.length,
            stderrPreview: stderr ? stderr.substring(0, 300) : '',
        })

        const output = (state.finalResult || state.assistantText || '').trim()
        if (!output) {
            const detail = ` exitCode=${result?.exitCode}${stderr ? `: ${stderr.substring(0, 500)}` : ''}`
            throw new Error(`Agent produced no output.${detail}`)
        }
        return { output, usage: state.usage }
    } finally {
        try {
            await sandbox.kill()
        } catch (error) {
            console.warn('🖥️ VM JOB: Failed killing sandbox', { error: error.message })
        }
    }
}

/**
 * Refund the Gold charged for a job that failed before producing a result.
 */
async function refundVmJob(pendingWebhook, reason) {
    const amount = pendingWebhook.goldCharged
    if (!amount) return
    try {
        const { refundGold } = require('../Gold/goldHelper')
        await refundGold(pendingWebhook.userId, amount, {
            source: VM_JOB_GOLD_REFUND_SOURCE,
            channel: 'assistant',
            projectId: pendingWebhook.projectId,
            objectId: pendingWebhook.objectId,
            objectType: pendingWebhook.objectType,
            note: reason || 'VM task failed',
        })
    } catch (error) {
        console.error('🖥️ VM JOB: Failed to refund Gold', {
            correlationId: pendingWebhook.correlationId,
            error: error.message,
        })
    }
}

/**
 * Charge the metered Gold top-up after a successful run: per-minute (E2B compute) +
 * per-token (LLM usage). The base reserve was already charged up-front in startVmJob.
 * If the user can't cover the full amount, charge whatever balance remains.
 */
async function chargeVmTopup(pendingWebhook, vmJob, { topup, minutes, totalTokens, costUsd }) {
    if (!topup || topup <= 0) return
    const { deductGold } = require('../Gold/goldHelper')
    const note =
        `VM ${vmJob.agent || 'claude'} metered: ${minutes} min + ${totalTokens} tokens` +
        (typeof costUsd === 'number' ? ` (~$${costUsd.toFixed(2)})` : '')
    const ctx = {
        source: VM_JOB_GOLD_SOURCE,
        channel: 'assistant',
        projectId: pendingWebhook.projectId,
        objectId: pendingWebhook.objectId,
        objectType: pendingWebhook.objectType,
        note,
    }
    const result = await deductGold(pendingWebhook.userId, topup, ctx).catch(() => null)
    // Run already completed — if the user lacks enough Gold, take what's left.
    if (result && result.success === false && typeof result.currentGold === 'number' && result.currentGold > 0) {
        await deductGold(pendingWebhook.userId, result.currentGold, ctx).catch(() => {})
    }
}

/**
 * Worker entry point: run a queued VM job to completion and post the result back
 * into the conversation. Invoked by the runVmJob onTaskDispatched function.
 */
async function runVmJobByCorrelationId(correlationId) {
    console.log('🖥️ VM JOB RUNNER: Starting', { correlationId })
    const db = admin.firestore()
    const pendingRef = db.doc(`pendingWebhooks/${correlationId}`)

    const [pendingDoc, jobDoc] = await Promise.all([pendingRef.get(), db.doc(`vmJobs/${correlationId}`).get()])
    if (!pendingDoc.exists || !jobDoc.exists) {
        console.error('🖥️ VM JOB RUNNER: Job records missing', { correlationId })
        return
    }
    const pendingWebhook = pendingDoc.data()
    const vmJob = jobDoc.data()

    // Idempotency: don't re-run a job that already settled.
    if (pendingWebhook.status === 'completed' || pendingWebhook.status === 'failed') {
        console.warn('🖥️ VM JOB RUNNER: Already settled, skipping', { correlationId, status: pendingWebhook.status })
        return
    }

    await pendingRef.update({ status: 'initiated', initiatedAt: Date.now() }).catch(() => {})

    const env = getEnvFunctions()
    const e2bApiKey = env.E2B_API_KEY
    // Resolve the agent the assistant chose (defaults to Claude) and its config.
    const config = AGENT_CONFIGS[vmJob.agent] || AGENT_CONFIGS[DEFAULT_AGENT]
    const apiKey = env[config.apiKeyField]
    if (!apiKey || !e2bApiKey) {
        const message = `VM task could not run: ${config.label} sandbox credentials are not configured.`
        await writeStatusComment(pendingWebhook, `❌ ${message}`)
        await pendingRef.update({ status: 'failed', error: message, failedAt: Date.now() }).catch(() => {})
        await refundVmJob(pendingWebhook, 'Missing sandbox credentials')
        return
    }

    // Throttled live-activity updates to the single status comment. The worker passes
    // a fully-rendered activity log; we just rate-limit the Firestore writes.
    let lastProgressAt = 0
    const onActivity = text => {
        const now = Date.now()
        if (now - lastProgressAt < PROGRESS_UPDATE_INTERVAL_MS) return
        lastProgressAt = now
        writeStatusComment(pendingWebhook, text).catch(() => {})
    }

    try {
        await writeStatusComment(pendingWebhook, `🖥️ Working in a VM (${config.label})…`)
        const { output, usage } = await runAgentInSandbox(vmJob, config, apiKey, e2bApiKey, onActivity)

        // Auto-presentation: the agent's final message becomes the assistant comment.
        await writeStatusComment(pendingWebhook, output, { isFinal: true, output })

        // Metered Gold top-up from actual usage: per-minute (VM compute) + per-token (LLM).
        const runtimeMs = Date.now() - (vmJob.createdAt || Date.now())
        const minutes = Math.max(1, Math.ceil(runtimeMs / 60000))
        const totalTokens = usage && usage.totalTokens ? usage.totalTokens : 0
        const topup = minutes * VM_GOLD_PER_MINUTE + Math.round(totalTokens / VM_TOKENS_PER_GOLD)
        await chargeVmTopup(pendingWebhook, vmJob, { topup, minutes, totalTokens, costUsd: usage?.costUsd })

        await pendingRef
            .update({
                status: 'completed',
                completedAt: Date.now(),
                runtimeMs,
                usage: usage || null,
                goldTopup: topup,
            })
            .catch(() => {})
        console.log('🖥️ VM JOB RUNNER: Completed', {
            correlationId,
            outputLength: output.length,
            minutes,
            totalTokens,
            topup,
            costUsd: usage?.costUsd ?? null,
        })
    } catch (error) {
        console.error('🖥️ VM JOB RUNNER: Failed', { correlationId, error: error.message, stack: error.stack })
        const message = `The VM task could not be completed: ${error.message}`
        await writeStatusComment(pendingWebhook, `❌ ${message}`)
        await pendingRef.update({ status: 'failed', error: error.message, failedAt: Date.now() }).catch(() => {})
        await refundVmJob(pendingWebhook, 'VM task failed during execution')
    }
}

module.exports = {
    runVmJobByCorrelationId,
    MAX_VM_RUNTIME_MS,
}
