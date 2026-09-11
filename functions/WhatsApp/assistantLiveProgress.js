const { ACTION_PRESENTATION, buildToolActivityDescriptor } = require('../Assistant/assistantProgressStatus')

const REVIEWING = 'I am working through the information returned so far. The answer is not ready yet.'

const BACKGROUND_STATES = {
    queued: ['The background task is queued and waiting for the previous work to finish.', false],
    pending: ['The background task is starting. Its result is not ready yet.', false],
    running: ['The background task is still running. I am waiting for its result.', false],
    waiting_for_auth_refresh: ['The background task is waiting for its connection to be restored.', false],
    awaiting_user: [
        'The background task needs your input. Please check its question or approval request in the chat.',
        false,
    ],
    cancel_requested: ['Cancellation of the background task has been requested, but is not confirmed yet.', false],
    completed: ['The background run has finished. Please check the result in its chat for the outcome.', true],
    failed: ['The background task could not finish. Details are in its chat.', true],
    cancelled: ['The background task has been cancelled.', true],
    interrupted: ['The background task was interrupted. Please check its chat before continuing.', true],
}

function backgroundProgress(data) {
    const state = BACKGROUND_STATES[data?.status]
    if (!state) return null
    const detail =
        ['failed', 'interrupted'].includes(data.status) && (data.error || data.failureReason)
            ? voiceToolFailure({ success: false, error: data.error || data.failureReason })
            : null
    return { content: detail ? `${state[0]} Reported error: “${detail}”.` : state[0], terminal: state[1] }
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
    const failed =
        error ||
        result?.success === false ||
        ['failed', 'error', 'blocked', 'permission_denied', 'requires_auth', 'confirmation_required'].includes(
            result?.status
        )
    if (!failed) return null
    const raw =
        error?.message ||
        (typeof result?.error === 'string' ? result.error : result?.error?.message) ||
        result?.message ||
        result?.status ||
        'The tool returned no successful result'
    // Surface the actual actionable error, never credentials, URLs, addresses or
    // opaque payloads. Quoted error text remains untrusted data for the voice model.
    return String(raw)
        .replace(/Bearer\s+\S+|\b(?:sk-|ghp_|glpat-|ya29\.)[A-Za-z0-9._-]+/gi, '[credential omitted]')
        .replace(/https?:\/\/\S+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[address omitted]')
        .replace(/[A-Za-z0-9+/_=-]{40,}/g, '[identifier omitted]')
        .replace(/[\x00-\x1f\x7f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180)
}

function createLiveToolProgress({ publish }) {
    let nextId = 0
    const active = new Map()
    const failures = new Map()
    let lastFinished = null
    const report = () => {
        const details = []
        if (failures.size) details.push([...failures.values()].at(-1))
        const operations = [...active.values()]
        if (operations.length) {
            details.push(
                `Currently: ${operations
                    .slice(0, 2)
                    .map(operation => operation.label)
                    .join('; ')}${operations.length > 2 ? '; plus one other lookup' : ''}.`
            )
        } else if (lastFinished && !failures.size) {
            details.push(`The step “${lastFinished}” returned a result. I am checking that result before answering.`)
        }
        if (details.length) publish({ content: details.join(' '), urgent: failures.size > 0 })
    }
    return {
        start(name, args) {
            const id = ++nextId
            active.set(id, { key: JSON.stringify([name, args || {}]), label: toolProgress(name, args) })
            report()
            return id
        },
        finish(id, result, error) {
            const operation = active.get(id)
            if (!operation) return
            active.delete(id)
            lastFinished = operation.label
            const failure = voiceToolFailure(result, error)
            if (failure) failures.set(operation.key, `The step “${operation.label}” could not complete: “${failure}”.`)
            else failures.delete(operation.key)
            report()
        },
    }
}

function createLiveProgress({ publish }) {
    const startedAt = Date.now()
    let lastSentAt = startedAt
    let lastContent = null
    let content = null
    let urgent = false
    let stopped = false
    return {
        update: value => {
            content = typeof value === 'string' ? value : value?.content || null
            urgent = value?.urgent === true
        },
        stop: () => {
            stopped = true
        },
        tick: ({ active, lastSpeechAt }) => {
            const now = Date.now()
            if (stopped || !content || !active || now - lastSpeechAt < 4000) return false
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
            publish(content)
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
    REVIEWING,
}
