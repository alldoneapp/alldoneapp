import { useEffect, useState } from 'react'
import v4 from 'uuid/v4'

import Backend from '../../../utils/BackendBridge'
import { watchSubscriptionPaidByOtherUser } from '../../../utils/backends/Premium/premiumFirestore'

export default function useSubscriptionPaidByOtherUser(userId) {
    const [subscriptionPaidByOtherUser, setSubscriptionPaidByOtherUser] = useState(null)

    useEffect(() => {
        const watcherKey = v4()
        watchSubscriptionPaidByOtherUser(userId, watcherKey, setSubscriptionPaidByOtherUser)
        return () => {
            Backend.unwatch(watcherKey)
        }
    }, [])
    return subscriptionPaidByOtherUser
}
