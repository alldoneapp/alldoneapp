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
    webhookAuthHeaderName,
    setWebhookAuthHeaderName,
    webhookAuth,
    setWebhookAuth,
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

            <Text style={[localStyles.text, { marginTop: 12 }]}>
                {translate('Authorization Header Name (Optional)')}
            </Text>
            <CustomTextInput3
                containerStyle={localStyles.input}
                initialTextExtended={webhookAuthHeaderName || ''}
                placeholder={translate('Authorization Header Name placeholder')}
                placeholderTextColor={colors.Text03}
                multiline={false}
                onChangeText={setWebhookAuthHeaderName}
                styleTheme={NEW_TOPIC_MODAL_THEME}
                disabledTabKey={true}
                disabledTags={true}
                disabledEdition={disabled}
            />

            <Text style={[localStyles.text, { marginTop: 12 }]}>
                {translate('Authorization Header Value (Optional)')}
            </Text>
            <CustomTextInput3
                containerStyle={localStyles.input}
                initialTextExtended={webhookAuth || ''}
                placeholder={translate('Authorization Header Value placeholder')}
                placeholderTextColor={colors.Text03}
                multiline={false}
                onChangeText={setWebhookAuth}
                styleTheme={NEW_TOPIC_MODAL_THEME}
                disabledTabKey={true}
                disabledTags={true}
                disabledEdition={disabled}
            />

            <Text style={[localStyles.helperText, { marginTop: 8 }]}>
                {translate('Send messages in the chat to trigger the webhook')}
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
    helperText: {
        ...styles.caption,
        color: colors.Text03,
    },
})
