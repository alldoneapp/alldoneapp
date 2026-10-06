'use strict'

function listContactStatuses(project = {}) {
    return Object.entries(project.contactStatuses || {})
        .filter(([, status]) => status && typeof status.name === 'string')
        .map(([id, status]) => ({ id, name: status.name }))
}

function hasContactStatusUpdate(args = {}) {
    return args.contactStatusId !== undefined || args.contactStatusName !== undefined
}

function normalizeName(value) {
    return value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
}

function resolveContactStatusUpdate(args = {}, project = {}) {
    if (!hasContactStatusUpdate(args)) return { success: true, updates: {} }

    const statuses = listContactStatuses(project)
    const fail = message => ({ success: false, message, availableContactStatuses: statuses })
    for (const field of ['contactStatusId', 'contactStatusName']) {
        if (args[field] !== undefined && typeof args[field] !== 'string') {
            return fail(`${field} must be a string. Use an empty string to clear the Kontaktstatus.`)
        }
    }

    const id = args.contactStatusId?.trim()
    const name = args.contactStatusName?.trim()
    if ((id === '' && name) || (name === '' && id)) {
        return fail('contactStatusId and contactStatusName conflict. Provide one status or clear both.')
    }
    if (!id && !name) return { success: true, updates: { contactStatusId: null }, status: null }

    const byId = id ? statuses.find(status => status.id === id) : null
    if (id && !byId) return fail(`Kontaktstatus ID "${id}" does not exist in the target project.`)
    if (byId && name && normalizeName(byId.name) !== normalizeName(name)) {
        return fail(`contactStatusId "${id}" does not match contactStatusName "${name}".`)
    }

    const matches = byId ? [byId] : statuses.filter(status => normalizeName(status.name) === normalizeName(name))
    if (matches.length === 0) return fail(`Kontaktstatus "${name}" does not exist in the target project.`)
    if (matches.length > 1) return fail(`Multiple Kontaktstatus entries match "${name}". Use contactStatusId.`)

    return { success: true, updates: { contactStatusId: matches[0].id }, status: matches[0] }
}

module.exports = { listContactStatuses, hasContactStatusUpdate, resolveContactStatusUpdate }
