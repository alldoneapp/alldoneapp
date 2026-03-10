'use strict'

const { searchGmailForAssistantRequest, getConnectedGmailAccounts, getGmailClient } = require('./assistantGmailSearch')
const { normalizeGmailMessage } = require('./gmailMessageParser')

function normalizeRecipientList(value) {
    if (Array.isArray(value)) {
        return value.map(item => String(item || '').trim()).filter(Boolean)
    }

    if (typeof value !== 'string') return []

    return value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
}

function encodeMimeWord(value = '') {
    const text = String(value || '')
    if (!text) return ''
    if (/^[\x00-\x7F]*$/.test(text)) return text
    return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`
}

function toBase64Url(input) {
    return Buffer.from(input, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function buildReferencesHeader({ references = '', rfcMessageId = '' }) {
    const existingReferences = String(references || '').trim()
    const replyMessageId = String(rfcMessageId || '').trim()

    if (existingReferences && replyMessageId) return `${existingReferences} ${replyMessageId}`.trim()
    return existingReferences || replyMessageId || ''
}

function buildPlainTextMimeMessage({ to, cc, bcc, subject, body, inReplyTo, references }) {
    const headers = [
        'MIME-Version: 1.0',
        `Content-Type: text/plain; charset="UTF-8"`,
        'Content-Transfer-Encoding: 8bit',
    ]

    const toRecipients = normalizeRecipientList(to)
    const ccRecipients = normalizeRecipientList(cc)
    const bccRecipients = normalizeRecipientList(bcc)

    if (toRecipients.length > 0) headers.unshift(`To: ${toRecipients.join(', ')}`)
    if (ccRecipients.length > 0) headers.unshift(`Cc: ${ccRecipients.join(', ')}`)
    if (bccRecipients.length > 0) headers.unshift(`Bcc: ${bccRecipients.join(', ')}`)
    if (subject) headers.unshift(`Subject: ${encodeMimeWord(subject)}`)
    if (inReplyTo) headers.unshift(`In-Reply-To: ${inReplyTo}`)
    if (references) headers.unshift(`References: ${references}`)

    return `${headers.join('\r\n')}\r\n\r\n${String(body || '').replace(/\r?\n/g, '\r\n')}`
}

function buildGmailDraftUrl(gmailEmail = '', messageId = '') {
    const accountSegment = gmailEmail ? encodeURIComponent(gmailEmail) : '0'
    const composeQuery = messageId ? `?compose=${encodeURIComponent(messageId)}` : '?compose=new'
    return `https://mail.google.com/mail/u/${accountSegment}/#inbox${composeQuery}`
}

function getBodyOrInstructions({ body, instructions }) {
    const normalizedBody = typeof body === 'string' ? body.trim() : ''
    if (normalizedBody) return normalizedBody

    const normalizedInstructions = typeof instructions === 'string' ? instructions.trim() : ''
    return normalizedInstructions
}

function getReplyToRecipient(normalizedMessage = {}) {
    return normalizedMessage.replyTo || normalizedMessage.from || ''
}

function decodeMimeWord(value = '') {
    const text = String(value || '')
    return text.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, encoded) => Buffer.from(encoded, 'base64').toString('utf8'))
}

function pickLatestResult(results = []) {
    if (!Array.isArray(results) || results.length === 0) return null
    return [...results].sort((a, b) => Number(b.internalDate || 0) - Number(a.internalDate || 0))[0]
}

function selectProjectAccount(accounts = [], projectId = '') {
    return accounts.find(account => account.projectId === projectId) || null
}

function selectDefaultAccount(accounts = []) {
    return accounts.find(account => account.gmailDefault) || null
}

async function fetchMessageById(gmail, messageId) {
    const response = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
    })

    return response?.data || null
}

async function fetchThreadById(gmail, threadId) {
    const response = await gmail.users.threads.get({
        userId: 'me',
        id: threadId,
        format: 'full',
    })

    return Array.isArray(response?.data?.messages) ? response.data.messages : []
}

async function fetchDraftById(gmail, draftId) {
    const response = await gmail.users.drafts.get({
        userId: 'me',
        id: draftId,
        format: 'full',
    })

    return response?.data || null
}

