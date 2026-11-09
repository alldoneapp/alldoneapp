'use strict'

const { getConnectedGmailAccounts, getGmailClient } = require('./assistantGmailSearch')
const {
    getConnectedMicrosoftEmailAccounts,
    updateMicrosoftEmailForAssistantRequest,
} = require('../Email/providers/microsoftEmailProvider')
const { findLabelIdByName } = require('./gmailLabelingConfig')

const SYSTEM_LABELS = new Set(['INBOX', 'UNREAD', 'STARRED', 'IMPORTANT'])

function normalizeStringList(value) {
    if (Array.isArray(value)) {
        return value.map(item => String(item || '').trim()).filter(Boolean)
    }

    if (typeof value !== 'string') return []

    return value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
}

function applyBooleanLabelToggle(nextState, labelId, flagValue) {
    if (typeof flagValue !== 'boolean') return

    nextState.add.delete(labelId)
    nextState.remove.delete(labelId)

    if (flagValue) nextState.add.add(labelId)
    else nextState.remove.add(labelId)
}

function buildLabelMutationState({ addLabelIds, removeLabelIds, markUnread, starred, important }) {
    const add = new Set(normalizeStringList(addLabelIds))
    const remove = new Set(normalizeStringList(removeLabelIds))

    applyBooleanLabelToggle({ add, remove }, 'UNREAD', markUnread)
    applyBooleanLabelToggle({ add, remove }, 'STARRED', starred)
    applyBooleanLabelToggle({ add, remove }, 'IMPORTANT', important)

    Array.from(add).forEach(labelId => {
        if (remove.has(labelId)) remove.delete(labelId)
    })

    return {
        addLabelIds: Array.from(add),
        removeLabelIds: Array.from(remove),
    }
}

async function loadLabelMaps(gmail) {
    const response = await gmail.users.labels.list({ userId: 'me' })
    const labels = Array.isArray(response?.data?.labels) ? response.data.labels : []
    const byId = new Map()
    const byName = new Map()

    labels.forEach(label => {
        if (label?.id) byId.set(label.id, label.name || label.id)
        if (label?.name) byName.set(label.name, label.id || label.name)
    })

    return { byId, byName }
}

function resolveRequestedLabelIds(requestedLabels = [], labelNameToId = new Map()) {
    return requestedLabels.map(label => {
        if (SYSTEM_LABELS.has(label)) return label
        // Case-insensitive so an assistant-supplied "ads" resolves to an existing "Ads"
        // label id instead of being passed through as a bogus label id (which Gmail rejects).
        return findLabelIdByName(labelNameToId, label) || label
    })
}

// The message as it was before the change: its subject, and its labels so the result can say what
// the call really changed (a label it already had is not a change). Best effort: when this read fails
// the requested changes are reported, and `modify` below still decides whether the message exists.
async function readMessageBeforeChange(gmail, messageId) {
    try {
        const response = await gmail.users.messages.get({
            userId: 'me',
            id: messageId,
            format: 'metadata',
            metadataHeaders: ['Subject'],
        })
        const data = response?.data || {}
        const headers = Array.isArray(data.payload?.headers) ? data.payload.headers : []
        const subjectHeader = headers.find(header => String(header?.name || '').toLowerCase() === 'subject')
        return {
            labelIds: Array.isArray(data.labelIds) ? data.labelIds : null,
            subject: typeof subjectHeader?.value === 'string' ? subjectHeader.value : '',
        }
    } catch (_) {
        return null
    }
}

function computeChangedLabelIds(beforeLabelIds, addLabelIds, removeLabelIds) {
    if (!Array.isArray(beforeLabelIds)) return { added: addLabelIds, removed: removeLabelIds }
    const before = new Set(beforeLabelIds)
    return {
        added: addLabelIds.filter(labelId => !before.has(labelId)),
        removed: removeLabelIds.filter(labelId => before.has(labelId)),
    }
}

