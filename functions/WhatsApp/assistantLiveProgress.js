const { ACTION_PRESENTATION, buildToolActivityDescriptor } = require('../Assistant/assistantProgressStatus')

const { voiceOperationOutcome, statusUpdate, formatLiveStatus } = require('./assistantLiveStatus')

const BACKGROUND_STATES = {
    queued: ['queued', 'Background task', false],
    pending: ['starting', 'Background task', false],
    running: ['running', 'Background task', false],
    waiting_for_auth_refresh: ['requires_auth', 'Background task', false],
    awaiting_user: ['awaiting_user', 'Background task', false],
    cancel_requested: ['cancel_requested', 'Background task', false],
    completed: ['completed', 'Background run', true],
    failed: ['failed', 'Background task', true],
    cancelled: ['cancelled', 'Background task', true],
    interrupted: ['failed', 'Background task interrupted', true],
}

function backgroundProgress(data) {
    const state = BACKGROUND_STATES[data?.status]
    if (!state) return null
    const outcome =
        state[0] === 'failed'
            ? voiceOperationOutcome({ success: false, error: data.error, failureReason: data.failureReason })
            : { status: state[0], cause: null }
    return { ...statusUpdate({ ...outcome, step: state[1] }), terminal: state[2] }
}

function toolProgress(name, args) {
    // Chat's descriptor selects and sanitizes useful subjects; never serialize args.
    const { actionKey, subject } = buildToolActivityDescriptor({ toolName: name, toolArgs: args })
    const text = ACTION_PRESENTATION[actionKey]?.[1]
    return text && (!text.includes('%s') || subject)
        ? text.replace('%s', () => subject || '')
        : 'Waiting for the connected service to respond'
}

function voiceToolFailure(result, error) {
    return voiceOperationOutcome(result, error).cause
}

const operationKey = (name, args) =>
    JSON.stringify([name, args || {}], (key, value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return value
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map(key => [key, value[key]])
        )
    })

function createLiveToolProgress({ publish }) {
    let nextId = 0
    const active = new Map()
    const issues = new Map()
    const latestOutcome = new Map()
    let lastFinished = null
    const report = () => {
        const operations = [...active.values()]
        const issue =
            [...issues.values()].findLast(outcome => outcome.status === 'failed') || [...issues.values()].at(-1)
        const outcome = issue || (operations.length ? { status: 'running' } : lastFinished)
        if (!outcome) return
        publish(
            statusUpdate({
                ...outcome,
                active: operations.slice(0, 2).map(operation => operation.label),
                activeCount: operations.length,
            })
        )
    }
    return {
        start(name, args) {
            const id = ++nextId
            active.set(id, { key: operationKey(name, args), label: toolProgress(name, args) })
            report()
            return id
        },
        finish(id, result, error) {
            const operation = active.get(id)
            if (!operation) return
            active.delete(id)
            if (id < (latestOutcome.get(operation.key) || 0)) {
                report()
                return
            }
            latestOutcome.set(operation.key, id)
            lastFinished = { ...voiceOperationOutcome(result, error), step: operation.label }
            if (
                ['failed', 'outcome_unconfirmed', 'waiting', 'requires_auth', 'awaiting_user'].includes(
                    lastFinished.status
                )
            )
                issues.set(operation.key, lastFinished)
            else issues.delete(operation.key)
            report()
        },
    }
}

function createLiveProgress({ publish, publishContext = () => {}, scope = 'request' }) {
    const startedAt = Date.now()
    let lastSentAt = startedAt
    let lastContent = null
    let update = null
    let lastErrorContext = null
    let stopped = false
    const flushContext = () => {
        if (stopped) return
        const context = formatLiveStatus(update || { status: 'running', scope }, { errorContextOnly: true })
        if (context !== lastErrorContext) {
            publishContext(context)
            lastErrorContext = context
        }
    }
    return {
        flushContext,
        update: value => {
            update = value && typeof value === 'object' ? statusUpdate({ ...value, scope }) : null
        },
        stop: () => {
            stopped = true
        },
        tick: ({ active, lastSpeechAt }) => {
            const now = Date.now()
            if (stopped || !active) return false
            // Quiet context contains ONLY evidence about errors, never an answer
            // or a second instruction to speak. Clear an old error on recovery.
            flushContext()
            if (!update || now - lastSpeechAt < 4000) return false
            const content = formatLiveStatus(update)
            const urgent = update.urgent
            // Fast work stays quiet. Coalesce changing stages, and leave more space
            // before repeating an unchanged wait. Time alone never implies progress.
            const delay =
                urgent && content !== lastContent
                    ? 2000
                    : lastContent === null
                      ? 8000
                      : content === lastContent
                        ? 45000
                        : 20000
            if (now - lastSentAt < delay) return false
            publish(update)
            lastSentAt = now
            lastContent = content
            return true
        },
    }
}

module.exports = {
    createLiveProgress,
    createLiveToolProgress,
    toolProgress,
    voiceToolFailure,
    backgroundProgress,
}
