import React, { useEffect } from 'react'
import { View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import { watchTask } from '../../utils/backends/Tasks/tasksFirestore'
import { unwatch } from '../../utils/backends/firestore'
import { setTaskInFocus } from '../../redux/actions'

export default function InFocusTaskWatcher({}) {
    const dispatch = useDispatch()
    const inFocusTaskId = useSelector(state => state.loggedUser.inFocusTaskId)
    const inFocusTaskProjectId = useSelector(state => state.loggedUser.inFocusTaskProjectId)

    const updateTaskInFocus = task => {
        dispatch(setTaskInFocus(task))
    }

    useEffect(() => {
        if (inFocusTaskId && inFocusTaskProjectId) {
            const watcherKey = v4()
            watchTask(inFocusTaskProjectId, inFocusTaskId, watcherKey, updateTaskInFocus)
            return () => {
                unwatch(watcherKey)
            }
        } else {
            updateTaskInFocus(null)
        }
    }, [inFocusTaskProjectId, inFocusTaskId])

    return <View />
}
