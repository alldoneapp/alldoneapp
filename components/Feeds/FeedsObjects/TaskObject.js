import React from 'react'
import { View, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import TaskObjectHeader from './TaskObjectHeader'
import TaskObjectBody from './TaskObjectBody'
import { objectIsLockedForUser } from '../../Guides/guidesHelper'

export default function TaskObject({ feedObjectData, projectId, feedViewData, feedActiveTab, style }) {
    const unlockedKeysByGuides = useSelector(state => state.loggedUser.unlockedKeysByGuides)

    const { object, feeds } = feedObjectData
    const { taskId, lastChangeDate, lockKey, userId } = object
    const { type: viewType } = feedViewData

    const isLocked = objectIsLockedForUser(projectId, unlockedKeysByGuides, lockKey ? lockKey : '', userId)

    return (
        <View style={[style, isLocked && localStyles.blurry]} pointerEvents={isLocked ? 'none' : 'auto'}>
            {viewType !== 'task' && <TaskObjectHeader feed={object} projectId={projectId} isLocked={isLocked} />}
            <TaskObjectBody
                feeds={feeds}
                taskId={taskId}
                projectId={projectId}
                lastChangeDate={lastChangeDate}
                feedActiveTab={feedActiveTab}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    blurry: {
        filter: 'blur(3px)',
        userSelect: 'none',
    },
})
