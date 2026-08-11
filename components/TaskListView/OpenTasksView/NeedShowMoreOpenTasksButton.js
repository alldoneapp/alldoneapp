import { useEffect } from 'react'
import { useSelector, shallowEqual } from 'react-redux'
import v4 from 'uuid/v4'

import {
    unwatchIfNeedShowLaterOpenTasksButton,
    watchIfNeedShowLaterOpenTasksButton,
} from '../../../utils/backends/Tasks/tasksShowMoreButton'
import {
    watchIfThereAreFutureTasksToAttend,
    watchIfThereAreFutureAndSomedayObservedTasks,
    watchIfThereAreFutureWorkstreamTasks,
    watchIfThereAreFutureAndSomedayEmptyGoals,
} from '../../../utils/backends/Tasks/openTasksShowMore/openTasksShowMore'
import { globalWatcherUnsub } from '../../../utils/backends/firestore'

export default function NeedShowMoreOpenTasksButton({ projectId }) {
    const userId = useSelector(state => state.currentUser.uid)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
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

        // START: Watchers for openTasksShowMoreData hasFutureTasks
        const futureNormalWatcherKey = v4()
        const futureObservedWatcherKey = v4()
        const futureGoalsWatcherKey = v4()
        const futureWorkstreamWatchersKeys = []

        watchIfThereAreFutureTasksToAttend(projectId, userId, isAnonymous, userId, futureNormalWatcherKey)

        watchIfThereAreFutureAndSomedayObservedTasks(projectId, userId, isAnonymous, userId, futureObservedWatcherKey)

        watchIfThereAreFutureAndSomedayEmptyGoals(projectId, userId, isAnonymous, userId, futureGoalsWatcherKey)

        userWorkstreamIds.forEach(wsId => {
            const key = v4()
            futureWorkstreamWatchersKeys.push(key)
            watchIfThereAreFutureWorkstreamTasks(projectId, wsId, isAnonymous, userId, key)
        })
        // END: Watchers for openTasksShowMoreData hasFutureTasks

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

            // Cleanup for future watchers
            if (globalWatcherUnsub[futureNormalWatcherKey]) globalWatcherUnsub[futureNormalWatcherKey]()
            if (globalWatcherUnsub[futureObservedWatcherKey]) globalWatcherUnsub[futureObservedWatcherKey]()
            if (globalWatcherUnsub[futureGoalsWatcherKey]) globalWatcherUnsub[futureGoalsWatcherKey]()
            futureWorkstreamWatchersKeys.forEach(key => {
                if (globalWatcherUnsub[key]) globalWatcherUnsub[key]()
            })
        }
    }, [projectId, userId, JSON.stringify(userWorkstreamIds)])

    return null
}