async function updateConnectedAccountMessage({ userId, account, messageId, addLabelIds, removeLabelIds }) {
    const gmail = await getGmailClient(userId, account.projectId)
    const { byId, byName } = await loadLabelMaps(gmail)
    const resolvedAddLabelIds = resolveRequestedLabelIds(addLabelIds, byName)
    const resolvedRemoveLabelIds = resolveRequestedLabelIds(removeLabelIds, byName)
    const beforeChange = await readMessageBeforeChange(gmail, messageId)
    const changedLabelIds = computeChangedLabelIds(beforeChange?.labelIds, resolvedAddLabelIds, resolvedRemoveLabelIds)

    const response = await gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
            addLabelIds: resolvedAddLabelIds,
            removeLabelIds: resolvedRemoveLabelIds,
        },
    })

    const updatedMessage = response?.data || {}
    const updatedLabelIds = Array.isArray(updatedMessage.labelIds) ? updatedMessage.labelIds : []

    return {
        success: true,
        projectId: account.projectId,
        gmailEmail: account.gmailEmail || null,
        messageId: updatedMessage.id || messageId,
        threadId: updatedMessage.threadId || '',
        appliedChanges: {
            addLabelIds: resolvedAddLabelIds,
            removeLabelIds: resolvedRemoveLabelIds,
        },
        labelIds: updatedLabelIds,
        labelNames: updatedLabelIds.map(labelId => byId.get(labelId) || labelId),
        subject: beforeChange?.subject || '',
        // What really changed, by label name (system labels keep their id: INBOX, UNREAD, ...).
        changedLabels: {
            added: changedLabelIds.added.map(labelId => byId.get(labelId) || labelId),
            removed: changedLabelIds.removed.map(labelId => byId.get(labelId) || labelId),
        },
        archived: !updatedLabelIds.includes('INBOX'),
        message: `Updated Gmail message ${updatedMessage.id || messageId} in ${
            account.gmailEmail || 'the connected Gmail account'
        }.`,
    }
}

async function updateGmailEmailForAssistantRequest({
    userId,
    messageId,
    projectId = '',
    addLabelIds,
    removeLabelIds,
    markUnread,
    starred,
    important,
}) {
    const normalizedUserId = typeof userId === 'string' ? userId.trim() : ''
    const normalizedMessageId = typeof messageId === 'string' ? messageId.trim() : ''
    const normalizedProjectId = typeof projectId === 'string' ? projectId.trim() : ''

    if (!normalizedUserId) {
        return { success: false, message: 'Gmail email update requires a valid requesting user.' }
    }

    if (!normalizedMessageId) {
        return { success: false, message: 'Gmail email update requires an exact messageId.' }
    }

    const normalizedChanges = buildLabelMutationState({
        addLabelIds,
        removeLabelIds,
        markUnread,
        starred,
        important,
    })

    if (normalizedChanges.addLabelIds.length === 0 && normalizedChanges.removeLabelIds.length === 0) {
        return {
            success: false,
            message: 'Gmail email update requires at least one label or property change.',
        }
    }

    const accounts = await getConnectedGmailAccounts(normalizedUserId)
    if (accounts.length === 0) {
        const microsoftAccounts = await getConnectedMicrosoftEmailAccounts(normalizedUserId).catch(() => [])
        if (microsoftAccounts.length === 0) {
            return {
                success: false,
                message: 'No connected email accounts were found for this user. Please connect Email first.',
            }
        }
        return updateMicrosoftEmailForAssistantRequest({
            userId,
            messageId,
            projectId,
            addLabelIds: normalizedChanges.addLabelIds,
            removeLabelIds: normalizedChanges.removeLabelIds,
            markUnread,
            important,
        })
    }

    const candidateAccounts = normalizedProjectId
        ? [
              ...accounts.filter(
                  account =>
                      account.projectId === normalizedProjectId || account.connectionProjectId === normalizedProjectId
              ),
              ...accounts.filter(
                  account =>
                      account.projectId !== normalizedProjectId && account.connectionProjectId !== normalizedProjectId
              ),
          ]
        : accounts

    for (const account of candidateAccounts) {
        try {
            return await updateConnectedAccountMessage({
                userId: normalizedUserId,
                account,
                messageId: normalizedMessageId,
                addLabelIds: normalizedChanges.addLabelIds,
                removeLabelIds: normalizedChanges.removeLabelIds,
            })
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

    const microsoftResult = await updateMicrosoftEmailForAssistantRequest({
        userId,
        messageId,
        projectId,
        addLabelIds: normalizedChanges.addLabelIds,
        removeLabelIds: normalizedChanges.removeLabelIds,
        markUnread,
        important,
    }).catch(() => null)
    if (microsoftResult?.success) return microsoftResult

    return {
        success: false,
        message: 'No matching email message was found for that messageId in the connected accounts.',
    }
}

module.exports = {
    buildLabelMutationState,
    computeChangedLabelIds,
    normalizeStringList,
    resolveRequestedLabelIds,
    updateConnectedAccountMessage,
    updateGmailEmailForAssistantRequest,
}