function normalizeDraftData(draft = {}) {
    const message = draft.message || {}
    const normalizedMessage = normalizeGmailMessage(message, 8000)

    return {
        draftId: draft.id || '',
        messageId: message.id || normalizedMessage.messageId || '',
        threadId: message.threadId || normalizedMessage.threadId || '',
        to: normalizeRecipientList(normalizedMessage.to),
        cc: normalizeRecipientList(normalizedMessage.cc),
        bcc: normalizeRecipientList(normalizedMessage.bcc),
        subject: decodeMimeWord(normalizedMessage.subject || ''),
        body: normalizedMessage.bodyText || '',
    }
}

async function resolveMessageAcrossAccounts(userId, matcher) {
    const accounts = await getConnectedGmailAccounts(userId)

    for (let index = 0; index < accounts.length; index += 1) {
        const account = accounts[index]
        const gmail = await getGmailClient(userId, account.projectId)
        const result = await matcher({ gmail, account })
        if (result) return result
    }

    return null
}

async function resolveReplyTarget({ userId, query, messageId, threadId }) {
    const normalizedMessageId = typeof messageId === 'string' ? messageId.trim() : ''
    const normalizedThreadId = typeof threadId === 'string' ? threadId.trim() : ''
    const normalizedQuery = typeof query === 'string' ? query.trim() : ''

    if (normalizedMessageId) {
        return resolveMessageAcrossAccounts(userId, async ({ gmail, account }) => {
            try {
                const rawMessage = await fetchMessageById(gmail, normalizedMessageId)
                if (!rawMessage) return null

                return {
                    account,
                    rawMessage,
                    normalizedMessage: normalizeGmailMessage(rawMessage, 0),
                }
            } catch (error) {
                return null
            }
        })
    }

    if (normalizedThreadId) {
        return resolveMessageAcrossAccounts(userId, async ({ gmail, account }) => {
            try {
                const messages = await fetchThreadById(gmail, normalizedThreadId)
                if (!messages.length) return null
                const latestMessage = pickLatestResult(
                    messages.map(message => ({ ...message, internalDate: message.internalDate }))
                )
                if (!latestMessage) return null

                return {
                    account,
                    rawMessage: latestMessage,
                    normalizedMessage: normalizeGmailMessage(latestMessage, 0),
                }
            } catch (error) {
                return null
            }
        })
    }

    if (!normalizedQuery) {
        return {
            error:
                'A Gmail reply target is required. Provide a query, Gmail messageId, or Gmail threadId before creating a reply draft.',
        }
    }

    const searchResult = await searchGmailForAssistantRequest({
        userId,
        query: normalizedQuery,
        limit: 10,
        includeBodies: false,
    })

    if (!searchResult.success || !Array.isArray(searchResult.results) || searchResult.results.length === 0) {
        return {
            error: searchResult.message || 'No matching email thread was found for that reply draft request.',
        }
    }

    const latestMatch = pickLatestResult(searchResult.results)
    if (!latestMatch?.messageId) {
        return {
            error: 'A matching Gmail thread was found, but the message metadata was incomplete.',
        }
    }

    const gmail = await getGmailClient(userId, latestMatch.projectId)
    const rawMessage = await fetchMessageById(gmail, latestMatch.messageId)

    return {
        account: {
            projectId: latestMatch.projectId,
            gmailEmail: latestMatch.gmailEmail || null,
        },
        rawMessage,
        normalizedMessage: normalizeGmailMessage(rawMessage, 0),
        searchMatch: latestMatch,
    }
}

async function createDraftInAccount({ userId, projectId, mimeMessage, threadId = '' }) {
    const gmail = await getGmailClient(userId, projectId)
    const response = await gmail.users.drafts.create({
        userId: 'me',
        requestBody: {
            message: {
                raw: toBase64Url(mimeMessage),
                ...(threadId ? { threadId } : {}),
            },
        },
    })

    return response?.data || {}
}

