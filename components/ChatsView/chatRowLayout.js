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
