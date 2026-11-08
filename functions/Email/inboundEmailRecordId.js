'use strict'

const crypto = require('crypto')

/**
 * Security audit 2026-11: an inbound email's Message-ID is chosen by whoever sent it, so it must
 * never be a key that another account's mail can share. Dedup and audit records are keyed by the
 * routed account plus a hash of the Message-ID (the hash also keeps a Message-ID containing `/`
 * from turning into a different document path). Mail that could not be routed to an account gets
 * its own `unrouted__` namespace.
 */
function buildInboundEmailRecordId(userId, messageId) {
    const owner = typeof userId === 'string' && userId.trim() ? userId.trim() : 'unrouted'
    const digest = crypto
        .createHash('sha256')
        .update(String(messageId || ''))
        .digest('hex')
        .slice(0, 40)
    return `${owner}__${digest}`
}

module.exports = { buildInboundEmailRecordId }
