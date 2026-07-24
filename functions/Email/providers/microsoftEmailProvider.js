'use strict'

const admin = require('firebase-admin')
const { buildQuery, encodePath, getMicrosoftGraphClient } = require('../../MicrosoftGraph/graphClient')
const { normalizeEmailAddress, resolveEmailConnection } = require('../../Integrations/providerConnections')

const DEFAULT_SEARCH_LIMIT = 10
const MAX_SEARCH_LIMIT = 20

function getActiveProjectIds(userData = {}) {
    const projectIds = Array.isArray(userData.projectIds) ? userData.projectIds : []
    const archivedProjectIds = Array.isArray(userData.archivedProjectIds) ? userData.archivedProjectIds : []
    const templateProjectIds = Array.isArray(userData.templateProjectIds) ? userData.templateProjectIds : []
    const guideProjectIds = Array.isArray(userData.guideProjectIds) ? userData.guideProjectIds : []
    const blockedProjectIds = new Set([...archivedProjectIds, ...templateProjectIds, ...guideProjectIds])
    const activeProjectIds = projectIds.filter(projectId => !blockedProjectIds.has(projectId))
    const defaultProjectId = typeof userData.defaultProjectId === 'string' ? userData.defaultProjectId.trim() : ''
    if (defaultProjectId && !blockedProjectIds.has(defaultProjectId) && !activeProjectIds.includes(defaultProjectId)) {
        activeProjectIds.unshift(defaultProjectId)
    }
    return activeProjectIds
}

function normalizeLimit(limit) {
    const parsed = parseInt(limit, 10)
    if (!Number.isFinite(parsed)) return DEFAULT_SEARCH_LIMIT
    return Math.min(Math.max(parsed, 1), MAX_SEARCH_LIMIT)
}

function normalizeRecipientList(value) {
    if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean)
    if (typeof value !== 'string') return []
    return value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
}

function toGraphRecipients(value) {
    return normalizeRecipientList(value).map(address => ({ emailAddress: { address } }))
}

function fromGraphRecipients(value) {
    if (!Array.isArray(value)) return []
    return value.map(item => item?.emailAddress?.address || '').filter(Boolean)
}

function normalizeAttachmentList(attachments) {
    if (!Array.isArray(attachments)) return []
    return attachments
        .map(attachment => ({
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: String(attachment.fileName || attachment.name || '').trim(),
            contentType: attachment.mimeType || attachment.fileMimeType || 'application/octet-stream',
            contentBytes: attachment.base64 || attachment.fileBase64 || '',
        }))
        .filter(attachment => attachment.name && attachment.contentBytes)
}

function normalizeMessage(message = {}, account = {}, includeBodies = true) {
    const received = message.receivedDateTime || message.sentDateTime || message.createdDateTime || ''
    const categories = Array.isArray(message.categories) ? message.categories : []
    const attachments = Array.isArray(message.attachments)
        ? message.attachments.map(attachment => ({
              attachmentId: attachment.id || '',
              fileName: attachment.name || '',
              mimeType: attachment.contentType || '',
              sizeBytes: Number(attachment.size || 0),
              inline: !!attachment.isInline,
          }))
        : []

    return {
        provider: 'microsoft',
        projectId: account.projectId,
        gmailEmail: account.gmailEmail || null,
        emailAddress: account.emailAddress || account.gmailEmail || null,
        messageId: message.id || '',
        threadId: message.conversationId || '',
        subject: message.subject || '',
        from: message.from?.emailAddress?.address || '',
        to: fromGraphRecipients(message.toRecipients).join(', '),
        cc: fromGraphRecipients(message.ccRecipients).join(', '),
        date: received,
        snippet: message.bodyPreview || '',
        body: includeBodies ? message.body?.content || '' : '',
        attachments,
        labelIds: categories,
        labelNames: categories,
        categories,
        isUnread: message.isRead === false,
        isInbox: true,
        isImportant: message.importance === 'high',
        isSent: false,
        isDraft: !!message.isDraft,
        isStarred: false,
        isSpam: false,
        isTrash: false,
        webUrl: message.webLink || '',
        internalDate: received ? new Date(received).getTime() : 0,
    }
}

