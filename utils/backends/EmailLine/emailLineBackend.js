import store from '../../../redux/store'
import { setEmailLineSummary, setEmailLineLoading } from '../../../redux/actions'
import { runHttpsCallableFunction } from '../firestore'
import { buildConnectionKeyPayload } from '../../IntegrationProviders'

// All functions here take a `key`: an account-level connection id (email_google_…) or a
// legacy projectId. Redux summaries are stored under whichever key was used.

// Per-project cooldown so mounting/remounting the line doesn't hammer the
// callable. Mirrors the gmailSyncCache pattern in firestore.js.
const summaryCooldownCache = new Map()
const SUMMARY_COOLDOWN_MS = 60 * 1000 // 1 minute

export async function fetchEmailLineSummary(projectId, { force = false, includeNeedsReply = true } = {}) {
    if (!projectId) return null

    const lastFetch = summaryCooldownCache.get(projectId)
    if (!force && lastFetch && Date.now() - lastFetch < SUMMARY_COOLDOWN_MS) {
        return store.getState().emailLineSummaryByProject[projectId] || null
    }

    summaryCooldownCache.set(projectId, Date.now())
    store.dispatch(setEmailLineLoading(projectId, true))

    try {
        const summary = await runHttpsCallableFunction('getEmailLineSummarySecondGen', {
            ...buildConnectionKeyPayload(projectId),
            includeNeedsReply,
        })
        store.dispatch(setEmailLineSummary(projectId, summary))
        return summary
    } catch (error) {
        const authExpired = String(error?.message || '').includes('EMAIL_AUTH_EXPIRED')
        if (authExpired) {
            const summary = {
                provider: '',
                emailAddress: '',
                labels: [],
                needsReplyCount: 0,
                needsReplyByMessageId: {},
                inboxZero: false,
                connected: true,
                authExpired: true,
                scannedAt: Date.now(),
            }
            store.dispatch(setEmailLineSummary(projectId, summary))
            return summary
        }
        // Leave the previous summary in place on transient errors; reset the
        // cooldown so the next attempt can retry sooner.
        summaryCooldownCache.delete(projectId)
        if (__DEV__) console.warn('[EmailLine] Failed to fetch summary:', error?.message || error)
        return null
    } finally {
        store.dispatch(setEmailLineLoading(projectId, false))
    }
}

export function invalidateEmailLineSummaryCooldown(projectId) {
    if (projectId) summaryCooldownCache.delete(projectId)
}

export async function listEmailLineMessages(projectId, labelId, { pageToken } = {}) {
    if (!projectId || !labelId) return { messages: [], nextPageToken: null }
    return runHttpsCallableFunction('listEmailLineMessagesSecondGen', {
        ...buildConnectionKeyPayload(projectId),
        labelId,
        pageToken,
    })
}

// Marks an email's label decision as wrong (optionally naming the correct label) and
// returns the updated learned-rules block the server folded the feedback into.
export async function submitEmailLabelFeedback(projectId, { messageId, correctLabel, note } = {}) {
    if (!projectId || !messageId) return null
    return runHttpsCallableFunction('submitEmailLabelFeedbackSecondGen', {
        ...buildConnectionKeyPayload(projectId),
        messageId,
        verdict: 'wrong',
        correctLabel,
        note,
    })
}

// action ∈ { archive, markRead, archiveAll, markAllRead, draftReply, createTask }.
// After a mutating action, force-refresh the summary so chip counts update; draftReply
// and createTask don't change the inbox, so they skip the refresh.
export async function performEmailLineAction(projectId, { action, messageIds, labelId, guidance } = {}) {
    if (!projectId || !action) return null
    const result = await runHttpsCallableFunction('emailLineActionSecondGen', {
        ...buildConnectionKeyPayload(projectId),
        action,
        messageIds,
        labelId,
        guidance,
    })
    if (action !== 'draftReply' && action !== 'createTask') {
        await fetchEmailLineSummary(projectId, { force: true })
    }
    return result
}
