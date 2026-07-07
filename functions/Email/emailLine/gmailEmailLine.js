'use strict'

const { google } = require('googleapis')
const { getAccessToken, getOAuth2Client } = require('../../GoogleOAuth/googleOAuthHandler')
const { parseListUnsubscribe, chunk } = require('./emailLineShared')

const MESSAGES_PER_PAGE = 25
const NO_LABEL_ID = '__NO_LABEL__'
const NO_LABEL_SEARCH_QUERY = 'has:nouserlabels'
// Hard cap on how many messages a single sweep invocation touches.
const SWEEP_LIMIT = 500
const BATCH_MODIFY_CHUNK = 100
// A user label can sit on a message that is NOT in the inbox (a sent reply, an older
// archived message) while the thread still lives in the inbox via a different message.
// Gmail's labelIds filter matches per-message, so a [label, INBOX] query misses those
// threads entirely. We instead resolve "in the inbox AND carrying the label" at the
// thread level by intersecting the label's thread ids with the inbox's thread ids.
// Both scans are capped so a huge label or inbox can't run unbounded.
const INBOX_THREAD_ID_LIMIT = 1000
const LABEL_THREAD_ID_LIMIT = 1000
const METADATA_HEADERS = ['Subject', 'From', 'Date', 'List-Unsubscribe', 'List-Unsubscribe-Post']

// Gmail system labels we never surface as chips. Everything else that is a
// user label (type === 'user') or the INBOX is eligible.
const EXCLUDED_SYSTEM_LABEL_IDS = new Set([
    'SPAM',
    'TRASH',
    'DRAFT',
    'DRAFTS',
    'CHAT',
    'SENT',
    'IMPORTANT',
    'STARRED',
    'UNREAD',
    'CATEGORY_PERSONAL',
    'CATEGORY_SOCIAL',
    'CATEGORY_PROMOTIONS',
    'CATEGORY_UPDATES',
    'CATEGORY_FORUMS',
])

// Cap how many labels we fan out inbox-unread count queries for, to keep the summary cheap.
const MAX_LABELS_TO_INSPECT = 25
const ALLDONE_LABEL_PREFIX = 'Alldone/'

async function getGmailClient(userId, projectId) {
    const accessToken = await getAccessToken(userId, projectId, 'gmail')
    const oauth2Client = getOAuth2Client()
    oauth2Client.setCredentials({ access_token: accessToken })
    return google.gmail({ version: 'v1', auth: oauth2Client })
}

function stripLabelPrefix(name = '') {
    if (typeof name !== 'string') return ''
    if (name.startsWith(ALLDONE_LABEL_PREFIX)) return name.slice(ALLDONE_LABEL_PREFIX.length)
    // Nested user labels ("Clients/Acme") read better as just the leaf name.
    const parts = name.split('/')
    return parts[parts.length - 1] || name
}

function isEligibleLabel(label) {
    if (!label || !label.id) return false
    if (label.id === 'INBOX') return true
    if (EXCLUDED_SYSTEM_LABEL_IDS.has(label.id)) return false
    if (label.id.startsWith('CATEGORY_')) return false
    return label.type === 'user'
}

// INBOX first, then Alldone/* labels, then alphabetical by display name.
function compareLabels(a, b) {
    if (a.id === 'INBOX') return -1
    if (b.id === 'INBOX') return 1
    const aAlldone = (a.name || '').startsWith(ALLDONE_LABEL_PREFIX)
    const bAlldone = (b.name || '').startsWith(ALLDONE_LABEL_PREFIX)
    if (aAlldone !== bAlldone) return aAlldone ? -1 : 1
    return String(a.name || '').localeCompare(String(b.name || ''))
}

