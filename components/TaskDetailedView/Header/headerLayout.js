// Vertical rhythm of the compact task header (AT-3081).
//
// The title block, the back arrow (inline on mobile/tablet, absolutely positioned in the left
// gutter on desktop) and the TASK/SUBTASK chip all have to line up on the first title line, so
// they read their offsets from here instead of three copies of a magic number. Before AT-3081 the
// spacer was 32px and the header also padded 32px under the title and 24px under the metadata row;
// together with the expanded workflow panel the chat tab spent ~250px before the first message.
export const TASK_HEADER_TOP_SPACING = 16

// One line of `styles.title4` (lineHeight 32) as the title renders it. Matches the back button's
// arrow row so the arrow sits centred on the first title line.
export const TASK_HEADER_TITLE_ROW_HEIGHT = 32

// Space between the title row and the metadata row, and under the metadata row.
export const TASK_HEADER_TITLE_GAP = 8
export const TASK_HEADER_BOTTOM_PADDING = 12

// The type chip is 14px tall and centred on the first title row: the same 9px below the spacer it
// always had (it used to be a literal `marginTop: 41` under the old 32px spacer).
export const TASK_HEADER_TYPE_CHIP_TOP = TASK_HEADER_TOP_SPACING + (TASK_HEADER_TITLE_ROW_HEIGHT - 14) / 2