async function resolveDraftTarget({ userId, draftId }) {
    const normalizedDraftId = typeof draftId === 'string' ? draftId.trim() : ''
    if (!normalizedDraftId) {
        return {
            error: 'A Gmail draftId is required before updating a draft.',
        }
    }

    return resolveMessageAcrossAccounts(userId, async ({ gmail, account }) => {
        try {
            const draft = await fetchDraftById(gmail, normalizedDraftId)
            if (!draft) return null

            return {
                account,
                gmail,
                draft,
                normalizedDraft: normalizeDraftData(draft),
            }
        } catch (error) {
            return null
        }
    }).then(result => {
        if (result) return result

        return {
            error: 'No matching Gmail draft was found for that draftId.',
        }
    })
}

async function updateDraftInAccount({ gmail, draftId, mimeMessage, threadId = '' }) {
    const response = await gmail.users.drafts.update({
        userId: 'me',
        id: draftId,
        requestBody: {
            id: draftId,
            message: {
                raw: toBase64Url(mimeMessage),
                ...(threadId ? { threadId } : {}),
            },
        },
    })

    return response?.data || {}
}

async function createGmailDraftForAssistantRequest({ userId, projectId, to, cc, bcc, subject, body }) {
    const normalizedProjectId = typeof projectId === 'string' ? projectId.trim() : ''
    if (!userId) {
        return { success: false, message: 'Gmail draft creation requires a valid requesting user.' }
    }
    if (!normalizedProjectId) {
        return { success: false, message: 'Gmail draft creation requires a project context.' }
    }

    const accounts = await getConnectedGmailAccounts(userId)
    const account = selectDefaultAccount(accounts) || selectProjectAccount(accounts, normalizedProjectId)
    if (!account) {
        return {
            success: false,
            message: 'No connected Gmail account was found for the current project. Please connect Gmail first.',
        }
    }

    const toRecipients = normalizeRecipientList(to)
    const ccRecipients = normalizeRecipientList(cc)
    const bccRecipients = normalizeRecipientList(bcc)
    const normalizedBody = typeof body === 'string' ? body.trim() : ''
    const normalizedSubject = typeof subject === 'string' ? subject.trim() : ''

    if (toRecipients.length === 0) {
        return { success: false, message: 'Gmail draft creation requires at least one recipient in "to".' }
    }
    if (!normalizedSubject) {
        return { success: false, message: 'Gmail draft creation requires a subject.' }
    }
    if (!normalizedBody) {
        return { success: false, message: 'Gmail draft creation requires a body.' }
    }

    const mimeMessage = buildPlainTextMimeMessage({
        to: toRecipients,
        cc: ccRecipients,
        bcc: bccRecipients,
        subject: normalizedSubject,
        body: normalizedBody,
    })

    const draft = await createDraftInAccount({
        userId,
        projectId: account.projectId,
        mimeMessage,
    })

    return {
        success: true,
        draftId: draft.id || '',
        messageId: draft.message?.id || '',
        threadId: draft.message?.threadId || '',
        gmailEmail: account.gmailEmail || null,
        projectId: account.projectId,
        subject: normalizedSubject,
        to: toRecipients,
        cc: ccRecipients,
        bcc: bccRecipients,
        webUrl: buildGmailDraftUrl(account.gmailEmail || '', draft.message?.id || ''),
        message: `Created a Gmail draft in ${account.gmailEmail || 'the connected Gmail account'}.`,
    }
}

