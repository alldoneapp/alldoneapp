export const PROVIDER_GOOGLE = 'google'
export const PROVIDER_MICROSOFT = 'microsoft'

export function resolveEmailConnection(connection = {}) {
    if (connection?.email) {
        const provider = connection.emailProvider || (connection.gmail ? PROVIDER_GOOGLE : '')
        return {
            connected: true,
            provider,
            email: connection.emailAddress || connection.gmailEmail || '',
            isDefault: connection.emailDefault === true || connection.gmailDefault === true,
        }
    }

    if (connection?.gmail) {
        return {
            connected: true,
            provider: PROVIDER_GOOGLE,
            email: connection.gmailEmail || '',
            isDefault: connection.gmailDefault === true,
        }
    }

    return { connected: false, provider: '', email: '', isDefault: false }
}

export function resolveCalendarConnection(connection = {}) {
    if (!connection?.calendar) return { connected: false, provider: '', email: '', isDefault: false }
    return {
        connected: true,
        provider: connection.calendarProvider || PROVIDER_GOOGLE,
        email: connection.calendarEmail || '',
        isDefault: connection.calendarDefault === true,
    }
}

export function getProviderLabel(provider) {
    if (provider === PROVIDER_MICROSOFT) return 'Microsoft'
    return 'Google'
}
