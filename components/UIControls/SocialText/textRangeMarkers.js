/**
 * The pair of zero-size, hidden markers `Content` places around the title TEXT, and the ids that
 * address them.
 *
 * WHY A PAIR. `Content` lays a title out as a single `flexWrap` row whose children are, in order:
 * the leading chips from `LeftTagsAndIcons` (priority, Gmail, calendar, VM status, milestone date),
 * then one element per word/tag from `WordsList`, then the end marker. Nothing about that DOM says
 * where the chips stop and the text starts — `LeftTagsAndIcons` renders a FRAGMENT, so its output
 * are plain siblings of the words, and the number of chips varies per row. Anything that needs to
 * measure the text alone therefore has no way to address it.
 *
 * The end marker (`elementId` itself) has existed for a long time as an end-of-text POSITION probe:
 * `TasksHelper.showWrappedTaskEllipsis` reads its `bottom`/`left` to decide whether the title
 * overflowed. It is deliberately empty, so it is useless as a measurement TARGET — a range over its
 * contents selects nothing at all. Adding the matching start marker turns the two into boundaries:
 * a range from just after the start marker to just before the end marker contains exactly the
 * title's own words and inline tags, and nothing else.
 *
 * Both markers are empty, `visibility: hidden` and zero-size, so they take part in no layout and
 * cost nothing but a DOM node. See `TaskCompletionProgress.measureTitleLines` for the consumer.
 */

/**
 * The start marker's id, derived from the end marker's so the two can never be wired to different
 * elements. Returns undefined for a falsy id, which is the same condition under which `Content`
 * renders neither marker.
 */
export const getTextStartMarkerId = elementId => (elementId ? `${elementId}__text_start` : undefined)
