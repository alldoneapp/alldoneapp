// Shared geometry for controls that sit on the bottom edge of the viewport.
// Keeping the task action and the global loader on the same baseline prevents
// them from colliding while preserving a single, predictable floating layer.
export const FLOATING_ACTION_SIZE = 56
export const FLOATING_ACTION_VIEWPORT_GAP = 24
export const FLOATING_ACTION_POPOVER_GAP = 12
export const FLOATING_ACTION_STACK_GAP = 12
export const FLOATING_ACTION_CLEARANCE = FLOATING_ACTION_VIEWPORT_GAP + FLOATING_ACTION_SIZE + FLOATING_ACTION_STACK_GAP
export const LOADING_DATA_CONTAINER_SIZE = 48

export const getFloatingActionBottom = safeAreaBottom => FLOATING_ACTION_VIEWPORT_GAP + safeAreaBottom

export const getLoadingDataBottom = safeAreaBottom =>
    getFloatingActionBottom(safeAreaBottom) + (FLOATING_ACTION_SIZE - LOADING_DATA_CONTAINER_SIZE) / 2
