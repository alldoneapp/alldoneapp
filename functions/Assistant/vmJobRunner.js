const admin = require('firebase-admin')
const { getEnvFunctions } = require('../envFunctionsHelper')
const { VM_JOB_GOLD_REFUND_SOURCE } = require('./vmJob')

// Hard ceiling on a single VM run. Kept below the worker's onTaskDispatched
// timeout (1800s) so we always tear down and finalize cleanly. Deliberately well
// under the function timeout so a hung agent surfaces as a failure in minutes
// rather than dead-waiting the full window.
const MAX_VM_RUNTIME_MS = 12 * 60 * 1000 // 12 minutes
// Don't refresh the live status comment more often than this.
const PROGRESS_UPDATE_INTERVAL_MS = 4000

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

/**
 * Run Claude Code headless inside a fresh E2B sandbox and return its final output.
 * onProgress(latestLine) is called (throttled by the caller) as stdout streams.
 */
async function runClaudeCodeInSandbox(vmJob, anthropicApiKey, e2bApiKey, onProgress) {
    const { Sandbox } = require('e2b')
    // Read from getEnvFunctions() (env_functions.json) first so it's configured the same
    // way as the other keys; fall back to process.env for local dev convenience.
    const template = getEnvFunctions().E2B_CLAUDE_TEMPLATE || process.env.E2B_CLAUDE_TEMPLATE || undefined
    const createOpts = { apiKey: e2bApiKey, timeoutMs: MAX_VM_RUNTIME_MS }

    console.log('🖥️ VM JOB: creating sandbox', {
        correlationId: vmJob.correlationId,
        template: template || '(base image — claude installed per-run)',
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

        let stdout = ''
        let stderr = ''
        const handleStdout = data => {
            stdout += data
            if (typeof onProgress === 'function') {
                const trimmed = String(data).trim()
                if (trimmed) onProgress(trimmed)
            }
        }
        const handleStderr = data => {
            stderr += data
        }

        // Run Claude Code headless. The prompt is passed as a positional argument
        // (NOT piped via stdin — `claude -p` reading stdin can hang non-interactively),
        // and stdin is redirected from /dev/null so any unexpected interactive read
        // gets EOF immediately instead of blocking until the timeout.
        const command =
            'cd /home/user && ' +
            '(command -v claude >/dev/null 2>&1 || npm install -g @anthropic-ai/claude-code >/dev/null 2>&1) && ' +
            'claude -p "$(cat /home/user/prompt.txt)" --output-format text --dangerously-skip-permissions </dev/null'

        console.log('🖥️ VM JOB: running agent command', { correlationId: vmJob.correlationId })
        const result = await sandbox.commands.run(`bash -lc '${command.replace(/'/g, `'\\''`)}'`, {
            envs: { ANTHROPIC_API_KEY: anthropicApiKey, CI: 'true' },
            timeoutMs: MAX_VM_RUNTIME_MS,
            onStdout: handleStdout,
            onStderr: handleStderr,
        })
        console.log('🖥️ VM JOB: command finished', {
            correlationId: vmJob.correlationId,
            exitCode: result?.exitCode,
            stdoutLen: stdout.length,
            stderrLen: stderr.length,
            stderrPreview: stderr ? stderr.substring(0, 300) : '',
        })

        const output = (stdout || result?.stdout || '').trim()
        if (!output) {
            const detail = stderr ? ` exitCode=${result?.exitCode}: ${stderr.substring(0, 500)}` : ''
            throw new Error(`Agent produced no output.${detail}`)
        }
        return output
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
    const anthropicApiKey = env.ANTHROPIC_API_KEY
    const e2bApiKey = env.E2B_API_KEY
    if (!anthropicApiKey || !e2bApiKey) {
        const message = 'VM task could not run: sandbox credentials are not configured.'
        await writeStatusComment(pendingWebhook, `❌ ${message}`)
        await pendingRef.update({ status: 'failed', error: message, failedAt: Date.now() }).catch(() => {})
        await refundVmJob(pendingWebhook, 'Missing sandbox credentials')
        return
    }

    // Throttled progress updates to the live status comment.
    let lastProgressAt = 0
    let latestLine = ''
    const onProgress = line => {
        latestLine = line.length > 280 ? line.substring(0, 280) + '…' : line
        const now = Date.now()
        if (now - lastProgressAt < PROGRESS_UPDATE_INTERVAL_MS) return
        lastProgressAt = now
        writeStatusComment(pendingWebhook, `🖥️ Working in a VM…\n\n${latestLine}`).catch(() => {})
    }

    try {
        await writeStatusComment(pendingWebhook, '🖥️ Working in a VM…')
        const output = await runClaudeCodeInSandbox(vmJob, anthropicApiKey, e2bApiKey, onProgress)

        // Auto-presentation: the agent's final message becomes the assistant comment.
        await writeStatusComment(pendingWebhook, output, { isFinal: true, output })
        await pendingRef
            .update({
                status: 'completed',
                completedAt: Date.now(),
                runtimeMs: Date.now() - (vmJob.createdAt || Date.now()),
            })
            .catch(() => {})
        console.log('🖥️ VM JOB RUNNER: Completed', { correlationId, outputLength: output.length })
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
