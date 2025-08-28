import { useEffect } from 'react'
import { useSelector } from 'react-redux'
import { usePrevious } from '../utils/UsePrevious'
import moment from 'moment'
import Backend from '../utils/BackendBridge'
import { setUserLastDayEmptyInbox } from '../utils/backends/Users/usersFirestore'

export default function useReachEmptyInbox() {
    const taskAmount = useAllProjectsTaskAmount()
    const loggedUser = useSelector(state => state.loggedUser)
    const { lastDayEmptyInbox } = loggedUser
    const previousAmount = usePrevious(taskAmount)

    useEffect(() => {
        if (previousAmount > 0 && taskAmount === 0) {
            const lastDateMoment = moment(lastDayEmptyInbox)
            const today = moment()

            if (lastDateMoment.isBefore(today, 'day')) {
                setUserLastDayEmptyInbox(loggedUser.uid, today.valueOf())
                Backend.logEvent('empty_inbox', {
                    userUid: loggedUser.uid,
                })
            }
        }
    }, [taskAmount])

    return null
}

const useAllProjectsTaskAmount = () => {
    const sidebarNumbers = useSelector(state => state.sidebarNumbers)
    const loggedUser = useSelector(state => state.loggedUser)
    const { templateProjectIds, archivedProjectIds } = loggedUser
    let taskAmount = 0

    for (let projectId in sidebarNumbers) {
        if (
            sidebarNumbers[projectId][loggedUser.uid] &&
            !templateProjectIds.includes(projectId) &&
            !archivedProjectIds.includes(projectId)
        ) {
            taskAmount += sidebarNumbers[projectId][loggedUser.uid]
        }
    }

    return taskAmount
}
