import { useEffect } from 'react'
import { useSelector, shallowEqual } from 'react-redux'
import v4 from 'uuid/v4'

import { watchOpenTasksShowMoreAvailability } from '../../../utils/backends/Tasks/tasksShowMoreButton'

export default function NeedShowMoreOpenTasksButton({ projectId, live = true }) {
    const userId = useSelector(state => state.currentUser.uid)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const userWorkstream = useSelector(
        state => state.currentUser.workstreams && state.currentUser.workstreams[projectId],
        shallowEqual
    )

    const userWorkstreamIds = userWorkstream ? userWorkstream : []

    useEffect(() => {
        const watcherKey = v4()
        return watchOpenTasksShowMoreAvailability({
            projectId,
            userId,
            userWorkstreamIds,
            isAnonymous,
            watcherKey,
            live,
        })
    }, [projectId, userId, isAnonymous, live, JSON.stringify(userWorkstreamIds)])

    return null
}
