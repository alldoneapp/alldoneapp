import { useEffect, useState } from 'react'

import { getNewEmailCommentIds } from './linkedEmailActions'

// Opening a thread clears its notification documents immediately. Capture the
// IDs first so each new email stays labelled for the lifetime of the open view.
export default function useNewEmailCommentIds(threadKey, chatNotifications) {
    const notificationIds = getNewEmailCommentIds(chatNotifications)
    const [captured, setCaptured] = useState({ threadKey, ids: notificationIds })
    const visibleIds =
        captured.threadKey === threadKey ? [...new Set([...captured.ids, ...notificationIds])] : notificationIds
    const notificationKey = notificationIds.join('|')

    useEffect(() => {
        setCaptured({ threadKey, ids: visibleIds })
    }, [threadKey, notificationKey])

    return new Set(visibleIds)
}
