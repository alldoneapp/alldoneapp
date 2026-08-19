import React from 'react'
import { StyleSheet, View, Text } from 'react-native'
import { translate } from '../../../../i18n/TranslationService'
import styles, { colors } from '../../../styles/global'
import DropDown from './DropDown'
import CustomTextInput3 from '../../../Feeds/CommentsTextInput/CustomTextInput3'
import { NEW_TOPIC_MODAL_THEME } from '../../../Feeds/CommentsTextInput/textInputHelper'
import {
    INHERIT_ASSISTANT_MODEL,
    PRE_CONFIG_TASK_MODEL_OPTIONS,
} from '../../../../functions/Assistant/preConfigTaskModel'
import { PRE_CONFIG_TASK_REASONING_EFFORT_OPTIONS } from '../../../../functions/Assistant/preConfigTaskReasoningEffort'
import { getAssistantModelGoldRateText } from '../../AssistantModelGoldRate'

export const getModelOptions = () => {
    return [
        { label: translate('Use assistant model'), value: INHERIT_ASSISTANT_MODEL },
        ...PRE_CONFIG_TASK_MODEL_OPTIONS.map(option => ({
            ...option,
            label: `${translate(option.labelKey)} · ${getAssistantModelGoldRateText({
                tokensPerGold: option.tokensPerGold,
            })}`,
        })),
    ]
}

export const getReasoningEffortOptions = () =>
    PRE_CONFIG_TASK_REASONING_EFFORT_OPTIONS.map(option => ({
        ...option,
        label: translate(option.labelKey),
    }))

export default function AISettingsArea({
    disabled,
    aiModel,
    setAiModel,
    aiReasoningEffort,
    setAiReasoningEffort,
    aiSystemMessage,
    setAiSystemMessage,
    isMiddleScreen,
    smallScreenNavigation,
}) {
    const modelOptions = getModelOptions()
    const reasoningEffortOptions = getReasoningEffortOptions()

    const handleModelChange = value => {
        setAiModel(value)
    }

    const handleReasoningEffortChange = value => {
        setAiReasoningEffort(value)
    }

    return (
        <View style={localStyles.container}>
            <Text style={localStyles.header}>{translate('AI Settings')}</Text>

            <DropDown
                items={modelOptions}
                value={aiModel}
                setValue={handleModelChange}
                placeholder={translate('Choose AI model')}
                header={translate('AI Model')}
                containerStyle={{ marginTop: 12, zIndex: 3 }}
                disabled={disabled}
                arrowStyle={{
                    position: 'absolute',
                    top: -32,
                    left: smallScreenNavigation ? 232 : isMiddleScreen ? 296 : 360,
                }}
            />

            <DropDown
                items={reasoningEffortOptions}
                value={aiReasoningEffort}
                setValue={handleReasoningEffortChange}
                placeholder={translate('Reasoning effort')}
                header={translate('Reasoning effort')}
                containerStyle={{ marginTop: 12, zIndex: 2 }}
                disabled={disabled}
                arrowStyle={{
                    position: 'absolute',
                    top: -32,
                    left: smallScreenNavigation ? 232 : isMiddleScreen ? 296 : 360,
                }}
            />

            <View style={localStyles.section}>
                <Text style={localStyles.text}>{translate('System Message')}</Text>
                <CustomTextInput3
                    containerStyle={localStyles.input}
                    initialTextExtended={aiSystemMessage}
                    placeholder={translate('Enter custom system message for this task')}
                    placeholderTextColor={colors.Text03}
                    multiline={true}
                    onChangeText={setAiSystemMessage}
                    styleTheme={NEW_TOPIC_MODAL_THEME}
                    disabledTabKey={true}
                    disabledTags={true}
                    disabledEdition={disabled}
                    externalTextStyle={localStyles.textInputText}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 4,
        position: 'relative',
        zIndex: 10,
    },
    header: {
        ...styles.subtitle1,
        color: colors.Text01,
        marginBottom: 8,
    },
    section: {
        flex: 1,
        marginTop: 12,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text02,
        marginBottom: 4,
    },
    input: {
        ...styles.body1,
        color: '#ffffff',
        paddingVertical: 3,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 4,
        minHeight: 96,
        maxHeight: 96,
    },
    textInputText: {
        ...styles.body1,
        color: '#ffffff',
    },
})
