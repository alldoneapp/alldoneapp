'use strict'

const SibApiV3Sdk = require('sib-api-v3-sdk')

const { getEnvFunctions } = require('../envFunctionsHelper')

const defaultClient = SibApiV3Sdk.ApiClient.instance
const apiKey = defaultClient.authentications['api-key']
const { SIB_API_KEY } = getEnvFunctions()
apiKey.apiKey = SIB_API_KEY

const transactionalApi = new SibApiV3Sdk.TransactionalEmailsApi()

function escapeHtml(value = '') {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function buildReplyHtml(replyText = '') {
    const content = escapeHtml(replyText).replace(/\n/g, '<br />')
    return `
        <div style="font-family: Arial, sans-serif; color: #202124; line-height: 1.5;">
            <p>${content}</p>
        </div>
    `
}

async function sendAnnaEmailReply({
    toEmail,
    subject,
    replyText,
    inReplyTo = '',
    references = '',
    fromEmail = '',
    fromName = 'Anna at Alldone',
}) {
    const recipient = String(toEmail || '')
        .trim()
        .toLowerCase()
    if (!recipient) {
        return { success: false, skipped: true, reason: 'missing_recipient' }
    }

    const senderEmail = String(fromEmail || '').trim() || 'noreply@alldone.app'
    const headers = { Connection: 'keep-alive' }
    if (inReplyTo) headers['In-Reply-To'] = inReplyTo
    if (references) headers['References'] = references

    const message = {
        sender: { email: senderEmail, name: fromName },
        to: [{ email: recipient }],
        subject: String(subject || '').trim() || 'Re: Anna at Alldone',
        htmlContent: buildReplyHtml(replyText),
        headers,
    }

    await transactionalApi.sendTransacEmail(message)
    return { success: true }
}

module.exports = {
    sendAnnaEmailReply,
}
