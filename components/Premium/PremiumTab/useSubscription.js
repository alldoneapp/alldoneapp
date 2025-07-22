import { useEffect, useState } from 'react'
import v4 from 'uuid/v4'

import Backend from '../../../utils/BackendBridge'
import { watchSubscription } from '../../../utils/backends/Premium/premiumFirestore'

export default function useSubscription(userId) {
    const [subscription, setSubscription] = useState(null)

    useEffect(() => {
        const watcherKey = v4()
        watchSubscription(userId, watcherKey, setSubscription)
        return () => {
            Backend.unwatch(watcherKey)
        }
    }, [])

    return subscription
}
