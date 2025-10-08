import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useDispatch } from 'react-redux'

import styles, { colors } from '../../../../styles/global'
import { setAssistantEnabled } from '../../../../../redux/actions'
import {
    TASK_TYPE_PROMPT,
    TASK_TYPE_EXTERNAL_LINK,
    TASK_TYPE_WEBHOOK,
} from '../../../../UIComponents/FloatModals/PreConfigTaskModal/TaskModal'
import Icon from '../../../../Icon'

export default function PreConfigTaskOption({ task, closeModal, selectTask, onSelectBotOption, inMyDay }) {
    const dispatch = useDispatch()
    const { name, prompt, variables, type, link, aiModel, aiTemperature, aiSystemMessage } = task

    console.log('PreConfigTaskOption selected:', {
        taskName: name,
        type,
        aiSettings: {
            model: aiModel,
            temperature: aiTemperature,
            systemMessage: aiSystemMessage,
        },
    })

    // Get icon based on task type
    const getIconForTaskType = () => {
        switch (type) {
            case TASK_TYPE_PROMPT:
                return 'message-square'
            case TASK_TYPE_EXTERNAL_LINK:
                return 'external-link'
            case TASK_TYPE_WEBHOOK:
                return 'link-2'
            default:
                return 'cpu' // fallback
        }
    }

    const onPress = () => {
        if (type === TASK_TYPE_PROMPT) {
            if (variables.length > 0) {
                selectTask(task)
            } else {
                closeModal()
                const aiSettings = {
                    model: aiModel,
                    temperature: aiTemperature,
                    systemMessage: aiSystemMessage,
                }
                onSelectBotOption(prompt, name, aiSettings)
                if (!inMyDay) dispatch(setAssistantEnabled(true))
            }
        } else {
            closeModal()
            window.open(link, '_blank')
        }
    }

    return (
        <TouchableOpacity style={localStyles.container} onPress={onPress}>
            <View style={localStyles.content}>
                <Icon name={getIconForTaskType()} size={20} color="#FFFFFF" style={localStyles.icon} />
                <Text style={localStyles.text}>{name}</Text>
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 48,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    icon: {
        marginRight: 8,
    },
    text: {
        ...styles.subtitle1,
        color: '#FFFFFF',
        flex: 1,
    },
})
