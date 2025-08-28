import React from 'react'
import { TouchableOpacity, StyleSheet } from 'react-native-web'
import { useDispatch } from 'react-redux'

import { setAssistantEnabled, setSelectedNavItem } from '../../redux/actions'
import { colors } from '../styles/global'
import { getAssistantInProjectObject } from '../AdminPanel/Assistants/assistantsHelper'
import AssistantAvatar from '../AdminPanel/Assistants/AssistantAvatar'

export default function DvBotButton({ style, navItem, projectId, assistantId }) {
    const dispatch = useDispatch()

    const { photoURL50 } = getAssistantInProjectObject(projectId, assistantId)

    const navigateToChat = () => {
        dispatch([setSelectedNavItem(navItem), setAssistantEnabled(true)])
    }

    return (
        <TouchableOpacity style={[localStyles.container, style]} onPress={navigateToChat}>
            <AssistantAvatar photoURL={photoURL50} assistantId={assistantId} size={24} />
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        maxHeight: 32,
        minHeight: 32,
        borderWidth: 1,
        borderRadius: 4,
        flexDirection: 'row',
        backgroundColor: 'transparent',
        borderColor: colors.Gray400,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 7,
        paddingHorizontal: 7,
        marginRight: 8,
    },
})
