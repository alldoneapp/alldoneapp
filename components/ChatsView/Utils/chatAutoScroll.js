// A chat is anchored at its BOTTOM: the newest message is where the reader belongs unless they
// deliberately went looking for an older one. So auto-scroll is not an event ("a message arrived,
// scroll") but a STATE — "is the reader parked at the newest message?" — and every producer of
// height (a new comment, a streaming answer growing three chunks a second, an image finishing its
// download, the mobile keyboard taking the viewport away) simply re-pins while that state holds.
//
// Modelling it as an event is what made the old implementation unreliable, in four separate ways
// that all read to the user as "it just doesn't scroll down" (AT-2439):
//
//   1. The flag was one-way. Any scroll landing more than the tolerance from the bottom cleared
//      it and NOTHING except sending a message ever set it back — so nudging the wheel once while
//      an answer streamed killed the follow for the rest of that answer, and coming back to the
//      newest message by hand did not re-arm it. `resolveStickToBottom` is two-way by
//      construction: it answers the question from the position alone, with no memory to get stuck
//      in.
//   2. A second latch ("show earlier") disabled auto-scroll permanently for the rest of the
//      mount, including for messages the reader then sent themselves. Position is the only input
//      now, so returning to the bottom is always enough.
//   3. The scroll was driven off the last message's id and text length, and fired one tick after
//      the message rendered — before markdown, code blocks, images and attachments had settled
//      their height. It therefore scrolled to the PREVIOUS content height and stopped a message
//      short. `shouldPinToBottom` moves the authority to the content-size signal, which by
//      definition arrives after the height is real, and repeats for every later growth.
//   4. Nothing re-pinned when the viewport shrank instead of the content growing (mobile
//      keyboard, composer growing to several lines), because that changes no content size and
//      fires no scroll event.

import { getChatScrollDistances } from './chatScrollFullscreen'

// How close to the newest message still counts as "reading the newest message". Deliberately
// generous: sub-pixel layout rounding, an in-flight momentum frame and web overscroll all leave
// the reader a few pixels off an exact bottom, and treating that as "gone browsing" is the whole
// bug. It stays well under the fullscreen ENTER tolerances in `chatScrollFullscreen.js`, so a
// position that still counts as pinned can never be one that expanded the layout.
export const CHAT_STICK_TO_BOTTOM_TOLERANCE = 50

/**
 * Is the reader parked at the newest message?
 *
 * This is the only writer of the pin: passing the raw scroll geometry in means the answer can
 * never disagree with what is actually on screen, which a remembered boolean eventually does.
 */
export const resolveStickToBottom = ({
    scrollY,
    contentHeight,
    viewportHeight,
    tolerance = CHAT_STICK_TO_BOTTOM_TOLERANCE,
}) => {
    const { distanceFromBottom } = getChatScrollDistances({ scrollY, contentHeight, viewportHeight })
    return distanceFromBottom <= tolerance
}

/**
 * Should a content-size report re-pin the thread to the newest message?
 *
 * Only a real height change counts. React Native Web reports the content size on layout passes
 * that did not resize anything, and re-issuing `scrollToEnd` on those would fight a reader who is
 * mid-drag at the very bottom of the thread — inside the tolerance, so still pinned — by yanking
 * the position back under their finger on every frame.
 */
export const shouldPinToBottom = ({ stickToBottom, contentHeight, previousContentHeight }) => {
    if (!stickToBottom) return false
    return (contentHeight || 0) !== (previousContentHeight || 0)
}
