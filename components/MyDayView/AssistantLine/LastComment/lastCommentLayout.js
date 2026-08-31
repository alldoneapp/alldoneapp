// Shared by the real preview, its empty state, and the startup ghost. Keeping
// these values dependency-free prevents a loading placeholder from importing
// the complete comment rendering and navigation graph.
export const PREVIEW_LINE_HEIGHT = 22
export const PREVIEW_TITLE_HEIGHT = PREVIEW_LINE_HEIGHT
export const PREVIEW_BODY_HEIGHT = PREVIEW_LINE_HEIGHT * 2
export const PREVIEW_VERTICAL_PADDING = 12
export const LAST_COMMENT_PREVIEW_HEIGHT = PREVIEW_TITLE_HEIGHT + PREVIEW_BODY_HEIGHT + PREVIEW_VERTICAL_PADDING * 2
