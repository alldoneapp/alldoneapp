'use strict'

const EMAIL_PROVIDER_GOOGLE = 'google'
const EMAIL_PROVIDER_MICROSOFT = 'microsoft'
const CALENDAR_PROVIDER_GOOGLE = 'google'
const CALENDAR_PROVIDER_MICROSOFT = 'microsoft'

function normalizeProvider(value, fallback = '') {
    const provider = typeof value === 'string' ? value.trim().toLowerCase() : ''
    if (provider === EMAIL_PROVIDER_GOOGLE || provider === EMAIL_PROVIDER_MICROSOFT) return provider
    return fallback
}

function normalizeEmailAddress(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function resolveEmailConnection(connection = {}) {
    if (connection.email) {
        const provider = normalizeProvider(
            connection.emailProvider,
            connection.gmail || connection.gmailEmail ? EMAIL_PROVIDER_GOOGLE : ''
        )
        return {
            connected: true,
            provider,
            emailAddress:
                normalizeEmailAddress(connection.emailAddress) ||
                normalizeEmailAddress(connection.gmailEmail) ||
                normalizeEmailAddress(connection.email),
            isDefault: connection.emailDefault === true || connection.gmailDefault === true,
        }
    }

    if (connection.gmail) {
        return {
            connected: true,
            provider: EMAIL_PROVIDER_GOOGLE,
            emailAddress: normalizeEmailAddress(connection.gmailEmail),
            isDefault: connection.gmailDefault === true,
        }
    }

    return {
        connected: false,
        provider: '',
        emailAddress: '',
        isDefault: false,
    }
}

function resolveCalendarConnection(connection = {}) {
    if (!connection.calendar) {
        return {
            connected: false,
            provider: '',
            emailAddress: '',
            isDefault: false,
        }
    }

    return {
        connected: true,
        provider: normalizeProvider(connection.calendarProvider, CALENDAR_PROVIDER_GOOGLE),
        emailAddress: normalizeEmailAddress(connection.calendarEmail),
        isDefault: connection.calendarDefault === true,
    }
}

function buildEmailConnectionUpdate(projectId, provider, emailAddress, isDefault = false) {
    const normalizedProvider = normalizeProvider(provider)
    const normalizedEmail = normalizeEmailAddress(emailAddress)
    const updateData = {
        [`apisConnected.${projectId}.email`]: true,
        [`apisConnected.${projectId}.emailProvider`]: normalizedProvider,
        [`apisConnected.${projectId}.emailAddress`]: normalizedEmail,
        [`apisConnected.${projectId}.emailDefault`]: !!isDefault,
    }

    if (normalizedProvider === EMAIL_PROVIDER_GOOGLE) {
        updateData[`apisConnected.${projectId}.gmail`] = true
        updateData[`apisConnected.${projectId}.gmailEmail`] = normalizedEmail
        updateData[`apisConnected.${projectId}.gmailDefault`] = !!isDefault
    } else {
        updateData[`apisConnected.${projectId}.gmail`] = false
        updateData[`apisConnected.${projectId}.gmailDefault`] = false
    }

    return updateData
}

function buildCalendarConnectionUpdate(projectId, provider, emailAddress, isDefault = false) {
    return {
        [`apisConnected.${projectId}.calendar`]: true,
        [`apisConnected.${projectId}.calendarProvider`]: normalizeProvider(provider, CALENDAR_PROVIDER_GOOGLE),
        [`apisConnected.${projectId}.calendarEmail`]: normalizeEmailAddress(emailAddress),
        [`apisConnected.${projectId}.calendarDefault`]: !!isDefault,
    }
}

function hasExistingDefaultConnection(apisConnected = {}, resolver) {
    return Object.values(apisConnected).some(connection => resolver(connection).isDefault)
}

module.exports = {
    CALENDAR_PROVIDER_GOOGLE,
    CALENDAR_PROVIDER_MICROSOFT,
    EMAIL_PROVIDER_GOOGLE,
    EMAIL_PROVIDER_MICROSOFT,
    buildCalendarConnectionUpdate,
    buildEmailConnectionUpdate,
    hasExistingDefaultConnection,
    normalizeEmailAddress,
    normalizeProvider,
    resolveCalendarConnection,
    resolveEmailConnection,
}
