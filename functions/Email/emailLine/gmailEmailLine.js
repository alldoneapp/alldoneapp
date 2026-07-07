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

// Counts threads (conversations) sitting in the inbox that carry the given label,
// read or unread — the number a user thinks of as "emails left to deal with".
async function countInboxThreads(gmail, labelId) {
    const request = listParamsForLabel(labelId)
    const response = await gmail.users.threads.list({ userId: 'me', ...request, maxResults: 100 })
    const threads = Array.isArray(response?.data?.threads) ? response.data.threads : []
    if (response?.data?.nextPageToken) {
        return Math.max(threads.length, Number(response?.data?.resultSizeEstimate || threads.length))
    }
    return threads.length
}

async function getGmailLabelSummary(userId, projectId) {
    const gmail = await getGmailClient(userId, projectId)
    const listResponse = await gmail.users.labels.list({ userId: 'me' })
    const rawLabels = Array.isArray(listResponse?.data?.labels) ? listResponse.data.labels : []

    const eligible = rawLabels.filter(isEligibleLabel).sort(compareLabels).slice(0, MAX_LABELS_TO_INSPECT)

    const detailed = await Promise.all(
        eligible.map(async label => {
            try {
                const [threadCount, unreadCount] = await Promise.all([
                    countInboxThreads(gmail, label.id),
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
    const listParams = listParamsForLabel(labelId)
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
                return buildThreadRow(detail?.data || {}, ref, labelId, emailAddress)
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

async function sweepLabel(userId, projectId, labelId, action) {
    const gmail = await getGmailClient(userId, projectId)
    const isArchive = action === 'archiveAll'
    const mutationLabelId = isArchive ? 'INBOX' : 'UNREAD'
    const { ids, hasMore } = await collectThreadMessageIds(gmail, listParamsForLabel(labelId), message =>
        (Array.isArray(message?.labelIds) ? message.labelIds : []).includes(mutationLabelId)
    )
    if (ids.length > 0) {
        await batchModifyMessages(gmail, ids, {
            removeLabelIds: [mutationLabelId],
        })
    }
    return { processed: ids.length, remaining: hasMore }
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
