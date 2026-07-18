import { useEffect, useState } from 'react'

export const hasUnreadChatComments = chatNotifications =>
    Number(chatNotifications?.totalFollowed || 0) > 0 || Number(chatNotifications?.totalUnfollowed || 0) > 0

export default function useShouldAutoFocusChatInput(
    chatNotifications,
    { openedFromUnreadComment = false, mobile = false } = {}
) {
    const hasUnreadComments = openedFromUnreadComment || hasUnreadChatComments(chatNotifications)
    const suppressAutoFocus = mobile || hasUnreadComments
    const [openedWithoutAutoFocus, setOpenedWithoutAutoFocus] = useState(suppressAutoFocus)

    useEffect(() => {
        if (suppressAutoFocus) setOpenedWithoutAutoFocus(true)
    }, [suppressAutoFocus])

    // Reading clears notifications asynchronously, and responsive state can settle after mount.
    // Keep either reason for suppressing focus sticky for the lifetime of this thread opening.
    return !suppressAutoFocus && !openedWithoutAutoFocus
}
