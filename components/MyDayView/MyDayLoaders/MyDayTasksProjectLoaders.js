import React, { useEffect } from 'react'
import { View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'
import v4 from 'uuid/v4'

import { watchObservedTasks, watchTasksToAttend } from '../../../utils/backends/Tasks/myDayTasks'
import { watchPendingTasksToReview } from '../../../utils/backends/Tasks/myDayWorkflowTasks'
import { unwatch } from '../../../utils/backends/firestore'
import { DEFAULT_WORKSTREAM_ID } from '../../Workstreams/WorkstreamHelper'
import MyDayTasksWorkstreamLoaders from './MyDayTasksWorkstreamLoaders'
import {
    clearMyDayAllTodayTasksInProject,
    clearMyDayWorkflowTasksInProject,
    clearMyDayDoneTasksInProject,
    clearOpenTasksShowMoreDataInProject,
} from '../../../redux/actions'
import { watchDoneTasks } from '../../../utils/backends/Tasks/myDayDoneTasks'
import {
    watchIfThereAreFutureAndSomedayEmptyGoals,
    watchIfThereAreFutureAndSomedayObservedTasks,
    watchIfThereAreFutureTasksToAttend,
    watchIfThereAreSomedayTasksToAttend,
} from '../../../utils/backends/Tasks/openTasksShowMore/openTasksShowMore'

export default function MyDayTasksProjectLoaders({ projectId }) {
    const dispatch = useDispatch()
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const workstreamsIds = useSelector(state => state.loggedUser.workstreams[projectId])

    const workstreamsToLoadIds = workstreamsIds ? [DEFAULT_WORKSTREAM_ID, ...workstreamsIds] : [DEFAULT_WORKSTREAM_ID]

    useEffect(() => {
        const watcherKey = v4()
        watchTasksToAttend(projectId, loggedUserId, watcherKey)
        return () => {
            unwatch(watcherKey)
        }
    }, [projectId, loggedUserId])

    useEffect(() => {
        const watcherKey = v4()
        watchObservedTasks(projectId, loggedUserId, watcherKey)
        return () => {
            unwatch(watcherKey)
        }
    }, [projectId, loggedUserId])

    useEffect(() => {
        const watcherKey = v4()
        watchPendingTasksToReview(projectId, loggedUserId, watcherKey)
        return () => {
            unwatch(watcherKey)
        }
    }, [projectId, loggedUserId])

    useEffect(() => {
        const watcherKey = v4()
        watchDoneTasks(projectId, loggedUserId, watcherKey)
        return () => {
            unwatch(watcherKey)
        }
    }, [projectId, loggedUserId])

    useEffect(() => {
        return () => {
            dispatch([
                clearMyDayAllTodayTasksInProject(projectId),
                clearMyDayWorkflowTasksInProject(projectId),
                clearMyDayDoneTasksInProject(projectId),
            ])
        }
    }, [])

    useEffect(() => {
        const watcherKey = v4()
        watchIfThereAreFutureTasksToAttend(projectId, loggedUserId, false, loggedUserId, watcherKey)
        return () => {
            unwatch(watcherKey)
        }
    }, [projectId, loggedUserId])

    useEffect(() => {
        const watcherKey = v4()
        watchIfThereAreSomedayTasksToAttend(projectId, loggedUserId, false, loggedUserId, watcherKey)
        return () => {
            unwatch(watcherKey)
        }
    }, [projectId, loggedUserId])

    useEffect(() => {
        const watcherKey = v4()
        watchIfThereAreFutureAndSomedayObservedTasks(projectId, loggedUserId, false, loggedUserId, watcherKey)
        return () => {
            unwatch(watcherKey)
        }
    }, [projectId, loggedUserId])

    useEffect(() => {
        const watcherKey = v4()
        watchIfThereAreFutureAndSomedayEmptyGoals(projectId, loggedUserId, false, loggedUserId, watcherKey)
        return () => {
            unwatch(watcherKey)
        }
    }, [projectId, loggedUserId])

    useEffect(() => {
        return () => {
            dispatch([clearOpenTasksShowMoreDataInProject(projectId)])
        }
    }, [])

    return (
        <View>
            {workstreamsToLoadIds.map(workstreamId => {
                return (
                    <MyDayTasksWorkstreamLoaders key={workstreamId} projectId={projectId} workstreamId={workstreamId} />
                )
            })}
        </View>
    )
}
