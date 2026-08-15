export const BOTTOM_SHEET_UPWARD_DRAG_LIMIT = 48
export const BOTTOM_SHEET_DISMISS_DISTANCE = 96
export const BOTTOM_SHEET_DISMISS_MIN_FLICK_DISTANCE = 24
export const BOTTOM_SHEET_DISMISS_VELOCITY = 0.8

export const BOTTOM_SHEET_RELEASE_VELOCITY_WINDOW_MS = 100

export const getBottomSheetUpwardDragLimit = ({ windowHeight, bottomInset, sheetHeight, safeAreaTop, topGap }) => {
    const restingTop = windowHeight - bottomInset - sheetHeight
    const availableTopClearance = restingTop - safeAreaTop - topGap

    return Math.min(BOTTOM_SHEET_UPWARD_DRAG_LIMIT, Math.max(availableTopClearance, 0))
}

export const clampBottomSheetDrag = (distance, sheetHeight, upwardDragLimit = BOTTOM_SHEET_UPWARD_DRAG_LIMIT) => {
    const safeDistance = Number.isFinite(distance) ? distance : 0
    const downwardLimit = Math.max(Number.isFinite(sheetHeight) ? sheetHeight : 0, BOTTOM_SHEET_DISMISS_DISTANCE)
    const safeUpwardLimit = Number.isFinite(upwardDragLimit)
        ? Math.min(Math.max(upwardDragLimit, 0), BOTTOM_SHEET_UPWARD_DRAG_LIMIT)
        : BOTTOM_SHEET_UPWARD_DRAG_LIMIT

    return Math.min(Math.max(safeDistance, -safeUpwardLimit), downwardLimit)
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
