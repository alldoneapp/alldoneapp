import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { colors } from '../../../styles/global'
import styles from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import CustomTextInput3 from '../../../Feeds/CommentsTextInput/CustomTextInput3'
import { NEW_TOPIC_MODAL_THEME } from '../../../Feeds/CommentsTextInput/textInputHelper'

export default function WebhookArea({
    disabled,
    webhookUrl,
    setWebhookUrl,
    webhookAuth,
    setWebhookAuth,
    webhookPrompt,
    setWebhookPrompt,
    webhookPromptInputRef,
}) {
    return (
        <View style={localStyles.container}>
            <Text style={localStyles.text}>{translate('Webhook URL')}</Text>
            <CustomTextInput3
                containerStyle={localStyles.input}
                initialTextExtended={webhookUrl || ''}
                placeholder={translate('Webhook URL placeholder')}
                placeholderTextColor={colors.Text03}
                multiline={false}
                onChangeText={setWebhookUrl}
                styleTheme={NEW_TOPIC_MODAL_THEME}
                disabledTabKey={true}
                disabledTags={true}
                disabledEdition={disabled}
            />

            <Text style={[localStyles.text, { marginTop: 12 }]}>{translate('Webhook Prompt (Optional)')}</Text>
            <CustomTextInput3
                ref={webhookPromptInputRef}
                containerStyle={localStyles.promptInput}
                initialTextExtended={webhookPrompt || ''}
                placeholder={translate('Enter the prompt to send to the webhook')}
                placeholderTextColor={colors.Text03}
                multiline={true}
                onChangeText={setWebhookPrompt}
                styleTheme={NEW_TOPIC_MODAL_THEME}
                disabledTabKey={true}
                disabledTags={true}
                disabledEdition={disabled}
            />

            <Text style={[localStyles.text, { marginTop: 12 }]}>{translate('Authorization Header (Optional)')}</Text>
            <CustomTextInput3
                containerStyle={localStyles.input}
                initialTextExtended={webhookAuth || ''}
                placeholder={translate('Authorization Header placeholder')}
                placeholderTextColor={colors.Text03}
                multiline={false}
                onChangeText={setWebhookAuth}
                styleTheme={NEW_TOPIC_MODAL_THEME}
                disabledTabKey={true}
                disabledTags={true}
                disabledEdition={disabled}
            />

            <Text style={[localStyles.helperText, { marginTop: 8 }]}>
                {translate('The webhook will receive this prompt and call back when complete')}
            </Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
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
        minHeight: 42,
        maxHeight: 42,
    },
    promptInput: {
        ...styles.body1,
        color: '#ffffff',
        paddingVertical: 3,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 4,
        minHeight: 96,
        maxHeight: 150,
    },
    helperText: {
        ...styles.caption,
        color: colors.Text03,
    },
})
