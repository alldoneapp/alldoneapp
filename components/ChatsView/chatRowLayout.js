/**
 * Geometry of a chat-list row, in one place because two components have to agree on it.
 *
 * `ChatHeaderItem` *builds* the avatar column every row starts with, and the unread-message
 * preview underneath it *cancels* that column on phone widths (AT-2361) with a negative margin.
 * A negative margin that no longer matches the column it is cancelling is an invisible
 * misalignment - the preview would simply sit a few pixels off the row's left edge - so the two
 * numbers are shared rather than repeated.
 *
 * Kept as a leaf module with no imports: `ChatHeaderItem` reaches redux (through
 * `ChatHeaderMemeber` -> `useGetUserPresentationData` -> the store), and the preview must not pull
 * the whole store in just to read a width.
 */

// The avatar stack itself.
export const CHAT_AVATAR_COLUMN_WIDTH = 48

// The gutter between that stack and the row's content column.
export const CHAT_AVATAR_COLUMN_GUTTER = 16

// What a child of the content column has to cancel to reach the row's own left edge.
export const CHAT_AVATAR_COLUMN_TOTAL_WIDTH = CHAT_AVATAR_COLUMN_WIDTH + CHAT_AVATAR_COLUMN_GUTTER

// The thread rail the unread-message preview draws down its own left side. Part of the geometry
// because the *visible* indent a reader perceives is the rail plus its gutter, not the gutter
// alone - expressing the two separately is what let the phone gutter be tuned without anyone
// having to remember to add the 2px back in (AT-2368).
export const CHAT_PREVIEW_RAIL_WIDTH = 2

/**
 * How far the preview's text starts from the row's own left edge on phone widths.
 *
 * AT-2361 moved the preview out of the empty 64px avatar column and left it 10px from the edge,
 * which reads as flush: the email text hugs the rail and the block loses its relationship to the
 * row it belongs to. AT-2368 rebalances it to 16px - the same 16px gutter the rest of the row
 * uses, so it lines up with the list's own rhythm - which is still ~96% of a 390px screen for the
 * subject, body and the Email / Create task / Archive email / Unsubscribe row, i.e. the width
 * AT-2361 bought is kept.
 */
export const CHAT_PREVIEW_MOBILE_INDENT = 16

// What the container actually sets: the indent minus the rail it already draws.
export const CHAT_PREVIEW_MOBILE_GUTTER = CHAT_PREVIEW_MOBILE_INDENT - CHAT_PREVIEW_RAIL_WIDTH
