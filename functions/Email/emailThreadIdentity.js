'use strict'

const { createHash } = require('crypto')

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : ''
}

function hashParts(parts) {
    return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

// Provider IDs are opaque and case-sensitive. Account addresses are case-insensitive;
// project/connection IDs are not account identities (one mailbox can be routed to many projects).
function getEmailIdentity(userId, gmailData = {}) {
    const ownerId = normalizeString(userId)
    const email = normalizeString(gmailData.gmailEmail || gmailData.email).toLowerCase()
    const provider = normalizeString(gmailData.provider) || 'google'
    const threadId = normalizeString(gmailData.threadId)
    const messageId = normalizeString(gmailData.messageId)
    if (!ownerId || !email || !['google', 'microsoft'].includes(provider) || !messageId) return null
    return {
        ownerId,
        email,
        provider,
        threadId,
        messageId,
        // Missing thread IDs must never group unrelated mail together.
        key: hashParts([ownerId, provider, email, threadId ? 'thread' : 'message', threadId || messageId]),
        messageKey: hashParts([ownerId, provider, email, messageId]),
    }
}

function matchesEmailAccount(gmailData, identity) {
    if (!gmailData || !identity) return false
    const email = normalizeString(gmailData.gmailEmail || gmailData.email).toLowerCase()
    const provider = normalizeString(gmailData.provider) || 'google'
    const ownerId = normalizeString(gmailData.accountUserId)
    // Legacy Gmail follow-ups have no provider/owner field, but do carry the account address.
    // Never infer the account from project or connection IDs when the address is missing.
    return email === identity.email && provider === identity.provider && (!ownerId || ownerId === identity.ownerId)
}

function matchesEmailThread(gmailData, identity) {
    if (!matchesEmailAccount(gmailData, identity)) return false
    if (identity.threadId) return normalizeString(gmailData.threadId) === identity.threadId
    return [gmailData.messageId, ...(Array.isArray(gmailData.messageIds) ? gmailData.messageIds : [])].includes(
        identity.messageId
    )
}

module.exports = { getEmailIdentity, matchesEmailAccount, matchesEmailThread, hashParts }
