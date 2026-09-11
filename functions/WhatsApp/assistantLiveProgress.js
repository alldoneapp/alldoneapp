const { ACTION_PRESENTATION, buildToolActivityDescriptor } = require('../Assistant/assistantProgressStatus')

const WORKING = 'I am still working on your request.'
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
    return state ? { content: state[0], terminal: state[1] } : null
}

function toolProgress(name) {
    // Reuse chat's activity vocabulary, without arguments, raw output or private reasoning.
    const { actionKey } = buildToolActivityDescriptor({ toolName: name })
    const text = ACTION_PRESENTATION[actionKey]?.[1]
    return text && !text.includes('%s') ? `${text}. I am still waiting for the result.` : WORKING
}

function createLiveProgress({ publish }) {
    const startedAt = Date.now()
    let lastSentAt = startedAt
    let lastContent = null
    let content = WORKING
    let stopped = false
    return {
        update: text => {
            content = text
        },
        stop: () => {
            stopped = true
        },
        tick: ({ active, lastSpeechAt }) => {
            const now = Date.now()
            if (stopped || !active || now - lastSpeechAt < 4000) return false
            // Fast work stays quiet. Coalesce changing stages, and leave more space
            // before repeating an unchanged wait. Time alone never implies progress.
            const delay = lastContent === null ? 8000 : content === lastContent ? 45000 : 20000
            if (now - lastSentAt < delay) return false
            publish(content)
            lastSentAt = now
            lastContent = content
            return true
        },
    }
}

module.exports = { createLiveProgress, toolProgress, backgroundProgress, REVIEWING }
