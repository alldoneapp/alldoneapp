import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import AssistantAvatar from '../../../AdminPanel/Assistants/AssistantAvatar'
import { getPopoverWidth } from '../../../../utils/HelperFunctions'
import { getAssistantInProjectObject } from '../../../AdminPanel/Assistants/assistantsHelper'
import Icon from '../../../Icon'
import { shrinkTagText } from '../../../../functions/Utils/parseTextUtils'

export default function AssistantItem({
    projectId,
    assistant,
    updateAssistant,
    currentAssistantId,
    closeModal,
    isDefaultProjectOption,
}) {
    const smallScreen = useSelector(state => state.smallScreen)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const { displayName, description, photoURL50, uid } = assistant

    // For the "default project assistant" option, check if current matches the default project assistant
    const selected = isDefaultProjectOption
        ? currentAssistantId === assistant.uid
        : assistant.uid === currentAssistantId ||
          assistant.uid === getAssistantInProjectObject(projectId, currentAssistantId).uid

    console.log('[AssistantItem] Selection state:', {
        isDefaultProjectOption,
        assistantUid: assistant.uid,
        assistantName: displayName,
        currentAssistantId,
        selected,
        checkResult: isDefaultProjectOption ? `${currentAssistantId} === ${assistant.uid}` : 'regular check',
    })

    const selectOption = () => {
        // If it's the default project option, resolve the actual assistant ID from default project
        const assistantIdToSet = isDefaultProjectOption ? assistant.uid : uid

        console.log('[AssistantItem] Selecting assistant:', {
            isDefaultProjectOption,
            assistantName: displayName,
            assistantIdToSet,
            previousAssistantId: currentAssistantId,
            willUpdate: isDefaultProjectOption || !currentAssistantId || assistant.uid !== currentAssistantId,
        })

        if (isDefaultProjectOption || !currentAssistantId || assistant.uid !== currentAssistantId) {
            updateAssistant(assistantIdToSet)
        }
        closeModal()
    }

    return (
        <TouchableOpacity
            style={[localStyles.container, selected && localStyles.selectedContainer]}
            onPress={selectOption}
        >
            <View style={localStyles.containerOption}>
                <View style={{ flexDirection: 'row' }}>
                    <AssistantAvatar photoURL={photoURL50} assistantId={uid} size={32} />
                    <View style={{ justifyContent: 'center' }}>
                        <Text style={localStyles.name}>
                            {shrinkTagText(displayName, smallScreenNavigation ? 18 : smallScreen ? 25 : 30)}
                        </Text>
                        <View style={{ maxWidth: getPopoverWidth() - 72 }}>
                            <Text numberOfLines={1} style={localStyles.description}>
                                {description}
                            </Text>
                        </View>
                    </View>
                </View>
                {selected && <Icon name={'check'} size={24} color="white" style={{ marginLeft: 'auto', right: 11 }} />}
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 60,
        padding: 8,
        flexDirection: 'row',
    },
    containerOption: {
        flexDirection: 'row',
        flex: 1,
        justifyContent: 'space-between',
        alignItems: 'center',
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
    selectedContainer: {
        backgroundColor: '#1e2a51',
        borderRadius: 4,
    },
    checkMark: {
        position: 'absolute',
        right: -2,
        bottom: -2,
    },
})
