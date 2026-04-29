import React from 'react'
import { StyleSheet, View, Text } from 'react-native'

import styles, { colors } from '../../../styles/global'
import InstructionsWrapper from './InstructionsWrapper'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'
import PromptHistoryWrapper from '../PromptHistory/PromptHistoryWrapper'
import {
    ASSISTANT_PROMPT_FIELD_INSTRUCTIONS,
    ASSISTANT_PROMPT_HISTORY_FIELD_INSTRUCTIONS,
    updateAssistantInstructions,
} from '../../../../utils/backends/Assistants/assistantsFirestore'

export default function InstructionsProperty({ disabled, projectId, assistant }) {
    const restorePrompt = instructions => {
        updateAssistantInstructions(projectId, assistant, instructions)
    }

    return (
        <View style={localStyles.container}>
            <Icon name="assistant" size={24} color={colors.Text03} style={localStyles.icon} />
            <Text style={localStyles.text}>{translate('System Message Instructions')}</Text>
            <View style={localStyles.buttons}>
                <PromptHistoryWrapper
                    disabled={disabled}
                    projectId={projectId}
                    assistant={assistant}
                    promptField={ASSISTANT_PROMPT_FIELD_INSTRUCTIONS}
                    historyField={ASSISTANT_PROMPT_HISTORY_FIELD_INSTRUCTIONS}
                    currentPrompt={assistant.instructions || ''}
                    title={translate('Recover a system prompt version')}
                    description={translate('Select a system prompt version to recover')}
                    restorePrompt={restorePrompt}
                />
                <InstructionsWrapper disabled={disabled} projectId={projectId} assistant={assistant} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        maxHeight: 56,
        minHeight: 56,
        height: 56,
        paddingLeft: 8,
        paddingVertical: 8,
        alignItems: 'center',
    },
    icon: {
        marginRight: 8,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
    buttons: {
        marginLeft: 'auto',
        flexDirection: 'row',
        alignItems: 'center',
    },
    button: {
        marginHorizontal: 0,
    },
})
