'use strict'

const admin = require('firebase-admin')
const { google } = require('googleapis')

const { getAccessToken, getOAuth2Client } = require('../GoogleOAuth/googleOAuthHandler')
const { normalizeGmailMessage } = require('./gmailMessageParser')

const DEFAULT_SEARCH_LIMIT = 10
const MAX_SEARCH_LIMIT = 20
const MAX_BODY_LENGTH = 4000
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

async function getConnectedGmailAccounts(userId) {
    const userDoc = await admin.firestore().collection('users').doc(userId).get()
    if (!userDoc.exists) throw new Error('User not found')

    const userData = userDoc.data() || {}
    const apisConnected = userData.apisConnected || {}
    const activeProjectIds = getActiveProjectIds(userData)
    const seenKeys = new Set()
    const accounts = []

    activeProjectIds.forEach(projectId => {
        const connection = apisConnected?.[projectId]
        if (!connection?.gmail) return

        const gmailEmail = typeof connection.gmailEmail === 'string' ? connection.gmailEmail.trim().toLowerCase() : ''
        const dedupeKey = gmailEmail || projectId
        if (seenKeys.has(dedupeKey)) return
        seenKeys.add(dedupeKey)

        accounts.push({
            projectId,
            gmailEmail: gmailEmail || null,
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

module.exports = {
    searchGmailForAssistantRequest,
}
