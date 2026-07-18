import { useEffect, useState } from 'react'

export const hasUnreadChatComments = chatNotifications =>
    Number(chatNotifications?.totalFollowed || 0) > 0 || Number(chatNotifications?.totalUnfollowed || 0) > 0

export default function useShouldAutoFocusChatInput(chatNotifications, openedFromUnreadComment = false) {
    const hasUnreadComments = openedFromUnreadComment || hasUnreadChatComments(chatNotifications)
    const [openedWithUnreadComments, setOpenedWithUnreadComments] = useState(hasUnreadComments)

    useEffect(() => {
        if (hasUnreadComments) setOpenedWithUnreadComments(true)
    }, [hasUnreadComments])

    // Reading a thread clears its notifications asynchronously. Keep the decision made while
    // opening sticky so that the input does not steal focus when the unread state disappears.
    // Include the live value to also suppress focus immediately if notifications hydrate late.
    return !hasUnreadComments && !openedWithUnreadComments
}
