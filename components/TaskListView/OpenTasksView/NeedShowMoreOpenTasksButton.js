import { useEffect } from 'react'
import { useSelector, shallowEqual } from 'react-redux'
import v4 from 'uuid/v4'

import {
    unwatchIfNeedShowLaterOpenTasksButton,
    watchIfNeedShowLaterOpenTasksButton,
} from '../../../utils/backends/Tasks/tasksShowMoreButton'

export default function NeedShowMoreOpenTasksButton({ projectId }) {
    const userId = useSelector(state => state.currentUser.uid)
    const userWorkstream = useSelector(
        state => state.currentUser.workstreams && state.currentUser.workstreams[projectId],
        shallowEqual
    )

    const userWorkstreamIds = userWorkstream ? userWorkstream : []

    useEffect(() => {
        const laterNormalWatcherKey = v4()
        const laterObservedWatcherKey = v4()
        const laterUserWorkstreamsWatcherKey = v4()

        watchIfNeedShowLaterOpenTasksButton(
            projectId,
            userId,
            userWorkstreamIds,
            laterNormalWatcherKey,
            laterObservedWatcherKey,
            laterUserWorkstreamsWatcherKey,
            true,
            false
        )

        const somedayNormalWatcherKey = v4()
        const somedayObservedWatcherKey = v4()
        const somedayUserWorkstreamsWatcherKey = v4()

        watchIfNeedShowLaterOpenTasksButton(
            projectId,
            userId,
            userWorkstreamIds,
            somedayNormalWatcherKey,
            somedayObservedWatcherKey,
            somedayUserWorkstreamsWatcherKey,
            false,
            true
        )

        return () => {
            unwatchIfNeedShowLaterOpenTasksButton(
                projectId,
                [laterNormalWatcherKey, laterObservedWatcherKey, laterUserWorkstreamsWatcherKey],
                true,
                false
            )

            unwatchIfNeedShowLaterOpenTasksButton(
                projectId,
                [somedayNormalWatcherKey, somedayObservedWatcherKey, somedayUserWorkstreamsWatcherKey],
                false,
                true
            )
        }
    }, [projectId, userId, JSON.stringify(userWorkstreamIds)])

    return null
}
