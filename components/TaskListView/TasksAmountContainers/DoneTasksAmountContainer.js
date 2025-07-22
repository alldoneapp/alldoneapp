import { useEffect } from 'react'
import { useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import { unwatchDoneTasksAmount, watchDoneTasksAmount } from '../../../utils/backends/Tasks/taskNumbers'

export default function DoneTasksAmountContainer({ projectIds }) {
    const userId = useSelector(state => state.currentUser.uid)

    useEffect(() => {
        const watcherKeys = projectIds.map(() => v4())
        watchDoneTasksAmount(projectIds, userId, watcherKeys)
        return () => {
            unwatchDoneTasksAmount(watcherKeys)
        }
    }, [projectIds, userId])

    return null
}
