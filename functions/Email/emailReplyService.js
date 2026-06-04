'use strict'

const SibApiV3Sdk = require('sib-api-v3-sdk')

const { getEnvFunctions } = require('../envFunctionsHelper')
const { normalizeEmailAddressList } = require('./emailChannelHelpers')

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
    toEmails = [],
    ccEmails = [],
    subject,
    replyText,
    inReplyTo = '',
    references = '',
    fromEmail = '',
    fromName = 'Anna at Alldone',
}) {
    const normalizedToEmails = normalizeEmailAddressList([toEmail, ...toEmails])
    const normalizedCcEmails = normalizeEmailAddressList(ccEmails).filter(email => !normalizedToEmails.includes(email))
    if (normalizedToEmails.length === 0) {
        return { success: false, skipped: true, reason: 'missing_recipient' }
    }

    const senderEmail = String(fromEmail || '').trim() || 'noreply@alldone.app'
    const headers = { Connection: 'keep-alive' }
    if (inReplyTo) headers['In-Reply-To'] = inReplyTo
    if (references) headers['References'] = references

    const message = {
        sender: { email: senderEmail, name: fromName },
        to: normalizedToEmails.map(email => ({ email })),
        subject: String(subject || '').trim() || 'Re: Anna at Alldone',
        htmlContent: buildReplyHtml(replyText),
        headers,
    }
    if (normalizedCcEmails.length > 0) message.cc = normalizedCcEmails.map(email => ({ email }))

    await transactionalApi.sendTransacEmail(message)
    return { success: true, toEmails: normalizedToEmails, ccEmails: normalizedCcEmails }
}

module.exports = {
    sendAnnaEmailReply,
}