function graphSearchFilter(query) {
    const escaped = String(query || '').replace(/'/g, "''")
    if (!escaped) return ''
    return `contains(subject,'${escaped}') or contains(from/emailAddress/address,'${escaped}') or contains(bodyPreview,'${escaped}')`
}

async function getConnectedMicrosoftEmailAccounts(userId) {
    const userDoc = await admin.firestore().collection('users').doc(userId).get()
    if (!userDoc.exists) throw new Error('User not found')

    const userData = userDoc.data() || {}
    const activeProjectIds = getActiveProjectIds(userData)
    const accountIndexByKey = new Map()
    const accounts = []

    activeProjectIds.forEach(projectId => {
        const connection = userData.apisConnected?.[projectId]
        const resolved = resolveEmailConnection(connection)
        if (!resolved.connected || resolved.provider !== 'microsoft') return

        const emailAddress = normalizeEmailAddress(resolved.emailAddress)
        const dedupeKey = emailAddress || projectId
        if (accountIndexByKey.has(dedupeKey)) {
            if (!resolved.isDefault) return
            accounts[accountIndexByKey.get(dedupeKey)] = {
                projectId,
                provider: 'microsoft',
                gmailEmail: emailAddress || null,
                emailAddress: emailAddress || null,
                gmailDefault: resolved.isDefault,
                emailDefault: resolved.isDefault,
            }
            return
        }

        accountIndexByKey.set(dedupeKey, accounts.length)
        accounts.push({
            projectId,
            provider: 'microsoft',
            gmailEmail: emailAddress || null,
            emailAddress: emailAddress || null,
            gmailDefault: resolved.isDefault,
            emailDefault: resolved.isDefault,
        })
    })

    return accounts
}

async function searchConnectedAccount({ userId, account, query, limit, includeBodies }) {
    const client = await getMicrosoftGraphClient(userId, account.projectId, 'email')
    const path =
        '/me/messages' +
        buildQuery({
            $top: limit,
            $orderby: 'receivedDateTime desc',
            $select:
                'id,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,createdDateTime,bodyPreview,body,categories,isRead,isDraft,importance,webLink,hasAttachments',
            $filter: graphSearchFilter(query),
        })
    const response = await client.request(path)
    const messages = Array.isArray(response?.value) ? response.value : []

    const detailed = await Promise.all(
        messages.map(async message => {
            if (!message.hasAttachments) return message
            const attachments = await client
                .request(
                    `/me/messages/${encodePath(message.id)}/attachments${buildQuery({
                        $select: 'id,name,contentType,size,isInline',
                    })}`
                )
                .catch(() => null)
            return { ...message, attachments: attachments?.value || [] }
        })
    )

    return {
        searchedAccount: account,
        results: detailed.map(message => normalizeMessage(message, account, includeBodies)),
    }
}

async function searchMicrosoftEmailForAssistantRequest({
    userId,
    query,
    limit = DEFAULT_SEARCH_LIMIT,
    includeBodies = true,
}) {
    const trimmedQuery = typeof query === 'string' ? query.trim() : ''
    if (!trimmedQuery) {
        return {
            success: false,
            query: trimmedQuery,
            searchedAccounts: [],
            accountsWithErrors: [],
            partialFailure: false,
            results: [],
            message: 'An email search query is required.',
        }
    }

    const accounts = await getConnectedMicrosoftEmailAccounts(userId)
    const normalizedLimit = normalizeLimit(limit)
    if (accounts.length === 0) {
        return {
            success: false,
            query: trimmedQuery,
            searchedAccounts: [],
            accountsWithErrors: [],
            partialFailure: false,
            results: [],
            message: 'No connected Microsoft email accounts were found for this user. Please connect Email first.',
        }
    }

    const settledResults = await Promise.allSettled(
        accounts.map(account =>
            searchConnectedAccount({
                userId,
                account,
                query: trimmedQuery,
                limit: normalizedLimit,
                includeBodies: includeBodies !== false,
            })
        )
    )

    const searchedAccounts = []
    const accountsWithErrors = []
    const mergedResults = []
    settledResults.forEach((entry, index) => {
        const account = accounts[index]
        if (entry.status === 'fulfilled') {
            searchedAccounts.push(entry.value.searchedAccount)
            mergedResults.push(...entry.value.results)
        } else {
            accountsWithErrors.push({
                projectId: account.projectId,
                emailAddress: account.emailAddress,
                error: entry.reason?.message || 'Unknown Microsoft email search error',
            })
        }
    })

    const results = mergedResults
        .sort((a, b) => (b.internalDate || 0) - (a.internalDate || 0))
        .slice(0, normalizedLimit)
        .map(({ internalDate, ...result }) => result)

    if (searchedAccounts.length === 0) {
        return {
            success: false,
            query: trimmedQuery,
            searchedAccounts: [],
            accountsWithErrors,
            partialFailure: false,
            results: [],
            message: 'Microsoft email search failed for all connected accounts. Please reconnect Email and try again.',
        }
    }

    return {
        success: true,
        query: trimmedQuery,
        searchedAccounts,
        accountsWithErrors,
        partialFailure: accountsWithErrors.length > 0 && searchedAccounts.length > 0,
        results,
        message: results.length > 0 ? null : 'No matching emails were found in the connected Microsoft accounts.',
    }
}

async function getMicrosoftEmailAttachmentForAssistantRequest({
    userId,
    messageId,
    fileName = '',
    attachmentId = '',
    projectId = '',
    maxSizeBytes = 10 * 1024 * 1024,
}) {
    const accounts = await getConnectedMicrosoftEmailAccounts(userId)
    const candidateAccounts = projectId
        ? [
              ...accounts.filter(account => account.projectId === projectId),
              ...accounts.filter(account => account.projectId !== projectId),
          ]
        : accounts

    for (const account of candidateAccounts) {
        try {
            const client = await getMicrosoftGraphClient(userId, account.projectId, 'email')
            const attachments = await client.request(`/me/messages/${encodePath(messageId)}/attachments`)
            const matches = (attachments?.value || []).filter(attachment => {
                if (fileName) return attachment.name === fileName
                return attachmentId && attachment.id === attachmentId
            })
            if (matches.length === 0) continue
            if (matches.length > 1) throw new Error(`Multiple email attachments named "${fileName}" were found`)

            const attachment = matches[0]
            const contentBytes = attachment.contentBytes || ''
            const buffer = Buffer.from(contentBytes, 'base64')
            if (buffer.length > maxSizeBytes) {
                throw new Error(`Email attachment exceeds the ${Math.round(maxSizeBytes / 1024 / 1024)} MB limit`)
            }

            return {
                success: true,
                fileName: attachment.name || fileName,
                fileBase64: contentBytes,
                fileMimeType: attachment.contentType || 'application/octet-stream',
                fileSizeBytes: buffer.length,
                source: 'microsoft_email',
                provider: 'microsoft',
                projectId: account.projectId,
                gmailEmail: account.gmailEmail || null,
                emailAddress: account.emailAddress || null,
                messageId,
                attachmentId: attachment.id || '',
            }
        } catch (error) {
            if (String(error?.message || '').includes('not found')) continue
            throw error
        }
    }

    throw new Error('The requested email attachment could not be found in the connected Microsoft accounts')
}

async function createMicrosoftDraftForAssistantRequest({ userId, projectId, to, cc, bcc, subject, body, attachments }) {
    const accounts = await getConnectedMicrosoftEmailAccounts(userId)
    const account =
        accounts.find(item => item.emailDefault) ||
        accounts.find(item => item.projectId === projectId) ||
        accounts[0] ||
        null
    if (!account)
        return {
            success: false,
            message: 'No connected Microsoft email account was found. Please connect Email first.',
        }

    const toRecipients = toGraphRecipients(to)
    const normalizedSubject = String(subject || '').trim()
    const normalizedBody = String(body || '').trim()
    if (toRecipients.length === 0)
        return { success: false, message: 'Email draft creation requires at least one recipient in "to".' }
    if (!normalizedSubject) return { success: false, message: 'Email draft creation requires a subject.' }
    if (!normalizedBody) return { success: false, message: 'Email draft creation requires a body.' }

    const client = await getMicrosoftGraphClient(userId, account.projectId, 'email')
    const draft = await client.request('/me/messages', {
        method: 'POST',
        body: JSON.stringify({
            subject: normalizedSubject,
            body: { contentType: 'Text', content: normalizedBody },
            toRecipients,
            ccRecipients: toGraphRecipients(cc),
            bccRecipients: toGraphRecipients(bcc),
            attachments: normalizeAttachmentList(attachments),
        }),
    })

    return {
        success: true,
        provider: 'microsoft',
        draftId: draft.id || '',
        messageId: draft.id || '',
        threadId: draft.conversationId || '',
        gmailEmail: account.gmailEmail || null,
        emailAddress: account.emailAddress || null,
        projectId: account.projectId,
        subject: normalizedSubject,
        to: normalizeRecipientList(to),
        cc: normalizeRecipientList(cc),
        bcc: normalizeRecipientList(bcc),
        attachments: normalizeAttachmentList(attachments).map(({ contentBytes, ...attachment }) => ({
            fileName: attachment.name,
            mimeType: attachment.contentType,
        })),
        webUrl: draft.webLink || 'https://outlook.office.com/mail/drafts',
        message: `Created an email draft in ${account.emailAddress || 'the connected Microsoft email account'}.`,
    }
}

async function createMicrosoftReplyDraftForAssistantRequest({
    userId,
    query,
    messageId,
    body,
    instructions,
    attachments,
}) {
    const draftBody = String(body || instructions || '').trim()
    if (!draftBody) return { success: false, message: 'Email reply draft creation requires draft body text.' }

    let target = null
    if (messageId) {
        const accounts = await getConnectedMicrosoftEmailAccounts(userId)
        for (const account of accounts) {
            try {
                const client = await getMicrosoftGraphClient(userId, account.projectId, 'email')
                const message = await client.request(`/me/messages/${encodePath(messageId)}`)
                target = { account, client, message }
                break
            } catch (_) {}
        }
    } else if (query) {
        const searchResult = await searchMicrosoftEmailForAssistantRequest({
            userId,
            query,
            limit: 1,
            includeBodies: false,
        })
        const match = searchResult.results?.[0]
        if (match?.messageId) {
            const account = (await getConnectedMicrosoftEmailAccounts(userId)).find(
                item => item.projectId === match.projectId
            )
            const client = await getMicrosoftGraphClient(userId, account.projectId, 'email')
            const message = await client.request(`/me/messages/${encodePath(match.messageId)}`)
            target = { account, client, message }
        }
    }

    if (!target) return { success: false, message: 'No matching email thread was found for that reply draft request.' }

    const draft = await target.client.request(`/me/messages/${encodePath(target.message.id)}/createReply`, {
        method: 'POST',
        body: JSON.stringify({ comment: draftBody }),
    })
    const graphAttachments = normalizeAttachmentList(attachments)
    for (const attachment of graphAttachments) {
        await target.client.request(`/me/messages/${encodePath(draft.id)}/attachments`, {
            method: 'POST',
            body: JSON.stringify(attachment),
        })
    }

    return {
        success: true,
        provider: 'microsoft',
        draftId: draft.id || '',
        messageId: draft.id || '',
        threadId: draft.conversationId || target.message.conversationId || '',
        gmailEmail: target.account.gmailEmail || null,
        emailAddress: target.account.emailAddress || null,
        projectId: target.account.projectId,
        targetMessageId: target.message.id || '',
        targetSubject: target.message.subject || '',
        to: fromGraphRecipients(draft.toRecipients),
        attachments: graphAttachments.map(attachment => ({
            fileName: attachment.name,
            mimeType: attachment.contentType,
        })),
        webUrl: draft.webLink || target.message.webLink || 'https://outlook.office.com/mail/drafts',
        message: `Created an email reply draft in ${
            target.account.emailAddress || 'the connected Microsoft email account'
        }.`,
    }
}

async function updateMicrosoftDraftForAssistantRequest({ userId, draftId, to, cc, bcc, subject, body, attachments }) {
    const accounts = await getConnectedMicrosoftEmailAccounts(userId)
    for (const account of accounts) {
        try {
            const client = await getMicrosoftGraphClient(userId, account.projectId, 'email')
            const payload = {}
            if (subject !== undefined) payload.subject = String(subject || '').trim()
            if (body !== undefined) payload.body = { contentType: 'Text', content: String(body || '').trim() }
            if (to !== undefined) payload.toRecipients = toGraphRecipients(to)
            if (cc !== undefined) payload.ccRecipients = toGraphRecipients(cc)
            if (bcc !== undefined) payload.bccRecipients = toGraphRecipients(bcc)
            await client.request(`/me/messages/${encodePath(draftId)}`, {
                method: 'PATCH',
                body: JSON.stringify(payload),
            })
            const graphAttachments = normalizeAttachmentList(attachments)
            for (const attachment of graphAttachments) {
                await client.request(`/me/messages/${encodePath(draftId)}/attachments`, {
                    method: 'POST',
                    body: JSON.stringify(attachment),
                })
            }
            const draft = await client.request(`/me/messages/${encodePath(draftId)}`)
            return {
                success: true,
                provider: 'microsoft',
                draftId,
                messageId: draft.id || draftId,
                threadId: draft.conversationId || '',
                gmailEmail: account.gmailEmail || null,
                emailAddress: account.emailAddress || null,
                projectId: account.projectId,
                subject: draft.subject || payload.subject || '',
                to: fromGraphRecipients(draft.toRecipients),
                cc: fromGraphRecipients(draft.ccRecipients),
                bcc: fromGraphRecipients(draft.bccRecipients),
                attachments: graphAttachments.map(attachment => ({
                    fileName: attachment.name,
                    mimeType: attachment.contentType,
                })),
                webUrl: draft.webLink || 'https://outlook.office.com/mail/drafts',
                message: `Updated the email draft in ${
                    account.emailAddress || 'the connected Microsoft email account'
                }.`,
            }
        } catch (error) {
            if (
                String(error?.message || '')
                    .toLowerCase()
                    .includes('not found')
            )
                continue
            throw error
        }
    }

    return { success: false, message: 'No matching Microsoft email draft was found for that draftId.' }
}

async function updateMicrosoftEmailForAssistantRequest({
    userId,
    messageId,
    projectId = '',
    addLabelIds,
    removeLabelIds,
    markUnread,
    important,
}) {
    const accounts = await getConnectedMicrosoftEmailAccounts(userId)
    const candidateAccounts = projectId
        ? [
              ...accounts.filter(account => account.projectId === projectId),
              ...accounts.filter(account => account.projectId !== projectId),
          ]
        : accounts

    const addCategories = Array.isArray(addLabelIds)
        ? addLabelIds
        : typeof addLabelIds === 'string'
        ? addLabelIds.split(',')
        : []
    const removeCategories = Array.isArray(removeLabelIds)
        ? removeLabelIds
        : typeof removeLabelIds === 'string'
        ? removeLabelIds.split(',')
        : []

    for (const account of candidateAccounts) {
        try {
            const client = await getMicrosoftGraphClient(userId, account.projectId, 'email')
            const message = await client.request(
                `/me/messages/${encodePath(messageId)}${buildQuery({
                    $select: 'id,conversationId,categories,isRead,importance,webLink',
                })}`
            )
            const categories = new Set(Array.isArray(message.categories) ? message.categories : [])
            addCategories
                .map(item => String(item || '').trim())
                .filter(Boolean)
                .forEach(item => categories.add(item))
            removeCategories
                .map(item => String(item || '').trim())
                .filter(Boolean)
                .forEach(item => categories.delete(item))
            const payload = { categories: Array.from(categories) }
            if (typeof markUnread === 'boolean') payload.isRead = !markUnread
            if (typeof important === 'boolean') payload.importance = important ? 'high' : 'normal'
            const updated = await client.request(`/me/messages/${encodePath(messageId)}`, {
                method: 'PATCH',
                body: JSON.stringify(payload),
            })
            return {
                success: true,
                provider: 'microsoft',
                projectId: account.projectId,
                gmailEmail: account.gmailEmail || null,
                emailAddress: account.emailAddress || null,
                messageId,
                threadId: updated?.conversationId || message.conversationId || '',
                appliedChanges: payload,
                labelIds: payload.categories,
                labelNames: payload.categories,
                archived: false,
                message: `Updated email message ${messageId} in ${
                    account.emailAddress || 'the connected Microsoft email account'
                }.`,
            }
        } catch (error) {
            if (
                String(error?.message || '')
                    .toLowerCase()
                    .includes('not found')
            )
                continue
            throw error
        }
    }

    return { success: false, message: 'No matching Microsoft email message was found for that messageId.' }
}

async function getUnreadMicrosoftInboxCount(userId, projectId) {
    const accounts = await getConnectedMicrosoftEmailAccounts(userId)
    const account = accounts.find(item => item.projectId === projectId)
    if (!account) throw new Error('No connected Microsoft email account was found for this project.')

    const client = await getMicrosoftGraphClient(userId, account.projectId, 'email')
    const response = await client.request(
        `/me/mailFolders/inbox/messages${buildQuery({
            $filter: 'isRead eq false',
            $top: 1,
            $count: 'true',
            $select: 'id',
        })}`,
        { headers: { ConsistencyLevel: 'eventual' } }
    )

    return {
        unreadCount: Number(response?.['@odata.count'] || 0),
        emailAddress: account.emailAddress || account.gmailEmail || '',
    }
}

module.exports = {
    createMicrosoftDraftForAssistantRequest,
    createMicrosoftReplyDraftForAssistantRequest,
    getConnectedMicrosoftEmailAccounts,
    getUnreadMicrosoftInboxCount,
    getMicrosoftEmailAttachmentForAssistantRequest,
    normalizeMessage,
    searchMicrosoftEmailForAssistantRequest,
    updateMicrosoftDraftForAssistantRequest,
    updateMicrosoftEmailForAssistantRequest,
}
