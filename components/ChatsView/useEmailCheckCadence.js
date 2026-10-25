import { useEffect, useState } from 'react'

import { watchGmailLabelingConfigs } from '../../utils/backends/Gmail/gmailLabelingFirestore'
import { PROVIDER_GOOGLE, resolveEmailConnection } from '../../utils/IntegrationProviders'
import { getConfiguredSyncIntervalMinutes } from '../../functions/Gmail/gmailSyncInterval'

// Mirrors getGmailLabelingLookupKeys on the server: a migrated account config
// wins over a legacy per-project config for the same mailbox.
export function getEmailCheckConfigKeys(loggedUser, connection) {
    const email = connection.email.trim().toLowerCase()
    const legacyKeys = Object.entries(loggedUser.apisConnected || {})
        .filter(([, data]) => {
            const resolved = resolveEmailConnection(data)
            return resolved.provider === PROVIDER_GOOGLE && resolved.email.trim().toLowerCase() === email
        })
        .map(([projectId]) => projectId)
    return [...new Set([connection.connectionId, connection.defaultProjectId, ...legacyKeys].filter(Boolean))]
}

export function getEmailCheckCadence(loggedUser, connection, configs, error = false) {
    if (connection.provider !== PROVIDER_GOOGLE) return { status: 'unsupported' }
    if (loggedUser.premium?.status !== 'premium') return { status: 'premium_required' }
    if (error) return { status: 'unknown' }
    if (!configs) return { status: 'loading' }

    const config = getEmailCheckConfigKeys(loggedUser, connection)
        .map(key => configs[`gmailLabeling_${key}`])
        .find(Boolean)
    if (!config) return { status: 'unconfigured' }
    if (config.enabled !== true || config.migratedTo) return { status: 'disabled' }
    return { status: 'enabled', minutes: getConfiguredSyncIntervalMinutes(config) }
}

export function useEmailCheckCadence(loggedUser, connections) {
    const [snapshot, setSnapshot] = useState({ userId: '', configs: null, error: false })
    const userId = loggedUser.uid
    const shouldWatch =
        loggedUser.premium?.status === 'premium' && connections.some(c => c.provider === PROVIDER_GOOGLE)

    useEffect(() => {
        if (!userId || !shouldWatch) return undefined
        let cancelled = false
        setSnapshot({ userId, configs: null, error: false })
        const unsubscribe = watchGmailLabelingConfigs(
            userId,
            configs => {
                if (!cancelled) setSnapshot({ userId, configs, error: false })
            },
            () => {
                if (!cancelled) setSnapshot({ userId, configs: null, error: true })
            }
        )
        return () => {
            cancelled = true
            unsubscribe()
        }
    }, [userId, shouldWatch])

    return connections.map(connection =>
        getEmailCheckCadence(
            loggedUser,
            connection,
            snapshot.userId === userId ? snapshot.configs : null,
            snapshot.userId === userId && snapshot.error
        )
    )
}