// Counts unread messages that are BOTH in the inbox AND carry the given label.
// We only ever consider inbox mail, so a label whose messages were auto-archived
// (e.g. Ads) contributes only the copies still sitting in the inbox — matching
// exactly what the label modal lists.
async function countInboxUnread(gmail, labelId) {
    const request = isNoLabelId(labelId)
        ? { labelIds: ['INBOX', 'UNREAD'], q: NO_LABEL_SEARCH_QUERY }
        : { labelIds: labelId === 'INBOX' ? ['INBOX', 'UNREAD'] : [labelId, 'INBOX', 'UNREAD'] }
    const response = await gmail.users.messages.list({ userId: 'me', ...request, maxResults: 100 })
    const messages = Array.isArray(response?.data?.messages) ? response.data.messages : []
    // Exact for the realistic inbox range; if a page overflows, fall back to the
    // estimate as a floor so a very large count isn't understated.
    if (response?.data?.nextPageToken) {
        return Math.max(messages.length, Number(response?.data?.resultSizeEstimate || messages.length))
    }
    return messages.length
}

// True for a normal user label (not the inbox itself, not the synthetic "no label"
// bucket) — the case where the label and the inbox status can live on different
// messages of the same thread, so thread-level resolution is required.
function isUserLabelBucket(labelId) {
    return !!labelId && labelId !== 'INBOX' && !isNoLabelId(labelId)
}

function threadHasInboxMessage(threadData) {
    const messages = Array.isArray(threadData?.messages) ? threadData.messages : []
    return messages.some(message => (Array.isArray(message?.labelIds) ? message.labelIds : []).includes('INBOX'))
}

// Thread ids currently in the inbox (ids only, no per-message fetch). Reused across a
// summary's label counts and by the sweep, so we compute it once and intersect.
async function collectInboxThreadIds(gmail, limit = INBOX_THREAD_ID_LIMIT) {
    const ids = new Set()
    let pageToken
    do {
        const response = await gmail.users.threads.list({
            userId: 'me',
            labelIds: ['INBOX'],
            maxResults: 100,
            pageToken,
        })
        const threads = Array.isArray(response?.data?.threads) ? response.data.threads : []
        for (const thread of threads) {
            if (thread?.id) ids.add(thread.id)
        }
        pageToken = response?.data?.nextPageToken || null
    } while (pageToken && ids.size < limit)
    return ids
}

// Thread ids that carry the given user label on ANY message (ids only). A sent reply
// tagged with the label keeps its thread in this set even though the reply is not in
// the inbox — which is exactly the case the old [label, INBOX] query dropped.
async function collectLabelThreadIds(gmail, labelId, limit = LABEL_THREAD_ID_LIMIT) {
    const ids = []
    let pageToken
    do {
        const response = await gmail.users.threads.list({
            userId: 'me',
            labelIds: [labelId],
            maxResults: 100,
            pageToken,
        })
        const threads = Array.isArray(response?.data?.threads) ? response.data.threads : []
        for (const thread of threads) {
            if (thread?.id) ids.push(thread.id)
        }
        pageToken = response?.data?.nextPageToken || null
    } while (pageToken && ids.length < limit)
    return { ids, hasMore: !!pageToken }
}

// Counts threads (conversations) sitting in the inbox that carry the given label,
// read or unread — the number a user thinks of as "emails left to deal with".
// `inboxThreadIds` is the shared inbox thread-id set (see collectInboxThreadIds);
// a user-label thread counts when it appears in that set (thread-level match).
async function countInboxThreads(gmail, labelId, inboxThreadIds) {
    if (labelId === 'INBOX') {
        return inboxThreadIds ? inboxThreadIds.size : 0
    }
    if (isNoLabelId(labelId)) {
        // "No user labels" is a per-thread property Gmail can filter directly, so this
        // bucket stays a single scoped query.
        const response = await gmail.users.threads.list({
            userId: 'me',
            labelIds: ['INBOX'],
            q: NO_LABEL_SEARCH_QUERY,
            maxResults: 100,
        })
        const threads = Array.isArray(response?.data?.threads) ? response.data.threads : []
        if (response?.data?.nextPageToken) {
            return Math.max(threads.length, Number(response?.data?.resultSizeEstimate || threads.length))
        }
        return threads.length
    }
    if (!inboxThreadIds || inboxThreadIds.size === 0) return 0
    const { ids: labelThreadIds } = await collectLabelThreadIds(gmail, labelId)
    let count = 0
    for (const id of labelThreadIds) {
        if (inboxThreadIds.has(id)) count += 1
    }
    return count
}

