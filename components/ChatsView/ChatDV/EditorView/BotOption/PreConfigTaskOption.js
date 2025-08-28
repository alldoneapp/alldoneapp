import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { useDispatch } from 'react-redux'

import styles from '../../../../styles/global'
import { setAssistantEnabled } from '../../../../../redux/actions'
import { TASK_TYPE_PROMPT } from '../../../../UIComponents/FloatModals/PreConfigTaskModal/TaskModal'

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
            <Text style={localStyles.text}>{name}</Text>
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
    text: {
        ...styles.subtitle1,
        color: '#FFFFFF',
    },
})
