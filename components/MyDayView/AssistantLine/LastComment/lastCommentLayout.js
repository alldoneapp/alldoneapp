import { StyleSheet } from 'react-native'

// Shared by the real preview, its empty state, and the startup ghost. Keeping
// these values dependency-free prevents a loading placeholder from importing
// the complete comment rendering and navigation graph.
export const PREVIEW_LINE_HEIGHT = 22
export const PREVIEW_TITLE_HEIGHT = PREVIEW_LINE_HEIGHT
export const PREVIEW_BODY_HEIGHT = PREVIEW_LINE_HEIGHT * 2
export const PREVIEW_VERTICAL_PADDING = 12
export const LAST_COMMENT_PREVIEW_HEIGHT = PREVIEW_TITLE_HEIGHT + PREVIEW_BODY_HEIGHT + PREVIEW_VERTICAL_PADDING * 2

/**
 * The row's own box, applied by the card to each rolling layer. Exported rather than duplicated so
 * the outgoing and incoming layers can never be laid out differently — a difference of a single
 * pixel of padding would show as the text jogging sideways as the roll lands.
 *
 * AT-2523 — moved here from `LastCommentRow` so the card shell can lay a row out without importing
 * the row itself. That import is the whole comment/tag/navigation graph (hashtags, mentions, links,
 * `TasksHelper`, the redux store), and the pending-send card needs the geometry without any of it.
 * This module is the declared home for exactly that: values every consumer of the card shares,
 * carrying no dependencies of their own.
 */
export const rowStyles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        paddingHorizontal: 4,
        paddingVertical: PREVIEW_VERTICAL_PADDING,
    },
    compactRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 6,
        paddingRight: 10,
    },
})
