import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../../styles/global'
import GoldArea from '../../../TopBar/GoldArea'
import BotOptionsModalWrapper from './BotOptionsModalWrapper'
import CloseButton from './CloseButton'
import SharedHelper from '../../../../utils/SharedHelper'

export default function BotLine({
    setFullscreen,
    objectId,
    objectType,
    assistantId,
    setAssistantId,
    projectId,
    parentObject,
}) {
    const loggedUser = useSelector(state => state.loggedUser)
    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)

    // Anyone viewing this chat/note as a shared resource (anonymous viewers AND logged-in
    // non-members) gets a read-only view of just that resource. The assistant bar (avatar/name +
    // gold) is member-only chrome, so don't render it for them.
    if (!accessGranted) return null

    return (
        <View style={localStyles.container}>
            <View style={localStyles.leftArea}>
                <CloseButton setFullscreen={setFullscreen} />
                <BotOptionsModalWrapper
                    objectId={objectId}
                    objectType={objectType}
                    assistantId={assistantId}
                    setAssistantId={setAssistantId}
                    projectId={projectId}
                    parentObject={parentObject}
                />
            </View>
            <View style={localStyles.rightArea}>
                <GoldArea containerStyle={{ backgroundColor: '#ffffff' }} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'space-between',
        backgroundColor: colors.Grey100,
        paddingVertical: 8,
        borderRadius: 4,
    },
    leftArea: {
        flexDirection: 'row',
    },
    rightArea: {
        flexDirection: 'row',
        paddingVertical: 6,
        marginRight: 16,
    },
})
