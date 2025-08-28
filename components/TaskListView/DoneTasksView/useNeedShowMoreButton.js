import { useState, useEffect } from 'react'
import v4 from 'uuid/v4'

import { watchIfNeedToShowTheShowMoreButton } from '../../../utils/backends/doneTasks'
import Backend from '../../../utils/BackendBridge'

export default function useNeedShowMoreButton(projectId, completedDateToCheck) {
    const [needShowMoreButton, setNeedShowMoreButton] = useState(false)

    useEffect(() => {
        const watcherKey = v4()
        watchIfNeedToShowTheShowMoreButton(projectId, watcherKey, setNeedShowMoreButton, completedDateToCheck)
        return () => {
            Backend.unwatch(watcherKey)
        }
    }, [completedDateToCheck])

    return needShowMoreButton
}
