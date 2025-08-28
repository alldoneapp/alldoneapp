import { useEffect } from 'react'
import { useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import { unwatchWorkflowTasksAmount, watchWorkflowTasksAmount } from '../../../utils/backends/Tasks/taskNumbers'

export default function WorkflowTasksAmountContainer({ projectIds }) {
    const userId = useSelector(state => state.currentUser.uid)

    useEffect(() => {
        const watcherKeys = projectIds.map(() => v4())
        watchWorkflowTasksAmount(projectIds, userId, watcherKeys)
        return () => {
            unwatchWorkflowTasksAmount(watcherKeys)
        }
    }, [projectIds, userId])

    return null
}
