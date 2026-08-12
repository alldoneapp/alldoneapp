import { useEffect, useState } from 'react'

/**
 * Should opening the comment pop-up focus its input — and therefore, on a phone,
 * raise the software keyboard? (AT-2269)
 *
 * The pop-up used to share `shouldAutoFocusChatInput` with the full Chat detailed
 * view, which answers a plainly different question. Arriving in a chat thread on a
 * phone usually means "let me read this", so covering the history with the keyboard
 * is wrong there. Tapping the comment badge on a task means "let me say something",
 * so the keyboard should already be up. One helper could not hold both answers, so
 * the pop-up now owns this one and the Chat DV keeps `shouldAutoFocusChatInput`
 * unchanged.
 *
 * DESKTOP IS NOT AFFECTED. It has always auto-focused and still always does; every
 * rule below is gated on `mobile`, so the only behaviour that moves is the phone's.
 *
 * The one mobile exception is an UNREAD thread: if there is something new to read
 * (a fresh assistant reply, someone else's comment), the keyboard would cover the
 * very thing the user tapped in to see. So focus is skipped there, exactly as the
 * deleted `useShouldAutoFocusChatInput` used to do for every platform.
 *
 * That exception has to be STICKY, and this is the whole reason a hook exists
 * instead of a plain function. The pop-up calls `markChatMessagesAsRead` on mount
 * whenever it has unread comments, so `chatNotifications` drops to zero within a
 * few hundred ms of opening. A stateless rule would therefore answer "unread, do
 * not focus" on the first frame and "read, focus now" immediately after — popping
 * the keyboard up anyway, a beat late, over the comment the user was mid-way
 * through reading. Responsive state can settle after mount for the same reason, so
 * a suppression is kept for the lifetime of this opening once anything asks for it.
 *
 * Stickiness is deliberately one-directional: it can only ever keep the keyboard
 * DOWN. Unread state that arrives just after mount still suppresses focus (the
 * caller's focus timer is cancelled when this flips), but nothing here can turn a
 * suppressed opening back into a focused one.
 */

export const hasUnreadChatComments = chatNotifications =>
    Number(chatNotifications?.totalFollowed || 0) > 0 || Number(chatNotifications?.totalUnfollowed || 0) > 0

export function shouldSuppressCommentPopupAutoFocus({
    mobile = false,
    chatNotifications = null,
    openedFromUnreadComment = false,
} = {}) {
    if (!mobile) return false
    return openedFromUnreadComment || hasUnreadChatComments(chatNotifications)
}

// What the pop-up's focus effect should do on this render.
//
// `MOUNT_ONLY` and `NONE` both mean "the effect touches nothing", but for opposite
// reasons, and keeping them apart is what stops the mobile case from being
// "simplified" back into the desktop one later: MOUNT_ONLY means the input has
// ALREADY been focused by its own `autoFocus` during the opening tap and must be
// left alone, while NONE means this surface opted out of focus handling entirely.
export const COMMENT_POPUP_FOCUS_NONE = 'none'
export const COMMENT_POPUP_FOCUS_BLUR = 'blur'
export const COMMENT_POPUP_FOCUS_MOUNT_ONLY = 'mount-only'
export const COMMENT_POPUP_FOCUS_DELAYED = 'delayed'

export function resolveCommentPopupFocusAction({ inSuggested = false, shouldAutoFocus = false, mobile = false } = {}) {
    if (inSuggested) return COMMENT_POPUP_FOCUS_NONE
    if (!shouldAutoFocus) return COMMENT_POPUP_FOCUS_BLUR
    if (mobile) return COMMENT_POPUP_FOCUS_MOUNT_ONLY
    return COMMENT_POPUP_FOCUS_DELAYED
}

export default function useCommentPopupAutoFocus({
    mobile = false,
    chatNotifications = null,
    openedFromUnreadComment = false,
} = {}) {
    const suppressAutoFocus = shouldSuppressCommentPopupAutoFocus({
        mobile,
        chatNotifications,
        openedFromUnreadComment,
    })
    const [openedWithoutAutoFocus, setOpenedWithoutAutoFocus] = useState(suppressAutoFocus)

    useEffect(() => {
        if (suppressAutoFocus) setOpenedWithoutAutoFocus(true)
    }, [suppressAutoFocus])

    return !suppressAutoFocus && !openedWithoutAutoFocus
}
