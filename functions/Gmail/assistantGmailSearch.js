'use strict'

const admin = require('firebase-admin')
const { google } = require('googleapis')

const { getAccessToken, getOAuth2Client } = require('../GoogleOAuth/googleOAuthHandler')
const { normalizeGmailMessage } = require('./gmailMessageParser')

const DEFAULT_SEARCH_LIMIT = 10
const MAX_SEARCH_LIMIT = 20
const MAX_BODY_LENGTH = 4000
const DEFAULT_GMAIL_RETRY_ATTEMPTS = 3
const DEFAULT_GMAIL_RETRY_BASE_DELAY_MS = 250
const SPECIAL_FLAG_LABELS = {
    isUnread: 'UNREAD',
    isInbox: 'INBOX',
    isImportant: 'IMPORTANT',
    isSent: 'SENT',
    isDraft: 'DRAFT',
    isStarred: 'STARRED',
    isSpam: 'SPAM',
    isTrash: 'TRASH',
}

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

async function getGmailClient(userId, projectId) {
    const accessToken = await getAccessToken(userId, projectId, 'gmail')
    const oauth2Client = getOAuth2Client()
    oauth2Client.setCredentials({ access_token: accessToken })
    return google.gmail({ version: 'v1', auth: oauth2Client })
}

async function getConnectedGmailAccountMap(userId) {
    const accounts = await getConnectedGmailAccounts(userId)
    const byProjectId = new Map()

    accounts.forEach(account => {
        byProjectId.set(account.projectId, account)
    })

    return { accounts, byProjectId }
}

async function loadLabelNameMap(gmail) {
    const response = await gmail.users.labels.list({ userId: 'me' })
    const labels = Array.isArray(response?.data?.labels) ? response.data.labels : []
    const labelNameMap = new Map()

    labels.forEach(label => {
        if (label?.id && label?.name) labelNameMap.set(label.id, label.name)
    })

    return labelNameMap
}

function buildSpecialFlags(labelIds = []) {
    const labelSet = new Set(Array.isArray(labelIds) ? labelIds : [])
    return Object.keys(SPECIAL_FLAG_LABELS).reduce((acc, key) => {
        acc[key] = labelSet.has(SPECIAL_FLAG_LABELS[key])
        return acc
    }, {})
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function normalizeBase64UrlToBuffer(base64Url = '') {
    const normalized = base64Url.replace(/-/g, '+').replace(/_/g, '/')
    const padding = normalized.length % 4
    const padded = padding === 0 ? normalized : normalized + '='.repeat(4 - padding)
    return Buffer.from(padded, 'base64')
}

function isTransientGmailError(error) {
    const status = error?.code || error?.status || error?.response?.status
    if ([429, 500, 502, 503, 504].includes(Number(status))) return true

    const message = (error?.message || '').toLowerCase()
    return (
        message.includes('rate limit') ||
        message.includes('quota exceeded') ||
        message.includes('backend error') ||
        message.includes('temporarily unavailable') ||
        message.includes('timeout') ||
        message.includes('econnreset') ||
        message.includes('etimedout')
    )
}

async function withGmailRetry(operation) {
    let attempt = 0
    let lastError = null

    while (attempt < DEFAULT_GMAIL_RETRY_ATTEMPTS) {
        try {
            return await operation()
        } catch (error) {
            lastError = error
            attempt += 1

            if (attempt >= DEFAULT_GMAIL_RETRY_ATTEMPTS || !isTransientGmailError(error)) {
                throw error
            }

            const delayMs = DEFAULT_GMAIL_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1)
            await sleep(delayMs)
        }
    }

    throw lastError || new Error('Unknown Gmail request failure')
}

function collectAttachmentParts(payload, parts = []) {
    if (!payload) return parts

    const fileName = typeof payload.filename === 'string' ? payload.filename.trim() : ''
    const attachmentId = typeof payload.body?.attachmentId === 'string' ? payload.body.attachmentId.trim() : ''
    const bodyData = typeof payload.body?.data === 'string' ? payload.body.data.trim() : ''
    const mimeType = typeof payload.mimeType === 'string' ? payload.mimeType.trim() : ''

    if (fileName && (attachmentId || bodyData)) {
        parts.push({
            attachmentId,
            bodyData,
            fileName,
            mimeType,
            sizeBytes: Number(payload.body?.size || 0),
            inline: String(payload.disposition || '').toLowerCase() === 'inline',
        })
    }

    if (Array.isArray(payload.parts)) {
        payload.parts.forEach(part => collectAttachmentParts(part, parts))
    }

    return parts
}

