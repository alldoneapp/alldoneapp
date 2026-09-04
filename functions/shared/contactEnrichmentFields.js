'use strict'

// Turns the arguments of the assistant's `update_contact` tool into the field updates the contact
// document accepts. Pure: the tool executor uploads the photo and writes the document.
//
// `email` is not handled here — `updateContactFields` owns the primary/alternate email merge and
// its feed, so the executor passes it through untouched.

const FIELD_LIMITS = {
    displayName: 120,
    company: 120,
    role: 160,
    phone: 60,
    description: 2000,
    linkedInUrl: 300,
}

const LINKEDIN_PROFILE_PATTERN = /^https?:\/\/([a-z0-9-]+\.)?linkedin\.com\/in\/[^\s?#]+/i

function cleanString(value, limit) {
    if (typeof value !== 'string') return null
    const trimmed = value.replace(/\s+/g, ' ').trim()
    if (!trimmed) return ''
    return trimmed.length > limit ? trimmed.slice(0, limit).trim() : trimmed
}

function cleanMultilineString(value, limit) {
    if (typeof value !== 'string') return null
    const trimmed = value
        .replace(/\r/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    if (!trimmed) return ''
    return trimmed.length > limit ? trimmed.slice(0, limit).trim() : trimmed
}

function normalizeLinkedInUrl(value) {
    const raw = cleanString(value, FIELD_LIMITS.linkedInUrl)
    if (raw === null) return { value: null }
    if (raw === '') return { value: '' }
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    if (!LINKEDIN_PROFILE_PATTERN.test(withProtocol)) {
        return { error: `linkedInUrl must be a LinkedIn profile URL (https://www.linkedin.com/in/...), got "${raw}".` }
    }
    // Drop tracking parameters and trailing slashes so the same profile always stores the same way.
    const url = new URL(withProtocol)
    url.search = ''
    url.hash = ''
    return { value: url.toString().replace(/\/+$/, '') }
}

function normalizePhotoUrl(value) {
    if (typeof value !== 'string') return { value: null }
    const raw = value.trim()
    if (!raw) return { value: '' }
    if (!/^https?:\/\//i.test(raw)) return { error: 'photoUrl must be an absolute http(s) URL to an image.' }
    return { value: raw }
}

/**
 * @returns {{ updates: object, photoUrl: string|null, clearPhoto: boolean, errors: string[] }}
 *   `updates` only carries fields the caller actually passed; an empty string clears the field.
 */
function buildContactUpdatesFromToolArgs(toolArgs = {}) {
    const updates = {}
    const errors = []

    const displayName = cleanString(toolArgs.displayName, FIELD_LIMITS.displayName)
    if (displayName !== null) {
        if (displayName === '') errors.push('displayName cannot be emptied.')
        else updates.displayName = displayName
    }

    const company = cleanString(toolArgs.company, FIELD_LIMITS.company)
    if (company !== null) updates.company = company

    const role = cleanString(toolArgs.role, FIELD_LIMITS.role)
    if (role !== null) updates.role = role

    const phone = cleanString(toolArgs.phone, FIELD_LIMITS.phone)
    if (phone !== null) updates.phone = phone

    const description = cleanMultilineString(toolArgs.description, FIELD_LIMITS.description)
    if (description !== null) {
        // The contact card renders `extendedDescription` (may carry mentions/links) and indexes the
        // plain `description`; the app writes both from one edit, so the tool does the same.
        updates.description = description
        updates.extendedDescription = description
    }

    const linkedIn = normalizeLinkedInUrl(toolArgs.linkedInUrl)
    if (linkedIn.error) errors.push(linkedIn.error)
    else if (linkedIn.value !== null) updates.linkedInUrl = linkedIn.value

    const photo = normalizePhotoUrl(toolArgs.photoUrl)
    if (photo.error) errors.push(photo.error)

    return {
        updates,
        photoUrl: photo.value ? photo.value : null,
        clearPhoto: photo.value === '',
        errors,
    }
}

function describeContactForPrompt(contact = {}) {
    const value = field => {
        const raw = contact[field]
        return typeof raw === 'string' && raw.trim() ? raw.trim() : '(empty)'
    }
    const emails = Array.isArray(contact.emails) && contact.emails.length ? contact.emails.join(', ') : value('email')
    return [
        `- Name: ${value('displayName')}`,
        `- Company: ${value('company')}`,
        `- Role: ${value('role')}`,
        `- Email: ${emails}`,
        `- Phone: ${value('phone')}`,
        `- LinkedIn: ${value('linkedInUrl')}`,
        `- Description: ${value('extendedDescription') === '(empty)' ? value('description') : value('extendedDescription')}`,
        `- Photo: ${typeof contact.photoURL === 'string' && contact.photoURL ? 'set' : '(none)'}`,
    ].join('\n')
}

module.exports = {
    FIELD_LIMITS,
    LINKEDIN_PROFILE_PATTERN,
    buildContactUpdatesFromToolArgs,
    describeContactForPrompt,
    normalizeLinkedInUrl,
}
