import { runHttpsCallableFunction } from '../firestore'

/**
 * Send one human gesture to the current Playwright context. Passwords are passed only in the
 * callable request body and are never put in Firestore or the assistant conversation.
 */
export function interactWithBrowserTakeover({ approvalId, action, input = {} }) {
    return runHttpsCallableFunction('browserTakeoverSecondGen', { approvalId, action, input }, { timeout: 60000 })
}

export function finishBrowserTakeover({ approvalId, cancelled = false }) {
    return runHttpsCallableFunction(
        'browserTakeoverSecondGen',
        { approvalId, action: cancelled ? 'cancel' : 'finish' },
        { timeout: 60000 }
    )
}