async function createGmailReplyDraftForAssistantRequest({ userId, query, messageId, threadId, body, instructions }) {
    if (!userId) {
        return { success: false, message: 'Gmail reply draft creation requires a valid requesting user.' }
    }

    const draftBody = getBodyOrInstructions({ body, instructions })
    if (!draftBody) {
        return {
            success: false,
            message: 'Gmail reply draft creation requires draft body text or fallback instructions.',
        }
    }

    const target = await resolveReplyTarget({ userId, query, messageId, threadId })
    if (target?.error) {
        return {
            success: false,
            message: target.error,
        }
    }

    const replyTo = getReplyToRecipient(target.normalizedMessage)
    if (!replyTo) {
        return {
            success: false,
            message: 'The selected Gmail message does not have a usable reply recipient.',
        }
    }

    const replySubject = String(target.normalizedMessage.subject || '')
        .trim()
        .startsWith('Re:')
        ? String(target.normalizedMessage.subject || '').trim()
        : `Re: ${String(target.normalizedMessage.subject || '').trim()}`
    const references = buildReferencesHeader(target.normalizedMessage)
    const mimeMessage = buildPlainTextMimeMessage({
        to: [replyTo],
        subject: replySubject,
        body: draftBody,
        inReplyTo: target.normalizedMessage.rfcMessageId || '',
        references,
    })

    const draft = await createDraftInAccount({
        userId,
        projectId: target.account.projectId,
        mimeMessage,
        threadId: target.normalizedMessage.threadId || '',
    })

    return {
        success: true,
        draftId: draft.id || '',
        messageId: draft.message?.id || '',
        threadId: target.normalizedMessage.threadId || draft.message?.threadId || '',
        gmailEmail: target.account.gmailEmail || null,
        projectId: target.account.projectId,
        targetMessageId: target.normalizedMessage.messageId || '',
        targetSubject: target.normalizedMessage.subject || '',
        to: [replyTo],
        webUrl: buildGmailDraftUrl(target.account.gmailEmail || '', draft.message?.id || ''),
        message: `Created a Gmail reply draft in ${target.account.gmailEmail || 'the connected Gmail account'}.`,
    }
}

async function updateGmailDraftForAssistantRequest({ userId, draftId, to, cc, bcc, subject, body }) {
    if (!userId) {
        return { success: false, message: 'Gmail draft update requires a valid requesting user.' }
    }

    const target = await resolveDraftTarget({ userId, draftId })
    if (target?.error) {
        return {
            success: false,
            message: target.error,
        }
    }

    const nextTo = to === undefined ? target.normalizedDraft.to : normalizeRecipientList(to)
    const nextCc = cc === undefined ? target.normalizedDraft.cc : normalizeRecipientList(cc)
    const nextBcc = bcc === undefined ? target.normalizedDraft.bcc : normalizeRecipientList(bcc)
    const nextSubject =
        subject === undefined ? target.normalizedDraft.subject : typeof subject === 'string' ? subject.trim() : ''
    const nextBody = body === undefined ? target.normalizedDraft.body : typeof body === 'string' ? body.trim() : ''

    if (nextTo.length === 0) {
        return {
            success: false,
            message: 'Gmail draft update requires at least one recipient in "to".',
        }
    }
    if (!nextSubject) {
        return {
            success: false,
            message: 'Gmail draft update requires a subject.',
        }
    }
    if (!nextBody) {
        return {
            success: false,
            message: 'Gmail draft update requires a body.',
        }
    }

    const mimeMessage = buildPlainTextMimeMessage({
        to: nextTo,
        cc: nextCc,
        bcc: nextBcc,
        subject: nextSubject,
        body: nextBody,
    })

    const draft = await updateDraftInAccount({
        gmail: target.gmail,
        draftId: target.normalizedDraft.draftId,
        mimeMessage,
        threadId: target.normalizedDraft.threadId,
    })

    return {
        success: true,
        draftId: draft.id || target.normalizedDraft.draftId,
        messageId: draft.message?.id || '',
        threadId: draft.message?.threadId || target.normalizedDraft.threadId || '',
        gmailEmail: target.account.gmailEmail || null,
        projectId: target.account.projectId,
        subject: nextSubject,
        to: nextTo,
        cc: nextCc,
        bcc: nextBcc,
        webUrl: buildGmailDraftUrl(target.account.gmailEmail || '', draft.message?.id || ''),
        message: `Updated the Gmail draft in ${target.account.gmailEmail || 'the connected Gmail account'}.`,
    }
}

module.exports = {
    buildPlainTextMimeMessage,
    buildGmailDraftUrl,
    buildReferencesHeader,
    createGmailDraftForAssistantRequest,
    createGmailReplyDraftForAssistantRequest,
    fetchDraftById,
    normalizeRecipientList,
    normalizeDraftData,
    pickLatestResult,
    selectDefaultAccount,
    selectProjectAccount,
    updateGmailDraftForAssistantRequest,
}
