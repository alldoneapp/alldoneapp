'use strict'

const { buildQuery, encodePath, getMicrosoftGraphClient } = require('../../MicrosoftGraph/graphClient')
const { getConnectedMicrosoftEmailAccounts } = require('../providers/microsoftEmailProvider')
const { parseListUnsubscribe, chunk } = require('./emailLineShared')

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0'
const MESSAGES_PER_PAGE = 25
const SWEEP_LIMIT = 500
const GRAPH_BATCH_CHUNK = 20
const MESSAGE_SELECT =
    'id,conversationId,subject,from,receivedDateTime,bodyPreview,isRead,webLink,internetMessageHeaders'

// Well-known Outlook folders we never surface as chips.
const EXCLUDED_WELL_KNOWN_FOLDERS = new Set([
    'junkemail',
    'deleteditems',
    'drafts',
    'sentitems',
    'outbox',
    'archive',
    'conversationhistory',
    'syncissues',
    'recoverableitemsdeletions',
])

const MAX_FOLDERS_TO_INSPECT = 25

function resolveAccountForProject(accounts, projectId) {
    if (!Array.isArray(accounts) || accounts.length === 0) return null
    return (
        accounts.find(account => account.projectId === projectId) ||
        accounts.find(account => account.emailDefault) ||
        accounts[0]
    )
}

function isEligibleFolder(folder) {
    if (!folder || !folder.id) return false
    const wellKnownName = String(folder.wellKnownName || '').toLowerCase()
    if (wellKnownName && EXCLUDED_WELL_KNOWN_FOLDERS.has(wellKnownName)) return false
    return true
}

// Inbox first, then alphabetical by display name.
function compareFolders(a, b) {
    const aInbox = String(a.wellKnownName || '').toLowerCase() === 'inbox'
    const bInbox = String(b.wellKnownName || '').toLowerCase() === 'inbox'
    if (aInbox !== bInbox) return aInbox ? -1 : 1
    return String(a.displayName || '').localeCompare(String(b.displayName || ''))
}

async function getMicrosoftLabelSummary(userId, projectId) {
    const accounts = await getConnectedMicrosoftEmailAccounts(userId)
    const account = resolveAccountForProject(accounts, projectId)
    if (!account) throw new Error('No connected Microsoft email account was found for this project.')

    const client = await getMicrosoftGraphClient(userId, account.projectId, 'email')
    const response = await client.request(
        `/me/mailFolders${buildQuery({
            $top: 100,
            $select: 'id,displayName,wellKnownName,unreadItemCount,totalItemCount',
        })}`
    )

    const rawFolders = Array.isArray(response?.value) ? response.value : []
    const eligible = rawFolders.filter(isEligibleFolder).sort(compareFolders).slice(0, MAX_FOLDERS_TO_INSPECT)

    const labels = eligible
        .map(folder => {
            const isInbox = String(folder.wellKnownName || '').toLowerCase() === 'inbox'
            return {
                labelId: folder.id,
                name: folder.displayName || folder.id,
                displayName: isInbox ? 'Inbox' : folder.displayName || folder.id,
                unreadCount: Number(folder.unreadItemCount || 0),
                kind: isInbox ? 'inbox' : 'folder',
            }
        })
        .filter(label => label.unreadCount > 0 || label.kind === 'inbox')

    const inboxUnread = labels.find(label => label.kind === 'inbox')?.unreadCount || 0

    return {
        labels,
        inboxUnread,
        emailAddress: account.emailAddress || account.gmailEmail || '',
    }
}

function getInternetHeader(headers, name) {
    if (!Array.isArray(headers)) return ''
    const lower = name.toLowerCase()
    const match = headers.find(header => String(header.name || '').toLowerCase() === lower)
    return match ? match.value || '' : ''
}

function normalizeListRow(message = {}) {
    return {
        messageId: message.id || '',
        threadId: message.conversationId || '',
        subject: message.subject || '',
        from: message.from?.emailAddress?.address || '',
        date: message.receivedDateTime || '',
        snippet: message.bodyPreview || '',
        isUnread: message.isRead === false,
        webUrl: message.webLink || '',
        needsReply: false,
        unsubscribe: parseListUnsubscribe(getInternetHeader(message.internetMessageHeaders, 'List-Unsubscribe')),
    }
}

// Graph @odata.nextLink is an absolute URL; strip the root so graphClient can
// re-request it as a path.
function nextLinkToPath(nextLink) {
    if (!nextLink || typeof nextLink !== 'string') return null
    return nextLink.startsWith(GRAPH_ROOT) ? nextLink.slice(GRAPH_ROOT.length) : nextLink
}

async function getClientForProject(userId, projectId) {
    const accounts = await getConnectedMicrosoftEmailAccounts(userId)
    const account = resolveAccountForProject(accounts, projectId)
    if (!account) throw new Error('No connected Microsoft email account was found for this project.')
    const client = await getMicrosoftGraphClient(userId, account.projectId, 'email')
    return { client, account }
}

