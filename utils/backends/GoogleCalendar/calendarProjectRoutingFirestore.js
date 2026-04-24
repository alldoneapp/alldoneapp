import { runHttpsCallableFunction } from '../firestore'

export async function getCalendarProjectRoutingConfig(projectId) {
    return await runHttpsCallableFunction('getCalendarProjectRoutingConfigSecondGen', { projectId })
}

export async function saveCalendarProjectRoutingConfig(projectId, config) {
    return await runHttpsCallableFunction('upsertCalendarProjectRoutingConfigSecondGen', { projectId, config })
}
