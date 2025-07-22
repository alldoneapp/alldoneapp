import { useState, useEffect } from 'react'
import v4 from 'uuid/v4'
import { useDispatch } from 'react-redux'
import moment from 'moment'

import { watchEarlierDoneTasks } from '../../../utils/backends/doneTasks'
import Backend from '../../../utils/BackendBridge'
import { setEarlierDoneTasksAmount } from '../../../redux/actions'

export default function useEarlierTasks(project, tasksAmountToWatch) {
    const dispatch = useDispatch()
    const [earlierTasksByDate, setEarlierTasksByDate] = useState([])
    const [earlierEstimationByDate, setEarlierEstimationByDate] = useState({})
    const [earlierCompletedDateToCheck, setEarlierCompletedDateToCheck] = useState(moment().valueOf())

    const updateTasks = (tasksByDate, estimationByDate, tasksAmount, earlierCompletedDateToCheck) => {
        setEarlierTasksByDate(tasksByDate)
        setEarlierEstimationByDate(estimationByDate)
        setEarlierCompletedDateToCheck(earlierCompletedDateToCheck)
        dispatch(setEarlierDoneTasksAmount(tasksAmount))
    }

    useEffect(() => {
        if (tasksAmountToWatch > 0) {
            const watcherKey = v4()
            watchEarlierDoneTasks(project, tasksAmountToWatch, watcherKey, updateTasks)
            return () => {
                Backend.unwatch(watcherKey)
                dispatch(setEarlierDoneTasksAmount(0))
            }
        }
    }, [tasksAmountToWatch])

    return { earlierTasksByDate, earlierEstimationByDate, earlierCompletedDateToCheck }
}
