'use strict'

const SibApiV3Sdk = require('sib-api-v3-sdk')

const { getEnvFunctions } = require('../envFunctionsHelper')
const { DEFAULT_EMAIL_SIGNATURE, normalizeEmailAddressList } = require('./emailChannelHelpers')

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

function escapeHtmlWithLinks(value = '') {
    const input = String(value || '')
    const urlRegex = /https?:\/\/[^\s<>"']+/g
    let result = ''
    let lastIndex = 0
    let match

    while ((match = urlRegex.exec(input)) !== null) {
        const url = match[0]
        result += escapeHtml(input.slice(lastIndex, match.index))
        const escapedUrl = escapeHtml(url)
        result += `<a href="${escapedUrl}" style="color: #1a73e8;">${escapedUrl}</a>`
        lastIndex = match.index + url.length
    }

    result += escapeHtml(input.slice(lastIndex))
    return result
}

function resolveEmailSignature(emailSignature) {
    return typeof emailSignature === 'string' ? emailSignature : DEFAULT_EMAIL_SIGNATURE
}

function buildSignatureHtml(emailSignature) {
    const signature = resolveEmailSignature(emailSignature)
    if (!signature.trim()) return ''

    const lines = signature.split('\n').map(line => `<div>${escapeHtmlWithLinks(line)}</div>`)
    return `
            <div style="margin-top: 24px; color: #5f6368;">
                ${lines.join('')}
            </div>
    `
}

function buildReplyHtml(replyText = '', emailSignature) {
    const content = escapeHtml(replyText).replace(/\n/g, '<br />')
    const signatureHtml = buildSignatureHtml(emailSignature)
    return `
        <div style="font-family: Arial, sans-serif; color: #202124; line-height: 1.5;">
            <p>${content}</p>
            ${signatureHtml}
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
    emailSignature,
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
        htmlContent: buildReplyHtml(replyText, emailSignature),
        headers,
    }
    if (normalizedCcEmails.length > 0) message.cc = normalizedCcEmails.map(email => ({ email }))

    await transactionalApi.sendTransacEmail(message)
    return { success: true, toEmails: normalizedToEmails, ccEmails: normalizedCcEmails }
}

module.exports = {
    DEFAULT_EMAIL_SIGNATURE,
    sendAnnaEmailReply,
    __private__: {
        buildReplyHtml,
        buildSignatureHtml,
        escapeHtmlWithLinks,
        resolveEmailSignature,
    },
}