async function getGmailLabelSummary(userId, projectId) {
    const gmail = await getGmailClient(userId, projectId)
    const listResponse = await gmail.users.labels.list({ userId: 'me' })
    const rawLabels = Array.isArray(listResponse?.data?.labels) ? listResponse.data.labels : []

    const eligible = rawLabels.filter(isEligibleLabel).sort(compareLabels).slice(0, MAX_LABELS_TO_INSPECT)

    // Resolve the inbox thread-id set once and intersect every user label against it,
    // so labels whose only inbox presence is via a non-inbox (sent) message still count.
    const inboxThreadIds = await collectInboxThreadIds(gmail)

    const detailed = await Promise.all(
        eligible.map(async label => {
            try {
                const [threadCount, unreadCount] = await Promise.all([
                    countInboxThreads(gmail, label.id, inboxThreadIds),
                    countInboxUnread(gmail, label.id),
                ])
                return {
                    labelId: label.id,
                    name: label.name || label.id,
                    displayName: label.id === 'INBOX' ? 'Inbox' : stripLabelPrefix(label.name),
                    threadCount,
                    unreadCount,
                    kind: label.id === 'INBOX' ? 'inbox' : 'user',
                }
            } catch (error) {
                return null
            }
        })
    )
    const noLabel = await buildNoLabelSummary(gmail)

    // Keep only labels with inbox threads, but always keep INBOX so the line
    // can render its Inbox Zero state.
    const labels = detailed.filter(Boolean).filter(label => label.threadCount > 0 || label.labelId === 'INBOX')
    if (noLabel.threadCount > 0) labels.push(noLabel)

    const inboxUnread = labels.find(label => label.labelId === 'INBOX')?.unreadCount || 0

    return {
        labels,
        inboxUnread,
    }
}

function getHeader(headers, name) {
    if (!Array.isArray(headers)) return ''
    const lower = name.toLowerCase()
    const match = headers.find(header => String(header.name || '').toLowerCase() === lower)
    return match ? match.value || '' : ''
}