async function getConnectedGmailAccounts(userId) {
    const userDoc = await admin.firestore().collection('users').doc(userId).get()
    if (!userDoc.exists) throw new Error('User not found')

    const userData = userDoc.data() || {}
    const apisConnected = userData.apisConnected || {}
    const activeProjectIds = getActiveProjectIds(userData)
    const accountIndexByKey = new Map()
    const accounts = []

    activeProjectIds.forEach(projectId => {
        const connection = apisConnected?.[projectId]
        if (!connection?.gmail) return

        const gmailEmail = typeof connection.gmailEmail === 'string' ? connection.gmailEmail.trim().toLowerCase() : ''
        const dedupeKey = gmailEmail || projectId
        const gmailDefault = connection.gmailDefault === true

        if (accountIndexByKey.has(dedupeKey)) {
            if (!gmailDefault) return

            const existingIndex = accountIndexByKey.get(dedupeKey)
            accounts[existingIndex] = {
                projectId,
                gmailEmail: gmailEmail || null,
                gmailDefault,
            }
            return
        }

        accountIndexByKey.set(dedupeKey, accounts.length)
        accounts.push({
            projectId,
            gmailEmail: gmailEmail || null,
            gmailDefault,
        })
    })

    return accounts
}

async function searchConnectedAccount({ userId, account, query, limit, includeBodies }) {
    const gmail = await getGmailClient(userId, account.projectId)
    const labelNameMap = await loadLabelNameMap(gmail)
    const response = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        includeSpamTrash: false,
        maxResults: limit,
    })

    const messageRefs = Array.isArray(response?.data?.messages) ? response.data.messages : []
    if (messageRefs.length === 0) {
        return {
            searchedAccount: account,
            results: [],
        }
    }

    const messages = await Promise.allSettled(
        messageRefs.map(async item => {
            const detailResponse = await gmail.users.messages.get({
                userId: 'me',
                id: item.id,
                format: 'full',
            })
            return detailResponse?.data || null
        })
    )

    const results = messages
        .filter(entry => entry.status === 'fulfilled' && entry.value)
        .map(entry => {
            const rawMessage = entry.value
            const normalizedMessage = normalizeGmailMessage(rawMessage, includeBodies ? MAX_BODY_LENGTH : 0)
            const internalDate = normalizedMessage.internalDate || 0
            const labelIds = Array.isArray(normalizedMessage.labelIds) ? normalizedMessage.labelIds : []
            const labelNames = labelIds.map(labelId => labelNameMap.get(labelId) || labelId)
            return {
                projectId: account.projectId,
                gmailEmail: account.gmailEmail,
                messageId: normalizedMessage.messageId,
                threadId: normalizedMessage.threadId,
                subject: normalizedMessage.subject || '',
                from: normalizedMessage.from || '',
                to: normalizedMessage.to || '',
                cc: normalizedMessage.cc || '',
                date: internalDate ? new Date(internalDate).toISOString() : normalizedMessage.date || '',
                snippet: normalizedMessage.snippet || '',
                body: includeBodies ? normalizedMessage.bodyText || '' : '',
                attachments: Array.isArray(normalizedMessage.attachments) ? normalizedMessage.attachments : [],
                labelIds,
                labelNames,
                ...buildSpecialFlags(labelIds),
                internalDate,
            }
        })

    return {
        searchedAccount: account,
        results,
    }
}

async function searchGmailForAssistantRequest({ userId, query, limit = DEFAULT_SEARCH_LIMIT, includeBodies = true }) {
    const trimmedQuery = typeof query === 'string' ? query.trim() : ''
    if (!trimmedQuery) {
        return {
            success: false,
            query: trimmedQuery,
            searchedAccounts: [],
            accountsWithErrors: [],
            partialFailure: false,
            results: [],
            message: 'A Gmail search query is required.',
        }
    }

    const normalizedLimit = normalizeLimit(limit)
    const accounts = await getConnectedGmailAccounts(userId)
    if (accounts.length === 0) {
        return {
            success: false,
            query: trimmedQuery,
            searchedAccounts: [],
            accountsWithErrors: [],
            partialFailure: false,
            results: [],
            message: 'No connected Gmail accounts were found for this user. Please connect Gmail first.',
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
            return
        }

        accountsWithErrors.push({
            projectId: account.projectId,
            gmailEmail: account.gmailEmail,
            error: entry.reason?.message || 'Unknown Gmail search error',
        })
    })

    const sortedResults = mergedResults
        .sort((a, b) => (b.internalDate || 0) - (a.internalDate || 0))
        .slice(0, normalizedLimit)
        .map(({ internalDate, ...result }) => result)

    const partialFailure = accountsWithErrors.length > 0 && searchedAccounts.length > 0
    if (searchedAccounts.length === 0) {
        return {
            success: false,
            query: trimmedQuery,
            searchedAccounts: [],
            accountsWithErrors,
            partialFailure: false,
            results: [],
            message: 'Gmail search failed for all connected accounts. Please reconnect Gmail and try again.',
        }
    }

    return {
        success: true,
        query: trimmedQuery,
        searchedAccounts,
        accountsWithErrors,
        partialFailure,
        results: sortedResults,
        message: sortedResults.length > 0 ? null : 'No matching emails were found in the connected Gmail accounts.',
    }
}

