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

// In-memory cache of the last-loaded message sections per merged label group, keyed
// by the group key (the stable lowercase display name from mergeLabelsAcrossConnections).
// Lets the label modal render its emails instantly on reopen while a fresh Gmail fetch
// runs in the background, instead of showing a spinner every time. Lives for the module
// lifetime (same as the Redux summary), so it survives modal close/reopen within a session.
const emailLineMessagesCache = new Map()

export function getCachedEmailLineSections(groupKey) {
    if (!groupKey) return null
    return emailLineMessagesCache.get(groupKey)?.sections || null
}

export function cacheEmailLineSections(groupKey, sections) {
    if (!groupKey) return
    if (!sections) {
        emailLineMessagesCache.delete(groupKey)
        return
    }
    emailLineMessagesCache.set(groupKey, { sections, cachedAt: Date.now() })
}

export async function listEmailLineMessages(projectId, labelId, { pageToken } = {}) {
    if (!projectId || !labelId) return { messages: [], nextPageToken: null }
    return runHttpsCallableFunction('listEmailLineMessagesSecondGen', {
        ...buildConnectionKeyPayload(projectId),
        labelId,
        pageToken,
    })
}

// Marks an email's label decision as wrong (optionally naming the correct label). When move
// context is provided the server also re-labels the email's Gmail thread directly, so it leaves
// the wrong label section immediately. `correctLabelName` is the target Gmail label name (resolved/
// created server-side), or null for "Inbox only"; `currentLabelId` is the label section the email
// is currently in. Returns the updated learned-rules block plus whether the thread was re-labeled.
export async function submitEmailLabelFeedback(
    projectId,
    { messageId, correctLabel, note, correctLabelName, currentLabelId } = {}
) {
    if (!projectId || !messageId) return null
    return runHttpsCallableFunction('submitEmailLabelFeedbackSecondGen', {
        ...buildConnectionKeyPayload(projectId),
        messageId,
        verdict: 'wrong',
        correctLabel,
        note,
        correctLabelName,
        currentLabelId,
    })
}

// Safety cap for background sweeps: the server processes up to 500 messages per
// call, so 20 rounds cover ~10k messages before we stop looping.
const MAX_SWEEP_ROUNDS = 20

// Fire-and-forget sweep (archiveAll / markAllRead) for one connection+label: the
// caller closes its modal immediately. The label's counts are zeroed optimistically
// and flagged `sweeping` (the chip renders a spinner); the server is called in a
// loop until it reports nothing remaining; a final forced summary fetch replaces
// the optimistic numbers with the real ones.
export async function performEmailLineSweepInBackground(projectId, labelId, action) {
    if (!projectId || !labelId || !action) return 0
    const summary = store.getState().emailLineSummaryByProject[projectId]
    // Snapshot the label so we can restore its count if the sweep turns out to clear
    // nothing (or fails): otherwise the optimistic zero would falsely read as "done".
    const originalLabel = (summary?.labels || []).find(label => label.labelId === labelId) || null
    if (summary) {
        const labels = (summary.labels || []).map(label =>
            label.labelId === labelId
                ? {
                      ...label,
                      sweeping: true,
                      unreadCount: 0,
                      ...(action === 'archiveAll' ? { threadCount: 0 } : {}),
                  }
                : label
        )
        store.dispatch(setEmailLineSummary(projectId, { ...summary, labels }))
    }
    let totalProcessed = 0
    let failed = false
    try {
        for (let round = 0; round < MAX_SWEEP_ROUNDS; round++) {
            const result = await runHttpsCallableFunction('emailLineActionSecondGen', {
                ...buildConnectionKeyPayload(projectId),
                action,
                labelId,
            })
            totalProcessed += Number(result?.processed) || 0
            if (!result?.remaining) break
        }
    } catch (error) {
        failed = true
        if (__DEV__) console.warn('[EmailLine] Background sweep failed:', error?.message || error)
    }
    // Empty (or failed) sweep: put the chip back the way it was so the still-present
    // emails don't silently disappear from the line. A sweep that did clear messages
    // keeps its optimistic zero until the forced refresh confirms the real counts.
    if ((failed || totalProcessed === 0) && originalLabel) {
        const current = store.getState().emailLineSummaryByProject[projectId]
        if (current) {
            const labels = (current.labels || []).map(label =>
                label.labelId === labelId
                    ? {
                          ...label,
                          sweeping: false,
                          threadCount: originalLabel.threadCount,
                          unreadCount: originalLabel.unreadCount,
                      }
                    : label
            )
            store.dispatch(setEmailLineSummary(projectId, { ...current, labels }))
        }
    }
    await fetchEmailLineSummary(projectId, { force: true })
    return totalProcessed
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
