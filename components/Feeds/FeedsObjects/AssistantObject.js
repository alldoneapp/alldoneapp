import React from 'react'
import { View, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import AssistantObjectHeader from './AssistantObjectHeader'
import AssistantObjectBody from './AssistantObjectBody'
import { objectIsLockedForUser } from '../../Guides/guidesHelper'

export default function AssistantObject({ feedObjectData, projectId, feedViewData, feedActiveTab, style }) {
    const unlockedKeysByGuides = useSelector(state => state.loggedUser.unlockedKeysByGuides)
    const { object, feeds } = feedObjectData
    const { assistantId, lastChangeDate, lockKey, ownerId } = object
    const { type: viewType } = feedViewData

    const isLocked = objectIsLockedForUser(projectId, unlockedKeysByGuides, lockKey ? lockKey : '', ownerId)
    return (
        <View style={[style, isLocked && localStyles.blurry]} pointerEvents={isLocked ? 'none' : 'auto'}>
            {viewType !== 'assistant' && (
                <AssistantObjectHeader feed={object} projectId={projectId} isLocked={isLocked} />
            )}
            <AssistantObjectBody
                feeds={feeds}
                assistantId={assistantId}
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
