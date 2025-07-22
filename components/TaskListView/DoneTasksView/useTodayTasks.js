import { useState, useEffect } from 'react'
import v4 from 'uuid/v4'

import { watchTodayDoneTasks } from '../../../utils/backends/doneTasks'
import Backend from '../../../utils/BackendBridge'

export default function useTodayTasks(project) {
    const [todayTasksByDate, setTodayTasksByDate] = useState([])
    const [todaySubtasksByTask, setTodaySubtasksByTask] = useState([])
    const [todayEstimationByDate, setTodayEstimationByDate] = useState({})

    const updateTasks = (tasksByDate, todaySubtasksByTask, estimationByDate) => {
        setTodayTasksByDate(tasksByDate)
        setTodaySubtasksByTask(todaySubtasksByTask)
        setTodayEstimationByDate(estimationByDate)
    }

    useEffect(() => {
        const watcherKey = v4()
        watchTodayDoneTasks(project, watcherKey, updateTasks)
        return () => {
            Backend.unwatch(watcherKey)
        }
    }, [])

    return { todayTasksByDate, todaySubtasksByTask, todayEstimationByDate }
}
