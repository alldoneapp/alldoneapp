/**
 * Where the chat composer actually PAINTS, and what has to stay clear of it (AT-2439 follow-up).
 *
 * `ChatInput`'s frame is `position: relative` with `bottom: 24`. A relative offset moves what is
 * painted and leaves the layout box where it was, so the composer covers the bottom 24px of the
 * scroller above it while that scroller still believes it owns those pixels. Nothing in the
 * scroller's own geometry says so: `CustomScrollView`'s container ends exactly at the composer's
 * FLOW top, which is 24px BELOW the edge the user sees — and on an iOS standalone PWA further
 * still, because `useHomeIndicatorLift` raises the composer clear of the home indicator.
 *
 * That is what put the "New message ↓" pill half behind the composer. The pill is
 * `position: absolute` inside that same container, so its `bottom` is measured from the flow edge;
 * anchoring it to a bare 12px gap parked it 12px INSIDE the covered strip, and the composer — a
 * later sibling with an opaque background and a shadow — painted straight over it.
 *
 * So the offset is shared from here rather than repeated as a literal at each end. The two numbers
 * are one fact about one edge, and a composer that moves without the pill following is not merely
 * a mispositioned pill: it is a pill that vanishes under an opaque box, which reads as the feature
 * being broken rather than as a spacing bug. That is exactly how this shipped.
 */

// Must equal `ChatInput`'s `localStyles.inputContainer.bottom` — it is imported there rather than
// written twice.
export const CHAT_COMPOSER_LIFT = 24

// The deliberate breathing room between the pill's bottom edge and the composer's painted top
// edge. It has to survive the composer's own drop shadow (`0px 4px 8px`, cast upward as well as
// down), so a token gap would still read as "touching".
export const NEW_MESSAGES_PILL_GAP = 12

// `ChatBoard` pulls its scroller 13px left so message bodies line up with the DV's content column.
// The composer is a sibling WITHOUT that margin, so anything centred inside the scroller lands
// 6.5px left of the composer it is supposed to sit above — visible on a 32px-tall pill against a
// full-width frame. The pill's strip adds this back to centre on the frame the user sees.
export const CHAT_BOARD_CONTENT_OFFSET = 13

const toLift = homeIndicatorLift =>
    Number.isFinite(homeIndicatorLift) && homeIndicatorLift > 0 ? homeIndicatorLift : 0

/**
 * How far above its own flow box the composer paints, i.e. how much of the scroller above it is
 * covered. `homeIndicatorLift` is `useHomeIndicatorLift()`, which is 0 on every surface without a
 * home indicator (desktop, Android, browser tabs), so callers pass it unconditionally.
 */
export const getChatComposerLift = homeIndicatorLift => CHAT_COMPOSER_LIFT + toLift(homeIndicatorLift)

/**
 * The `bottom` for the "New message ↓" pill, measured — like every absolutely positioned child of
 * the scroller — from the scroller's flow edge. Clearing the composer is not a nicety here: below
 * `getChatComposerLift(...)` the pill is not just tight, it is hidden.
 */
export const getNewMessagesPillBottom = homeIndicatorLift =>
    getChatComposerLift(homeIndicatorLift) + NEW_MESSAGES_PILL_GAP