async function getGmailAttachmentForAssistantRequest({
    userId,
    messageId,
    fileName = '',
    attachmentId,
    projectId = '',
    maxSizeBytes = 5 * 1024 * 1024,
}) {
    const normalizedUserId = typeof userId === 'string' ? userId.trim() : ''
    const normalizedMessageId = typeof messageId === 'string' ? messageId.trim() : ''
    const normalizedFileName = typeof fileName === 'string' ? fileName.trim() : ''
    const normalizedAttachmentId = typeof attachmentId === 'string' ? attachmentId.trim() : ''
    const normalizedProjectId = typeof projectId === 'string' ? projectId.trim() : ''

    if (!normalizedUserId) throw new Error('A valid userId is required')
    if (!normalizedMessageId) throw new Error('A valid messageId is required')
    if (!normalizedFileName && !normalizedAttachmentId) {
        throw new Error('A valid fileName or attachmentId is required')
    }

    const { accounts, byProjectId } = await getConnectedGmailAccountMap(normalizedUserId)
    if (accounts.length === 0) {
        throw new Error('No connected Gmail accounts were found for this user. Please connect Gmail first.')
    }

    const candidateAccounts = normalizedProjectId
        ? [
              ...[byProjectId.get(normalizedProjectId)].filter(Boolean),
              ...accounts.filter(account => account.projectId !== normalizedProjectId),
          ]
        : [...accounts]

    for (const account of candidateAccounts) {
        try {
            const gmail = await getGmailClient(normalizedUserId, account.projectId)
            const detailResponse = await withGmailRetry(() =>
                gmail.users.messages.get({
                    userId: 'me',
                    id: normalizedMessageId,
                    format: 'full',
                })
            )
            const message = detailResponse?.data || null
            if (!message) continue

            const normalizedMessage = normalizeGmailMessage(message, 0)
            const attachments = normalizedMessage.attachments || []
            const attachmentParts = collectAttachmentParts(message.payload || {})
            const attachmentMetaByFileName = normalizedFileName
                ? attachments.filter(attachment => attachment.fileName === normalizedFileName)
                : []
            if (attachmentMetaByFileName.length > 1) {
                throw new Error(`Multiple Gmail attachments named "${normalizedFileName}" were found in that message`)
            }
            const attachmentMetaByAttachmentId = normalizedAttachmentId
                ? attachments.find(attachment => attachment.attachmentId === normalizedAttachmentId)
                : null
            const attachmentMeta = attachmentMetaByFileName[0] || attachmentMetaByAttachmentId
            if (!attachmentMeta) continue

            const sizeBytes = Number(attachmentMeta.sizeBytes || 0)
            if (sizeBytes > maxSizeBytes) {
                throw new Error(`Gmail attachment exceeds the 5 MB limit (${sizeBytes} bytes)`)
            }

            const attachmentPart = attachmentParts.find(part => {
                if (normalizedFileName) return part.fileName === attachmentMeta.fileName
                return normalizedAttachmentId && part.attachmentId === normalizedAttachmentId
            })
            if (!attachmentPart) continue

            let buffer = null
            if (attachmentPart.bodyData) {
                buffer = normalizeBase64UrlToBuffer(attachmentPart.bodyData)
            } else if (attachmentPart.attachmentId) {
                const attachmentResponse = await withGmailRetry(() =>
                    gmail.users.messages.attachments.get({
                        userId: 'me',
                        messageId: normalizedMessageId,
                        id: attachmentPart.attachmentId,
                    })
                )
                const attachmentData = attachmentResponse?.data?.data || ''
                if (!attachmentData) {
                    throw new Error('Gmail attachment content is empty')
                }
                buffer = normalizeBase64UrlToBuffer(attachmentData)
            } else {
                throw new Error('Gmail attachment content is not available')
            }

            if (buffer.length > maxSizeBytes) {
                throw new Error(`Gmail attachment exceeds the 5 MB limit (${buffer.length} bytes)`)
            }

            return {
                success: true,
                fileName: attachmentMeta.fileName,
                fileBase64: buffer.toString('base64'),
                fileMimeType: attachmentMeta.mimeType || 'application/octet-stream',
                fileSizeBytes: buffer.length,
                source: 'gmail',
                projectId: account.projectId,
                gmailEmail: account.gmailEmail || null,
                messageId: normalizedMessageId,
                attachmentId: attachmentPart.attachmentId || attachmentMeta.attachmentId || '',
            }
        } catch (error) {
            const message = error?.message || ''
            const notFound =
                message.includes('Not Found') ||
                message.includes('Requested entity was not found') ||
                message.includes('404')
            if (notFound) continue
            throw error
        }
    }

    throw new Error('The requested Gmail attachment could not be found in the connected accounts')
}

module.exports = {
    getConnectedGmailAccounts,
    getGmailAttachmentForAssistantRequest,
    getGmailClient,
    searchGmailForAssistantRequest,
}
