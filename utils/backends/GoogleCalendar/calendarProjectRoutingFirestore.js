import { runHttpsCallableFunction } from '../firestore'
import { buildConnectionKeyPayload } from '../../IntegrationProviders'

// `key` is an account-level connection id (calendar_google_…) or a legacy projectId.

export async function getCalendarProjectRoutingConfig(key) {
    return await runHttpsCallableFunction('getCalendarProjectRoutingConfigSecondGen', buildConnectionKeyPayload(key))
}

export async function saveCalendarProjectRoutingConfig(key, config) {
    return await runHttpsCallableFunction('upsertCalendarProjectRoutingConfigSecondGen', {
        ...buildConnectionKeyPayload(key),
        config,
    })
}
