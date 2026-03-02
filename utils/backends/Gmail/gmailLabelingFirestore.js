import { runHttpsCallableFunction } from '../firestore'

export async function getGmailLabelingConfig(projectId) {
    return await runHttpsCallableFunction('getGmailLabelingConfigSecondGen', { projectId })
}

export async function saveGmailLabelingConfig(projectId, config) {
    return await runHttpsCallableFunction('upsertGmailLabelingConfigSecondGen', { projectId, config })
}

export async function runGmailLabelingSync(projectId, forceBootstrap = false) {
    return await runHttpsCallableFunction(
        'runGmailLabelingSyncSecondGen',
        { projectId, forceBootstrap },
        { timeout: 120000 }
    )
}
