import { useState, useEffect } from 'react'
import v4 from 'uuid/v4'

import { watchEarlierDoneSubtasks } from '../../../utils/backends/doneTasks'
import Backend from '../../../utils/BackendBridge'

export default function useEarlierSubtasks(project, completedDateToCheck) {
    const [earlierSubtasksByTask, setEarlierSubtasksByTask] = useState({})

    useEffect(() => {
        const watcherKey = v4()
        watchEarlierDoneSubtasks(project, watcherKey, setEarlierSubtasksByTask, completedDateToCheck)
        return () => {
            Backend.unwatch(watcherKey)
        }
    }, [completedDateToCheck])

    return earlierSubtasksByTask
}
