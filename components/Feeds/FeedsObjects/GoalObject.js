import React from 'react'
import { View, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import GoalObjectHeader from './GoalObjectHeader'
import GoalObjectBody from './GoalObjectBody'
import { objectIsLockedForUser } from '../../Guides/guidesHelper'

export default function GoalObject({ feedObjectData, projectId, feedViewData, feedActiveTab, style }) {
    const unlockedKeysByGuides = useSelector(state => state.loggedUser.unlockedKeysByGuides)
    const { object, feeds } = feedObjectData
    const { goalId, lastChangeDate, lockKey, ownerId } = object
    const { type: viewType } = feedViewData

    const isLocked = objectIsLockedForUser(projectId, unlockedKeysByGuides, lockKey ? lockKey : '', ownerId)
    return (
        <View style={[style, isLocked && localStyles.blurry]} pointerEvents={isLocked ? 'none' : 'auto'}>
            {viewType !== 'goal' && <GoalObjectHeader feed={object} projectId={projectId} isLocked={isLocked} />}
            <GoalObjectBody
                feeds={feeds}
                goalId={goalId}
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
