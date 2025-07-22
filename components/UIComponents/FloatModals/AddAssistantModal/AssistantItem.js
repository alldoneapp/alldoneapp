import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import AssistantAvatar from '../../../AdminPanel/Assistants/AssistantAvatar'
import { getPopoverWidth } from '../../../../utils/HelperFunctions'

export default function AssistantItem({ assistant, selectAssistant, assistantProjectId }) {
    const { displayName, description, photoURL50 } = assistant

    const selectOption = () => {
        selectAssistant(assistantProjectId, { ...assistant, fromTemplate: false })
    }

    return (
        <TouchableOpacity style={localStyles.container} onPress={selectOption}>
            <View style={localStyles.containerOption}>
                <AssistantAvatar photoURL={photoURL50} assistantId={assistant.uid} size={32} />
                <View style={{ justifyContent: 'center' }}>
                    <Text style={localStyles.name}>{displayName}</Text>
                    <View style={{ maxWidth: getPopoverWidth() - 72 }}>
                        <Text numberOfLines={1} style={localStyles.description}>
                            {description}
                        </Text>
                    </View>
                </View>
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 60,
        paddingVertical: 8,
        flexDirection: 'row',
    },
    containerOption: {
        flexDirection: 'row',
    },
    name: {
        ...styles.subtitle1,
        color: '#ffffff',
        marginLeft: 8,
    },
    description: {
        ...styles.caption2,
        color: colors.Text03,
        marginLeft: 8,
    },
})
