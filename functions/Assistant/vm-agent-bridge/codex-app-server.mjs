import fs from 'node:fs'
import readline from 'node:readline'
import { spawn } from 'node:child_process'

const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`)
const child = spawn(input.codexBinary || 'codex', ['app-server', '--stdio', ...(input.codexArgs || [])], {
    cwd: input.cwd,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
})
const pending = new Map()
let nextId = 1
let threadId = input.providerState?.threadId || null
let interaction = null
let output = ''
let plan = ''
let usage = null
let turnDone
let approvedRequestConsumed = false
const turnCompleted = new Promise(resolve => {
    turnDone = resolve
})

const send = value => child.stdin.write(`${JSON.stringify(value)}\n`)
const rpc = (method, params) =>
    new Promise((resolve, reject) => {
        const id = nextId++
        pending.set(String(id), { resolve, reject })
        send({ id, method, params })
    })

const mapQuestion = question => ({
    id: question.id,
    header: question.header,
    question: question.question,
    isOther: question.isOther,
    isSecret: question.isSecret,
    multiSelect: false,
    options: question.options || [],
})

const interruptForHostInteraction = params => {
    if (!params.threadId || !params.turnId) return
    setTimeout(() => {
        rpc('turn/interrupt', { threadId: params.threadId, turnId: params.turnId }).catch(() => {})
    }, 0)
}

const captureServerRequest = message => {
    const { method, params = {}, id } = message
    if (method === 'item/tool/requestUserInput') {
        interaction ||= {
            kind: 'clarification',
            providerRequestId: String(id),
            payload: { questions: (params.questions || []).map(mapQuestion) },
        }
        send({ id, result: { answers: {} } })
        interruptForHostInteraction(params)
        return true
    }
    if (method === 'item/commandExecution/requestApproval') {
        if (
            input.approvedTool?.action === 'approve' &&
            !approvedRequestConsumed &&
            input.approvedTool?.toolName === 'Command execution' &&
            (!input.approvedTool.command || input.approvedTool.command === (params.command || ''))
        ) {
            approvedRequestConsumed = true
            send({ id, result: { decision: 'accept' } })
            return true
        }
        interaction ||= {
            kind: 'tool_approval',
            providerRequestId: String(id),
            payload: {
                toolName: 'Command execution',
                reason: params.reason || '',
                command: params.command || '',
                cwd: params.cwd || input.cwd,
            },
        }
        send({ id, result: { decision: 'decline' } })
        interruptForHostInteraction(params)
        return true
    }
    if (method === 'item/fileChange/requestApproval') {
        if (
            input.approvedTool?.action === 'approve' &&
            !approvedRequestConsumed &&
            input.approvedTool?.toolName === 'File changes'
        ) {
            approvedRequestConsumed = true
            send({ id, result: { decision: 'accept' } })
            return true
        }
        interaction ||= {
            kind: 'tool_approval',
            providerRequestId: String(id),
            payload: { toolName: 'File changes', reason: params.reason || '', cwd: input.cwd },
        }
        send({ id, result: { decision: 'decline' } })
        interruptForHostInteraction(params)
        return true
    }
    return false
}

const handleNotification = message => {
    const { method, params = {} } = message
    if (method === 'item/completed') {
        const item = params.item || {}
        if (item.type === 'agentMessage') {
            output = item.text || output
            emit({ type: 'item.completed', item: { type: 'agent_message', text: item.text || '' } })
        } else if (item.type === 'plan') {
            plan = item.text || plan
            emit({ type: 'item.completed', item: { type: 'plan_update', text: item.text || '' } })
        } else if (item.type === 'commandExecution') {
            emit({ type: 'item.completed', item: { type: 'command_execution', command: item.command || '' } })
        } else if (item.type === 'fileChange') {
            emit({ type: 'item.completed', item: { type: 'file_change' } })
        }
    } else if (method === 'turn/plan/updated') {
        plan = (params.plan || []).map(step => `- [${step.status || 'pending'}] ${step.step || ''}`).join('\n')
    } else if (method === 'turn/completed') {
        emit({ type: 'turn.completed', usage: usage || {} })
        turnDone(params.turn)
    } else if (method === 'thread/tokenUsage/updated') {
        const total = params.tokenUsage?.total || {}
        usage = {
            inputTokens: total.inputTokens || 0,
            outputTokens: total.outputTokens || 0,
            cacheTokens: total.cachedInputTokens || 0,
            totalTokens:
                total.totalTokens ||
                (total.inputTokens || 0) + (total.outputTokens || 0) + (total.cachedInputTokens || 0),
            costUsd: null,
        }
    } else if (method === 'error') {
        emit({ type: 'error', message: params.message || 'Codex App Server error' })
    }
}

readline.createInterface({ input: child.stdout }).on('line', line => {
    let message
    try {
        message = JSON.parse(line)
    } catch (_) {
        return
    }
    if (message.method && Object.prototype.hasOwnProperty.call(message, 'id')) {
        if (!captureServerRequest(message))
            send({ id: message.id, error: { code: -32601, message: 'Unsupported request' } })
        return
    }
    if (Object.prototype.hasOwnProperty.call(message, 'id')) {
        const waiter = pending.get(String(message.id))
        if (!waiter) return
        pending.delete(String(message.id))
        if (message.error) waiter.reject(new Error(message.error.message || 'Codex RPC failed'))
        else waiter.resolve(message.result)
        return
    }
    if (message.method) handleNotification(message)
})

child.stderr.on('data', data => process.stderr.write(data))
child.on('error', error => {
    emit({ type: 'alldone.bridge_error', message: error.message, providerState: { threadId } })
    process.exitCode = 1
    turnDone(null)
})

try {
    await rpc('initialize', {
        clientInfo: { name: 'alldone-vm', title: 'Alldone VM', version: '1.0.0' },
        capabilities: { experimentalApi: true, requestAttestation: false },
    })
    send({ method: 'initialized' })

    if (threadId) {
        const resumed = await rpc('thread/resume', {
            threadId,
            cwd: input.cwd,
            model: input.model || null,
            approvalPolicy: input.approvalPolicy,
            approvalsReviewer: input.approvalsReviewer || 'auto_review',
            sandbox: 'workspace-write',
        })
        threadId = resumed.thread.id
    } else {
        const started = await rpc('thread/start', {
            cwd: input.cwd,
            model: input.model || null,
            approvalPolicy: input.approvalPolicy,
            approvalsReviewer: input.approvalsReviewer || 'auto_review',
            sandbox: 'workspace-write',
        })
        threadId = started.thread.id
    }

    const collaborationMode = {
        mode: input.phase === 'planning' ? 'plan' : 'default',
        settings: {
            model: input.model,
            reasoning_effort: input.effort || null,
            developer_instructions: null,
        },
    }
    await rpc('turn/start', {
        threadId,
        input: [{ type: 'text', text: input.prompt, text_elements: [] }],
        cwd: input.cwd,
        model: input.model || null,
        effort: input.effort || null,
        approvalPolicy: input.approvalPolicy,
        approvalsReviewer: input.approvalsReviewer || 'auto_review',
        collaborationMode,
    })
    await turnCompleted

    const providerState = { threadId }
    if (interaction) {
        emit({ type: 'alldone.interaction', interaction: { ...interaction, providerState } })
    } else if (input.phase === 'planning') {
        emit({
            type: 'alldone.interaction',
            interaction: {
                kind: 'plan_review',
                providerRequestId: '',
                payload: { plan: plan || output },
                providerState,
            },
        })
    } else {
        emit({ type: 'alldone.completed', output, usage, providerState })
    }
} catch (error) {
    emit({ type: 'alldone.bridge_error', message: error.message, providerState: { threadId } })
    process.exitCode = 1
} finally {
    child.kill('SIGTERM')
}
