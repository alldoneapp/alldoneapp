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

const getModelOptions = () => {
    return [
        { label: translate('Use assistant model'), value: INHERIT_ASSISTANT_MODEL },
        ...PRE_CONFIG_TASK_MODEL_OPTIONS.map(option => ({ ...option, label: translate(option.labelKey) })),
    ]
}

const TEMPERATURE_OPTIONS = [
    { label: translate('Very Low'), value: 'TEMPERATURE_VERY_LOW' },
    { label: translate('Low'), value: 'TEMPERATURE_LOW' },
    { label: translate('Normal'), value: 'TEMPERATURE_NORMAL' },
    { label: translate('High'), value: 'TEMPERATURE_HIGH' },
    { label: translate('Very High'), value: 'TEMPERATURE_VERY_HIGH' },
]

export default function AISettingsArea({
    disabled,
    aiModel,
    setAiModel,
    aiTemperature,
    setAiTemperature,
    aiSystemMessage,
    setAiSystemMessage,
    isMiddleScreen,
    smallScreenNavigation,
}) {
    const modelOptions = getModelOptions()

    console.log('AISettingsArea render:', {
        aiModel,
        aiTemperature,
        aiSystemMessage,
        modelOptions: modelOptions.map(opt => opt.value),
        tempOptions: TEMPERATURE_OPTIONS.map(opt => opt.value),
    })

    const handleModelChange = value => {
        console.log('Model change:', { from: aiModel, to: value })
        setAiModel(value)
    }

    const handleTemperatureChange = value => {
        console.log('Temperature change:', { from: aiTemperature, to: value })
        setAiTemperature(value)
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
                items={TEMPERATURE_OPTIONS}
                value={aiTemperature}
                setValue={handleTemperatureChange}
                placeholder={translate('Choose temperature')}
                header={translate('Temperature')}
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
