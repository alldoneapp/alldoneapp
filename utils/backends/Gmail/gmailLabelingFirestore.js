import { runHttpsCallableFunction } from '../firestore'
import { buildConnectionKeyPayload } from '../../IntegrationProviders'

// `key` is an account-level connection id (email_google_…) or a legacy projectId.

export async function getGmailLabelingConfig(key) {
    return await runHttpsCallableFunction('getGmailLabelingConfigSecondGen', buildConnectionKeyPayload(key))
}

export async function saveGmailLabelingConfig(key, config) {
    return await runHttpsCallableFunction('upsertGmailLabelingConfigSecondGen', {
        ...buildConnectionKeyPayload(key),
        config,
    })
}

export async function runGmailLabelingSync(key, forceBootstrap = false) {
    return await runHttpsCallableFunction(
        'runGmailLabelingSyncSecondGen',
        { ...buildConnectionKeyPayload(key), forceBootstrap },
        { timeout: 120000 }
    )
}
