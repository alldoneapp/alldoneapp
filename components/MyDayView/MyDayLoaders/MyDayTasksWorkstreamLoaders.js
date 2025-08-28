import React, { useEffect } from 'react'
import { View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'
import v4 from 'uuid/v4'

import { watchWorkstreamTasks } from '../../../utils/backends/Tasks/myDayTasks'
import { unwatch } from '../../../utils/backends/firestore'
import { clearMyDayAllTodayTasksInWorkstream, clearOpenTasksShowMoreDataInWorkstream } from '../../../redux/actions'
import {
    watchIfThereAreFutureWorkstreamTasks,
    watchIfThereAreSomedayWorkstreamTasks,
} from '../../../utils/backends/Tasks/openTasksShowMore/openTasksShowMore'

export default function MyDayTasksWorkstreamLoaders({ projectId, workstreamId }) {
    const dispatch = useDispatch()
    const loggedUserId = useSelector(state => state.loggedUser.uid)

    useEffect(() => {
        const watcherKey = v4()
        watchWorkstreamTasks(projectId, loggedUserId, workstreamId, watcherKey)
        return () => {
            unwatch(watcherKey)
        }
    }, [projectId, loggedUserId, workstreamId])

    useEffect(() => {
        return () => {
            dispatch(clearMyDayAllTodayTasksInWorkstream(projectId, workstreamId))
        }
    }, [])

    useEffect(() => {
        const watcherKey = v4()
        watchIfThereAreFutureWorkstreamTasks(projectId, workstreamId, false, loggedUserId, watcherKey)
        return () => {
            unwatch(watcherKey)
        }
    }, [projectId, loggedUserId, workstreamId])

    useEffect(() => {
        const watcherKey = v4()
        watchIfThereAreSomedayWorkstreamTasks(projectId, workstreamId, false, loggedUserId, watcherKey)
        return () => {
            unwatch(watcherKey)
        }
    }, [projectId, loggedUserId, workstreamId])

    useEffect(() => {
        return () => {
            dispatch(clearOpenTasksShowMoreDataInWorkstream(projectId, workstreamId))
        }
    }, [])

    return <View></View>
}