function decodeBase64Url(data = '') {
    if (!data) return ''
    return Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

// Walks a Gmail payload tree for the first text/plain part.
function extractPlainTextBody(payload) {
    if (!payload) return ''
    if (payload.mimeType === 'text/plain' && payload.body?.data) return decodeBase64Url(payload.body.data)
    if (Array.isArray(payload.parts)) {
        for (const part of payload.parts) {
            const text = extractPlainTextBody(part)
            if (text) return text
        }
    }
    return ''
}

// Fetches the subject/from/body of a message so a reply can be composed.
async function getMessageContext(userId, projectId, messageId) {
    const gmail = await getGmailClient(userId, projectId)
    const detail = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' })
    const data = detail?.data || {}
    const headers = data.payload?.headers || []
    const body = extractPlainTextBody(data.payload) || data.snippet || ''
    return {
        subject: getHeader(headers, 'Subject'),
        from: getHeader(headers, 'From'),
        snippet: data.snippet || '',
        body: body.slice(0, 4000),
        threadId: data.threadId || '',
    }
}

// Deep link that opens a specific message in Gmail for the connected account.
function buildGmailMessageUrl(emailAddress, messageId) {
    const continueUrl = `https://mail.google.com/mail/u/0/${
        emailAddress ? `?authuser=${encodeURIComponent(emailAddress)}` : ''
    }#all/${encodeURIComponent(messageId)}`
    if (!emailAddress) return continueUrl
    return `https://accounts.google.com/AccountChooser?Email=${encodeURIComponent(
        emailAddress
    )}&continue=${encodeURIComponent(continueUrl)}&service=mail`
}

function isNoLabelId(labelId) {
    return labelId === NO_LABEL_ID
}

function listParamsForLabel(labelId) {
    if (isNoLabelId(labelId)) return { labelIds: ['INBOX'], q: NO_LABEL_SEARCH_QUERY }
    if (!labelId || labelId === 'INBOX') return { labelIds: ['INBOX'] }
    return { labelIds: [labelId, 'INBOX'] }
}

// Thread-list params for surfacing a label's inbox threads. A user label is matched on
// the label alone (thread-level) so threads that carry it on a non-inbox message still
// come back; the caller drops any that have no inbox message. The inbox and no-label
// buckets keep their already-inbox-scoped queries.
function threadListParamsForLabel(labelId) {
    if (isUserLabelBucket(labelId)) return { labelIds: [labelId] }
    return listParamsForLabel(labelId)
}

async function buildNoLabelSummary(gmail) {
    try {
        const [threadCount, unreadCount] = await Promise.all([
            countInboxThreads(gmail, NO_LABEL_ID),
            countInboxUnread(gmail, NO_LABEL_ID),
        ])
        return {
            labelId: NO_LABEL_ID,
            name: 'No label',
            displayName: 'No label',
            threadCount,
            unreadCount,
            kind: 'no_label',
        }
    } catch (error) {
        return {
            labelId: NO_LABEL_ID,
            name: 'No label',
            displayName: 'No label',
            threadCount: 0,
            unreadCount: 0,
            kind: 'no_label',
        }
    }
}

function getMessageTimestamp(message = {}) {
    const internalDate = Number(message.internalDate || 0)
    if (Number.isFinite(internalDate) && internalDate > 0) return internalDate
    const headerDate = Date.parse(getHeader(message.payload?.headers || [], 'Date'))
    return Number.isFinite(headerDate) ? headerDate : 0
}

function pickThreadDisplayMessage(messages = [], labelId) {
    const sorted = [...messages].sort((a, b) => getMessageTimestamp(b) - getMessageTimestamp(a))
    const hasLabel = message => {
        const labelIds = Array.isArray(message.labelIds) ? message.labelIds : []
        return labelId === 'INBOX' ? labelIds.includes('INBOX') : labelIds.includes(labelId)
    }
    const isInbox = message => (Array.isArray(message.labelIds) ? message.labelIds : []).includes('INBOX')

    return (
        sorted.find(message => hasLabel(message) && isInbox(message)) ||
        sorted.find(isInbox) ||
        sorted.find(hasLabel) ||
        sorted[0] ||
        null
    )
}

function buildThreadRow(thread = {}, threadRef = {}, labelId, emailAddress) {
    const threadMessages = Array.isArray(thread.messages) ? thread.messages : []
    const messageIds = threadMessages.map(message => message.id).filter(Boolean)
    const displayMessage = pickThreadDisplayMessage(threadMessages, labelId)
    if (!displayMessage) return null

    const headers = displayMessage.payload?.headers || []
    const unsubscribeSource =
        threadMessages.find(message => getHeader(message.payload?.headers || [], 'List-Unsubscribe')) || displayMessage

    return {
        messageId: displayMessage.id || threadRef.id,
        messageIds,
        threadId: thread.id || displayMessage.threadId || threadRef.id || '',
        subject: getHeader(headers, 'Subject'),
        from: getHeader(headers, 'From'),
        date: getHeader(headers, 'Date'),
        snippet: displayMessage.snippet || thread.snippet || '',
        isUnread: threadMessages.some(message =>
            (Array.isArray(message.labelIds) ? message.labelIds : []).includes('UNREAD')
        ),
        webUrl: buildGmailMessageUrl(emailAddress, displayMessage.id || threadRef.id),
        needsReply: false,
        unsubscribe: parseListUnsubscribe(getHeader(unsubscribeSource.payload?.headers || [], 'List-Unsubscribe')),
    }
}

async function listMessagesForLabel(userId, projectId, labelId, { pageToken, emailAddress } = {}) {
    const gmail = await getGmailClient(userId, projectId)
    const listParams = threadListParamsForLabel(labelId)
    const listResponse = await gmail.users.threads.list({
        userId: 'me',
        ...listParams,
        maxResults: MESSAGES_PER_PAGE,
        pageToken: pageToken || undefined,
    })

    const threadRefs = Array.isArray(listResponse?.data?.threads) ? listResponse.data.threads : []
    const nextPageToken = listResponse?.data?.nextPageToken || null

    const messages = await Promise.all(
        threadRefs.map(async ref => {
            try {
                const detail = await gmail.users.threads.get({
                    userId: 'me',
                    id: ref.id,
                    format: 'metadata',
                    metadataHeaders: METADATA_HEADERS,
                })
                const threadData = detail?.data || {}
                // A user label is queried label-only, so it can return threads whose
                // label sits on a message that has since left the inbox. The email line
                // only surfaces threads still in the inbox, so drop the rest.
                if (isUserLabelBucket(labelId) && !threadHasInboxMessage(threadData)) return null
                return buildThreadRow(threadData, ref, labelId, emailAddress)
            } catch (error) {
                return null
            }
        })
    )

    return {
        messages: messages.filter(Boolean),
        nextPageToken,
    }
}

// Ids of the newest unread inbox messages — a single list call, no per-message fetches.
async function getUnreadInboxMessageIds(userId, projectId, limit = 100) {
    const gmail = await getGmailClient(userId, projectId)
    const listResponse = await gmail.users.messages.list({
        userId: 'me',
        labelIds: ['INBOX', 'UNREAD'],
        maxResults: limit,
    })
    const refs = Array.isArray(listResponse?.data?.messages) ? listResponse.data.messages : []
    return refs.map(ref => ref.id).filter(Boolean)
}

// Newest unread inbox messages (subject/from/snippet only) for the needs-reply scan.
async function getUnreadInboxMessages(userId, projectId, limit = 15) {
    const gmail = await getGmailClient(userId, projectId)
    const listResponse = await gmail.users.messages.list({
        userId: 'me',
        labelIds: ['INBOX', 'UNREAD'],
        maxResults: limit,
    })
    const refs = Array.isArray(listResponse?.data?.messages) ? listResponse.data.messages : []
    const messages = await Promise.all(
        refs.map(async ref => {
            try {
                const detail = await gmail.users.messages.get({
                    userId: 'me',
                    id: ref.id,
                    format: 'metadata',
                    metadataHeaders: ['Subject', 'From'],
                })
                const data = detail?.data || {}
                const headers = data.payload?.headers || []
                return {
                    messageId: data.id || ref.id,
                    subject: getHeader(headers, 'Subject'),
                    from: getHeader(headers, 'From'),
                    snippet: data.snippet || '',
                }
            } catch (error) {
                return null
            }
        })
    )
    return messages.filter(Boolean)
}

async function batchModifyMessages(gmail, messageIds, requestBody) {
    for (const ids of chunk(messageIds, BATCH_MODIFY_CHUNK)) {
        await gmail.users.messages.batchModify({
            userId: 'me',
            requestBody: { ids, ...requestBody },
        })
    }
}

async function archiveMessages(userId, projectId, messageIds) {
    if (!Array.isArray(messageIds) || messageIds.length === 0) return { processed: 0 }
    const gmail = await getGmailClient(userId, projectId)
    await batchModifyMessages(gmail, messageIds, { removeLabelIds: ['INBOX'] })
    return { processed: messageIds.length }
}

async function markMessagesRead(userId, projectId, messageIds) {
    if (!Array.isArray(messageIds) || messageIds.length === 0) return { processed: 0 }
    const gmail = await getGmailClient(userId, projectId)
    await batchModifyMessages(gmail, messageIds, { removeLabelIds: ['UNREAD'] })
    return { processed: messageIds.length }
}

// The email line lists Gmail threads, not individual messages. Gmail can return a
// thread for [label, INBOX] even when one message has the user label and a newer
// sibling has INBOX, so sweeps must mutate inbox/unread messages across the
// whole visible thread.
async function collectThreadMessageIds(gmail, listParams, shouldModifyMessage) {
    const ids = []
    const seen = new Set()
    let pageToken
    let stoppedAtLimit = false

    do {
        const response = await gmail.users.threads.list({
            userId: 'me',
            ...listParams,
            maxResults: BATCH_MODIFY_CHUNK,
            pageToken,
        })
        const refs = Array.isArray(response?.data?.threads) ? response.data.threads : []
        const nextPageToken = response?.data?.nextPageToken || null
        const threads = await Promise.all(
            refs.map(async ref => {
                try {
                    const detail = await gmail.users.threads.get({
                        userId: 'me',
                        id: ref.id,
                        format: 'minimal',
                    })
                    return detail?.data || null
                } catch (error) {
                    return null
                }
            })
        )

        for (const thread of threads) {
            const messages = Array.isArray(thread?.messages) ? thread.messages : []
            for (const message of messages) {
                if (ids.length >= SWEEP_LIMIT) {
                    stoppedAtLimit = true
                    break
                }
                const id = message?.id
                if (!id || seen.has(id) || !shouldModifyMessage(message)) continue
                seen.add(id)
                ids.push(id)
            }
            if (stoppedAtLimit) break
        }

        pageToken = nextPageToken
    } while (!stoppedAtLimit && pageToken && ids.length < SWEEP_LIMIT)

    return { ids, hasMore: stoppedAtLimit || !!pageToken }
}

// Fetches the given threads (minimal) and collects the ids of their messages that pass
// the predicate, capped at SWEEP_LIMIT. Threads are fetched in batches to bound the
// number of concurrent Gmail calls.
async function collectMessageIdsFromThreads(gmail, threadIds, shouldModifyMessage) {
    const ids = []
    const seen = new Set()
    for (const batch of chunk(threadIds, BATCH_MODIFY_CHUNK)) {
        if (ids.length >= SWEEP_LIMIT) break
        const threads = await Promise.all(
            batch.map(async id => {
                try {
                    const detail = await gmail.users.threads.get({ userId: 'me', id, format: 'minimal' })
                    return detail?.data || null
                } catch (error) {
                    return null
                }
            })
        )
        for (const thread of threads) {
            const messages = Array.isArray(thread?.messages) ? thread.messages : []
            for (const message of messages) {
                if (ids.length >= SWEEP_LIMIT) break
                const id = message?.id
                if (!id || seen.has(id) || !shouldModifyMessage(message)) continue
                seen.add(id)
                ids.push(id)
            }
            if (ids.length >= SWEEP_LIMIT) break
        }
    }
    return ids
}

async function sweepLabel(userId, projectId, labelId, action) {
    const gmail = await getGmailClient(userId, projectId)
    const isArchive = action === 'archiveAll'
    const mutationLabelId = isArchive ? 'INBOX' : 'UNREAD'
    const matchesMutation = message =>
        (Array.isArray(message?.labelIds) ? message.labelIds : []).includes(mutationLabelId)

    // The inbox itself and the no-label bucket are defined by being in the inbox, so
    // their scoped [INBOX] (+ has:nouserlabels) query already selects the right threads.
    if (!isUserLabelBucket(labelId)) {
        const { ids, hasMore } = await collectThreadMessageIds(gmail, listParamsForLabel(labelId), matchesMutation)
        if (ids.length > 0) await batchModifyMessages(gmail, ids, { removeLabelIds: [mutationLabelId] })
        return { processed: ids.length, remaining: hasMore }
    }

    // A user label can sit on a non-inbox message (a sent reply), so resolve the threads
    // that are BOTH in the inbox and carry the label (thread-level intersection), then
    // strip INBOX/UNREAD from their inbox messages. This is what makes "Archive all"
    // work on conversation threads whose label is only on a sent reply.
    const [inboxThreadIds, { ids: labelThreadIds }] = await Promise.all([
        collectInboxThreadIds(gmail),
        collectLabelThreadIds(gmail, labelId),
    ])
    const targetThreadIds = labelThreadIds.filter(id => inboxThreadIds.has(id))
    const cappedThreadIds = targetThreadIds.slice(0, SWEEP_LIMIT)
    const ids = await collectMessageIdsFromThreads(gmail, cappedThreadIds, matchesMutation)
    if (ids.length > 0) await batchModifyMessages(gmail, ids, { removeLabelIds: [mutationLabelId] })
    // Archived threads leave the inbox, so a follow-up round re-scans a smaller set and
    // converges; flag more work when we hit either cap.
    const remaining = ids.length >= SWEEP_LIMIT || targetThreadIds.length > cappedThreadIds.length
    return { processed: ids.length, remaining }
}

module.exports = {
    getGmailClient,
    getGmailLabelSummary,
    listMessagesForLabel,
    archiveMessages,
    markMessagesRead,
    sweepLabel,
    getMessageContext,
    getUnreadInboxMessageIds,
    getUnreadInboxMessages,
    stripLabelPrefix,
    buildGmailMessageUrl,
    NO_LABEL_ID,
    EXCLUDED_SYSTEM_LABEL_IDS,
    MAX_LABELS_TO_INSPECT,
    SWEEP_LIMIT,
}
