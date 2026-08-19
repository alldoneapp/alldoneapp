import store from '../../../redux/store'
import { setEmailLineSummary, setEmailLineLoading } from '../../../redux/actions'
import { runHttpsCallableFunction } from '../firestore'
import { buildConnectionKeyPayload } from '../../IntegrationProviders'
import { translate } from '../../../i18n/TranslationService'

// The server raises a typed `EMAIL_AUTH_EXPIRED` when the account's OAuth token cannot be
// refreshed any more (revoked / expired refresh token, consent withdrawn). It reaches the
// client as a callable `failed-precondition` whose message carries the code.
export function isEmailAuthExpiredError(error) {
    return String(error?.message || '').includes('EMAIL_AUTH_EXPIRED')
}

// Flags the connection's cached summary as expired so the Email line and the Integrations
// screen immediately render their existing "Reconnect" state instead of silently failing.
function markSummaryAuthExpired(projectId) {
    const current = store.getState().emailLineSummaryByProject[projectId]
    store.dispatch(
        setEmailLineSummary(projectId, {
            provider: '',
            emailAddress: '',
            labels: [],
            needsReplyCount: 0,
            needsReplyByMessageId: {},
            inboxZero: false,
            ...(current || {}),
            connected: true,
            authExpired: true,
            scannedAt: Date.now(),
        })
    )
}

// Turns the raw `EMAIL_AUTH_EXPIRED` code into something a person can act on. Callers alert
// `error.message`, so without this the user was shown the bare error code (AT-2195).
function toEmailAuthExpiredError(error) {
    const friendly = new Error(
        translate('Your email connection expired. Please reconnect it in Settings > Integrations.')
    )
    friendly.code = 'EMAIL_AUTH_EXPIRED'
    friendly.authExpired = true
    friendly.cause = error
    return friendly
}

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
        if (isEmailAuthExpiredError(error)) {
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

// The summary is normally the chip-count source of truth. Opening a chip performs a fresher,
// label-scoped provider query though, so fold that query's authoritative total back into the
// existing summary without replacing unrelated labels or background-update fields.
export function reconcileEmailLineLabelCount(projectId, labelId, threadCount) {
    if (!projectId || !labelId || !Number.isFinite(threadCount) || threadCount < 0) return false
    const summary = store.getState().emailLineSummaryByProject?.[projectId]
    if (!summary) return false
    let matched = false
    let changed = false
    const labels = (summary.labels || []).map(label => {
        if (label.labelId !== labelId) return label
        matched = true
        if (label.threadCount === threadCount) return label
        changed = true
        return { ...label, threadCount }
    })
    if (!matched || !changed) return false
    store.dispatch(setEmailLineSummary(projectId, { ...summary, labels }))
    return true
}

// In-memory cache of the last-loaded message sections per merged label group, keyed
// by the group key (the stable lowercase display name from mergeLabelsAcrossConnections).
// Lets the label modal render its emails instantly on reopen while a fresh Gmail fetch
// runs in the background, instead of showing a spinner every time. Lives for the module
// lifetime (same as the Redux summary), so it survives modal close/reopen within a session.
const emailLineMessagesCache = new Map()
const emailLineMessagesInFlight = new Map()

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
    const requestKey = `${projectId}:${labelId}:${pageToken || ''}`
    const inFlight = emailLineMessagesInFlight.get(requestKey)
    if (inFlight) return inFlight
    const startedAt = Date.now()
    const request = (async () => {
        try {
            const result = await runHttpsCallableFunction('listEmailLineMessagesSecondGen', {
                ...buildConnectionKeyPayload(projectId),
                labelId,
                pageToken,
            })
            console.log('[emailLineTiming] client', {
                totalMs: Date.now() - startedAt,
                page: pageToken ? 'next' : 'first',
                messageCount: result?.messages?.length || 0,
            })
            return result
        } catch (error) {
            console.log('[emailLineTiming] clientError', {
                totalMs: Date.now() - startedAt,
                page: pageToken ? 'next' : 'first',
                code: error?.code || 'unknown',
            })
            throw error
        } finally {
            if (emailLineMessagesInFlight.get(requestKey) === request) emailLineMessagesInFlight.delete(requestKey)
        }
    })()
    emailLineMessagesInFlight.set(requestKey, request)
    return request
}

// Marks an email's label decision as wrong (optionally naming the correct label). When move
// context is provided the server also re-labels the email's Gmail thread directly, so it leaves
// the wrong label section immediately. `correctLabelName` is the target Gmail label name (resolved/
// created server-side), or null for "Inbox only"; `currentLabelId` is the label section the email
// is currently in. Returns the updated learned-rules block plus whether the thread was re-labeled.
export async function submitEmailLabelFeedback(
    projectId,
    { messageId, correctLabel, note, correctLabelName, currentLabelId, correctFollowUpType } = {}
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
        correctFollowUpType,
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
        // A sweep is fire-and-forget, so it cannot alert. Flagging the summary is what makes
        // the reconnect state appear after a background sweep hit a dead connection.
        if (isEmailAuthExpiredError(error)) markSummaryAuthExpired(projectId)
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

// Reads the current mailbox state (exists / unread / inInbox) of specific messages. Read-only, so
// unlike performEmailLineAction it never refreshes the summary — it is the lookup behind the
// email-comment read sync (AT-2376), which runs in the background and must stay invisible.
export async function fetchEmailLineMessageStates(projectId, messageIds = []) {
    const ids = (messageIds || []).filter(Boolean)
    if (!projectId || ids.length === 0) return []
    try {
        const result = await runHttpsCallableFunction('emailLineActionSecondGen', {
            ...buildConnectionKeyPayload(projectId),
            action: 'getMessageStates',
            messageIds: ids,
        })
        return Array.isArray(result?.states) ? result.states : []
    } catch (error) {
        // A dead connection must light up the same reconnect state the other calls use, but this
        // caller is a background sync: it reports nothing rather than alerting.
        if (isEmailAuthExpiredError(error)) markSummaryAuthExpired(projectId)
        throw error
    }
}

// action ∈ { archive, markRead, archiveAll, markAllRead, draftReply, createTask }.
// After a mutating action, force-refresh the summary so chip counts update; draftReply
// and createTask don't change the inbox, so they skip the refresh.
export async function performEmailLineAction(
    projectId,
    { action, messageIds, labelId, labelName, guidance, sourceProjectId, sourceTaskId } = {}
) {
    if (!projectId || !action) return null
    let result
    try {
        result = await runHttpsCallableFunction('emailLineActionSecondGen', {
            ...buildConnectionKeyPayload(projectId),
            action,
            messageIds,
            labelId,
            labelName,
            guidance,
            sourceProjectId,
            sourceTaskId,
        })
    } catch (error) {
        // The server already tried a forced token refresh and a single retry, so this means
        // the account genuinely needs a new consent. Light up the reconnect state and
        // re-throw something the user can act on rather than the raw code.
        if (isEmailAuthExpiredError(error)) {
            markSummaryAuthExpired(projectId)
            throw toEmailAuthExpiredError(error)
        }
        throw error
    }
    if (action !== 'draftReply' && action !== 'createTask') {
        await fetchEmailLineSummary(projectId, { force: true })
    }
    return result
}
