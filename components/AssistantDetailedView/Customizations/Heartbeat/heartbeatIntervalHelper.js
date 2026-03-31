import { translate } from '../../../../i18n/TranslationService'

export const HEARTBEAT_INTERVAL_STEP_MS = 5 * 60 * 1000
export const MIN_HEARTBEAT_INTERVAL_MS = HEARTBEAT_INTERVAL_STEP_MS
export const MAX_HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000

export function getHeartbeatIntervalMs(value) {
    const parsedValue = Number(value)

    if (!Number.isFinite(parsedValue)) {
        return DEFAULT_HEARTBEAT_INTERVAL_MS
    }

    const roundedValue = Math.round(parsedValue / HEARTBEAT_INTERVAL_STEP_MS) * HEARTBEAT_INTERVAL_STEP_MS
    return Math.min(MAX_HEARTBEAT_INTERVAL_MS, Math.max(MIN_HEARTBEAT_INTERVAL_MS, roundedValue))
}

export function getHeartbeatIntervalOptions() {
    const options = []

    for (
        let value = MIN_HEARTBEAT_INTERVAL_MS;
        value <= MAX_HEARTBEAT_INTERVAL_MS;
        value += HEARTBEAT_INTERVAL_STEP_MS
    ) {
        options.push(value)
    }

    return options
}

export function formatHeartbeatInterval(value) {
    const intervalMs = getHeartbeatIntervalMs(value)
    const minutes = Math.round(intervalMs / 60000)

    return minutes === 60 ? translate('1 hour') : `${minutes} ${translate('minutes')}`
}