async function listMessagesForLabel(userId, projectId, folderId, { pageToken } = {}) {
    const { client } = await getClientForProject(userId, projectId)
    const path =
        pageToken ||
        `/me/mailFolders/${encodePath(folderId)}/messages${buildQuery({
            $select: MESSAGE_SELECT,
            $orderby: 'receivedDateTime desc',
            $top: MESSAGES_PER_PAGE,
        })}`

    const response = await client.request(path)
    const value = Array.isArray(response?.value) ? response.value : []
    return {
        messages: value.map(normalizeListRow),
        nextPageToken: nextLinkToPath(response?.['@odata.nextLink']),
    }
}

// Runs a set of Graph requests in $batch chunks of 20.
async function runGraphBatch(client, requests) {
    for (const group of chunk(requests, GRAPH_BATCH_CHUNK)) {
        const body = {
            requests: group.map((request, index) => ({
                id: String(index + 1),
                method: request.method,
                url: request.url,
                ...(request.body ? { body: request.body, headers: { 'Content-Type': 'application/json' } } : {}),
            })),
        }
        await client.request('/$batch', { method: 'POST', body: JSON.stringify(body) })
    }
}

async function archiveMessages(userId, projectId, messageIds) {
    if (!Array.isArray(messageIds) || messageIds.length === 0) return { processed: 0 }
    const { client } = await getClientForProject(userId, projectId)
    const requests = messageIds.map(id => ({
        method: 'POST',
        url: `/me/messages/${encodePath(id)}/move`,
        body: { destinationId: 'archive' },
    }))
    await runGraphBatch(client, requests)
    return { processed: messageIds.length }
}

async function markMessagesRead(userId, projectId, messageIds) {
    if (!Array.isArray(messageIds) || messageIds.length === 0) return { processed: 0 }
    const { client } = await getClientForProject(userId, projectId)
    const requests = messageIds.map(id => ({
        method: 'PATCH',
        url: `/me/messages/${encodePath(id)}`,
        body: { isRead: true },
    }))
    await runGraphBatch(client, requests)
    return { processed: messageIds.length }
}

async function collectFolderMessageIds(client, folderId, { unreadOnly } = {}) {
    const ids = []
    let path = `/me/mailFolders/${encodePath(folderId)}/messages${buildQuery({
        $select: 'id',
        $top: 100,
        $filter: unreadOnly ? 'isRead eq false' : undefined,
    })}`
    let hasMore = false
    while (path) {
        const response = await client.request(path)
        const value = Array.isArray(response?.value) ? response.value : []
        value.forEach(message => ids.push(message.id))
        const next = nextLinkToPath(response?.['@odata.nextLink'])
        if (ids.length >= SWEEP_LIMIT) {
            hasMore = !!next
            break
        }
        path = next
    }
    return { ids: ids.slice(0, SWEEP_LIMIT), hasMore }
}

async function getUnreadInboxMessages(userId, projectId, limit = 15) {
    const { client } = await getClientForProject(userId, projectId)
    const response = await client.request(
        `/me/mailFolders/inbox/messages${buildQuery({
            $filter: 'isRead eq false',
            $orderby: 'receivedDateTime desc',
            $top: limit,
            $select: 'id,subject,from,bodyPreview',
        })}`
    )
    const value = Array.isArray(response?.value) ? response.value : []
    return value.map(message => ({
        messageId: message.id || '',
        subject: message.subject || '',
        from: message.from?.emailAddress?.address || '',
        snippet: message.bodyPreview || '',
    }))
}

async function getMessageContext(userId, projectId, messageId) {
    const { client } = await getClientForProject(userId, projectId)
    const message = await client.request(
        `/me/messages/${encodePath(messageId)}${buildQuery({ $select: 'subject,from,body,bodyPreview' })}`
    )
    const body = message.body?.content || message.bodyPreview || ''
    return {
        subject: message.subject || '',
        from: message.from?.emailAddress?.address || '',
        snippet: message.bodyPreview || '',
        body: String(body).slice(0, 4000),
    }
}

async function sweepLabel(userId, projectId, folderId, action) {
    const { client } = await getClientForProject(userId, projectId)
    const isArchive = action === 'archiveAll'
    const { ids, hasMore } = await collectFolderMessageIds(client, folderId, { unreadOnly: !isArchive })
    if (ids.length > 0) {
        const requests = ids.map(id =>
            isArchive
                ? { method: 'POST', url: `/me/messages/${encodePath(id)}/move`, body: { destinationId: 'archive' } }
                : { method: 'PATCH', url: `/me/messages/${encodePath(id)}`, body: { isRead: true } }
        )
        await runGraphBatch(client, requests)
    }
    return { processed: ids.length, remaining: hasMore }
}

module.exports = {
    getMicrosoftLabelSummary,
    listMessagesForLabel,
    archiveMessages,
    markMessagesRead,
    sweepLabel,
    getMessageContext,
    getUnreadInboxMessages,
    resolveAccountForProject,
    normalizeListRow,
    EXCLUDED_WELL_KNOWN_FOLDERS,
    SWEEP_LIMIT,
}
