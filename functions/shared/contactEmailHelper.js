'use strict'

const { normalizeEmailAddress } = require('../Email/emailChannelHelpers')

function normalizeContactEmails(emails = []) {
    const normalized = []
    const seen = new Set()

    emails.forEach(email => {
        const nextEmail = normalizeEmailAddress(email)
        if (!nextEmail || seen.has(nextEmail)) return
        seen.add(nextEmail)
        normalized.push(nextEmail)
    })

    return normalized
}

function getContactEmails(contact = {}) {
    const candidates = []
    if (Array.isArray(contact.emails)) candidates.push(...contact.emails)
    if (contact.email) candidates.push(contact.email)
    return normalizeContactEmails(candidates)
}

function buildContactEmailFields(contact = {}, nextEmail = '', options = {}) {
    const normalizedNextEmail = normalizeEmailAddress(nextEmail)
    const currentEmails = getContactEmails(contact)
    const mergedEmails = normalizeContactEmails(
        normalizedNextEmail ? [...currentEmails, normalizedNextEmail] : currentEmails
    )
    const replacePrimary = options.replacePrimary !== false

    let primaryEmail = normalizeEmailAddress(contact.email)
    if (!primaryEmail && normalizedNextEmail) {
        primaryEmail = normalizedNextEmail
    } else if (replacePrimary && normalizedNextEmail) {
        primaryEmail = normalizedNextEmail
    }

    return {
        email: primaryEmail || '',
        emails: mergedEmails,
    }
}

module.exports = {
    buildContactEmailFields,
    getContactEmails,
    normalizeContactEmails,
}
