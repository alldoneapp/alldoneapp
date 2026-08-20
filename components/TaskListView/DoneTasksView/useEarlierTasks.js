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
    // AT-2382 - the size of the window the newest snapshot actually answered. Comparing it
    // against the requested size is what tells the list whether it is looking at settled
    // data or at a page still in flight, which nothing here could previously express: on
    // the very first expansion `earlierTasksByDate` is still `[]` while the list has
    // already switched away from today's tasks, so the whole section rendered blank.
    const [loadedAmount, setLoadedAmount] = useState(null)

    const updateTasks = (tasksByDate, estimationByDate, tasksAmount, earlierCompletedDateToCheck) => {
        setEarlierTasksByDate(tasksByDate)
        setEarlierEstimationByDate(estimationByDate)
        setEarlierCompletedDateToCheck(earlierCompletedDateToCheck)
        setLoadedAmount(tasksAmountToWatch)
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

    return {
        earlierTasksByDate,
        earlierEstimationByDate,
        earlierCompletedDateToCheck,
        loadingEarlierTasks: tasksAmountToWatch > 0 && loadedAmount !== tasksAmountToWatch,
    }
}
