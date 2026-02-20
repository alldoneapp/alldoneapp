import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import CustomTextInput3 from '../../../Feeds/CommentsTextInput/CustomTextInput3'
import { NEW_TOPIC_MODAL_THEME } from '../../../Feeds/CommentsTextInput/textInputHelper'
import { translate } from '../../../../i18n/TranslationService'

export default function LinkArea({
    disabled,
    linkInputRef,
    link,
    setLink,
    isValid,
    showDiscoveryStatus = false,
    discoveryStatus = null,
}) {
    const trimmedLink = typeof link === 'string' ? link.trim() : ''
    const shouldShowStatus = showDiscoveryStatus && !!trimmedLink && isValid

    const getStatusData = () => {
        if (!shouldShowStatus) return null
        if (discoveryStatus?.loading) {
            return { text: translate('Discovering external tools...'), style: localStyles.statusPending }
        }
        if (Number.isFinite(discoveryStatus?.toolsCount) && discoveryStatus.toolsCount > 0) {
            return {
                text: translate('External tools discovered count', { count: discoveryStatus.toolsCount }),
                style: localStyles.statusSuccess,
            }
        }
        if (discoveryStatus?.error) {
            return { text: translate('External tool discovery failed'), style: localStyles.statusError }
        }
        return { text: translate('External tools will be discovered on save'), style: localStyles.statusPending }
    }

    const statusData = getStatusData()

    return (
        <View style={localStyles.section}>
            <Text style={localStyles.label}>{translate('Link')}</Text>
            <CustomTextInput3
                ref={linkInputRef}
                containerStyle={localStyles.input}
                initialTextExtended={link}
                placeholder={translate('Type the link')}
                placeholderTextColor={colors.Text03}
                multiline={true}
                onChangeText={setLink}
                styleTheme={NEW_TOPIC_MODAL_THEME}
                disabledTabKey={true}
                disabledTags={true}
                disabledEdition={disabled}
            />
            {!isValid && !!trimmedLink && <Text style={localStyles.feedback}>{translate('The link is invalid')}</Text>}
            {!!statusData && <Text style={[localStyles.feedback, statusData.style]}>{statusData.text}</Text>}
        </View>
    )
}

const localStyles = StyleSheet.create({
    section: {
        flex: 1,
        marginTop: 12,
    },
    label: {
        ...styles.subtitle2,
        color: colors.Text02,
        marginBottom: 4,
    },
    feedback: {
        ...styles.subtitle2,
        color: colors.Text02,
        marginTop: 4,
    },
    statusPending: {
        color: colors.Text03,
    },
    statusSuccess: {
        color: colors.Green300,
    },
    statusError: {
        color: colors.Yellow300,
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
})
