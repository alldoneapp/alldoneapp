import { useEffect, useRef } from 'react'
import { useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import { isWorkstream } from '../../Workstreams/WorkstreamHelper'
import {
    unwatchOpenTasksAmount,
    watchObservedOpenTasksAmount,
    watchOpenTasksAmount,
    watchUserWorkstreamsOpenTasksAmount,
} from '../../../utils/backends/Tasks/taskNumbers'

export default function OpenTasksAmountContainer({ projectIds }) {
    const countLaterTasks = useSelector(state => state.laterTasksExpanded)
    const countSomedayTasks = useSelector(state => state.somedayTasksExpanded)

    const isAssistant = useSelector(state => !!state.currentUser.temperature)
    const isContact = useSelector(state => !!state.currentUser.recorderUserId)
    const userId = useSelector(state => state.currentUser.uid)
    const userWorkstreams = useSelector(state => state.currentUser.workstreams)

    const amountsByProject = useRef({ total: 0 })

    const userWorkstreamsString = userWorkstreams
        ? JSON.stringify(Object.keys(userWorkstreams).sort()) + JSON.stringify(Object.values(userWorkstreams).sort())
        : ''
    const projectIdsString = JSON.stringify(projectIds)

    useEffect(() => {
        const isUser = !isAssistant && !isContact && !isWorkstream(userId)

        const normalWatcherKeys = projectIds.map(() => v4())
        watchOpenTasksAmount(
            projectIds,
            userId,
            countLaterTasks,
            countSomedayTasks,
            amountsByProject.current,
            normalWatcherKeys
        )

        let observedWatcherKeys = []
        let userWorkstreamsWatcherKeys = []

        if (isUser) {
            observedWatcherKeys = projectIds.map(() => v4())
            watchObservedOpenTasksAmount(
                projectIds,
                userId,
                countLaterTasks,
                countSomedayTasks,
                amountsByProject.current,
                observedWatcherKeys
            )
            userWorkstreamsWatcherKeys = projectIds.map(() => v4())
            watchUserWorkstreamsOpenTasksAmount(
                projectIds,
                userWorkstreams,
                countLaterTasks,
                countSomedayTasks,
                amountsByProject.current,
                userWorkstreamsWatcherKeys
            )
        }

        return () => {
            unwatchOpenTasksAmount([...normalWatcherKeys, ...observedWatcherKeys, ...userWorkstreamsWatcherKeys])
            amountsByProject.current = { total: 0 }
        }
    }, [projectIdsString, userId, countLaterTasks, countSomedayTasks, userWorkstreamsString])

    return null
}
