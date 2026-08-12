export const BOTTOM_SHEET_UPWARD_DRAG_LIMIT = 48
export const BOTTOM_SHEET_DISMISS_DISTANCE = 96
export const BOTTOM_SHEET_DISMISS_MIN_FLICK_DISTANCE = 24
export const BOTTOM_SHEET_DISMISS_VELOCITY = 0.8

export const BOTTOM_SHEET_RELEASE_VELOCITY_WINDOW_MS = 100

export const clampBottomSheetDrag = (distance, sheetHeight) => {
    const safeDistance = Number.isFinite(distance) ? distance : 0
    const downwardLimit = Math.max(Number.isFinite(sheetHeight) ? sheetHeight : 0, BOTTOM_SHEET_DISMISS_DISTANCE)

    return Math.min(Math.max(safeDistance, -BOTTOM_SHEET_UPWARD_DRAG_LIMIT), downwardLimit)
}

export const getBottomSheetReleaseVelocity = (samples, releasedAt, releasedY) => {
    const recentSamples = [...samples, { time: releasedAt, y: releasedY }].filter(
        sample => sample.time >= releasedAt - BOTTOM_SHEET_RELEASE_VELOCITY_WINDOW_MS
    )
    const firstSample = recentSamples[0]
    const elapsed = releasedAt - firstSample.time

    return elapsed > 0 ? (releasedY - firstSample.y) / elapsed : 0
}

export const shouldDismissBottomSheet = (distance, velocity) =>
    distance >= BOTTOM_SHEET_DISMISS_DISTANCE ||
    (distance >= BOTTOM_SHEET_DISMISS_MIN_FLICK_DISTANCE && velocity >= BOTTOM_SHEET_DISMISS_VELOCITY)
