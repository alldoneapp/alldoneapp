'use strict'

/**
 * A webhook task's URL is member-configured, and the server POSTs to it. The check itself is the
 * shared outbound URL guard (`shared/outboundUrlGuard.js`); this module only keeps the webhook
 * wording of its errors. Callers must also pass `redirect: 'error'` so a public URL cannot bounce
 * the request inward, or use `fetchPublicUrl`, which re-checks every hop.
 */

const dns = require('dns').promises
const { assertPublicUrl, isPrivateAddress, OutboundUrlError } = require('../shared/outboundUrlGuard')

class WebhookDestinationError extends Error {
    constructor(message) {
        super(message)
        this.name = 'WebhookDestinationError'
    }
}

const WEBHOOK_MESSAGES = {
    invalid_url: 'The webhook URL could not be parsed.',
    unsupported_scheme: 'Only http and https webhook URLs are allowed.',
    credentials_in_url: 'Webhook URLs must not contain credentials.',
    unresolvable: 'The webhook host could not be resolved.',
    private_host: 'Private or internal webhook destinations are not allowed.',
}

async function assertPublicWebhookUrl(rawUrl, { lookup = dns.lookup } = {}) {
    try {
        const parsed = await assertPublicUrl(rawUrl, { lookup })
        return parsed.toString()
    } catch (error) {
        if (error instanceof OutboundUrlError) {
            throw new WebhookDestinationError(WEBHOOK_MESSAGES[error.code] || WEBHOOK_MESSAGES.private_host)
        }
        throw error
    }
}

module.exports = {
    assertPublicWebhookUrl,
    isPrivateAddress,
    WebhookDestinationError,
}
