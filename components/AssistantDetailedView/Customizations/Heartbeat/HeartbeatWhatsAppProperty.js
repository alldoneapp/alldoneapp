import React from 'react'
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { updateAssistantHeartbeatSettings } from '../../../../utils/backends/Assistants/assistantsFirestore'
import { translate } from '../../../../i18n/TranslationService'

export default function HeartbeatWhatsAppProperty({ disabled, projectId, assistant }) {
    const sendWhatsApp = assistant.heartbeatSendWhatsApp ?? false

    const toggleWhatsApp = () => {
        if (!disabled) {
            updateAssistantHeartbeatSettings(projectId, assistant, { heartbeatSendWhatsApp: !sendWhatsApp })
        }
    }

    return (
        <View style={localStyles.settingRow}>
            <View style={[localStyles.settingRowSection, localStyles.settingRowLeft]}>
                <Icon name={'message-circle'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                    {translate('WhatsApp notification')}
                </Text>
            </View>
            <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                <TouchableOpacity
                    style={[localStyles.checkboxContainer, sendWhatsApp && localStyles.checkboxActive]}
                    onPress={toggleWhatsApp}
                    disabled={disabled}
                >
                    {sendWhatsApp && <Icon name="check" size={16} color={colors.Primary500} />}
                </TouchableOpacity>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    settingRow: {
        height: 56,
        justifyContent: 'space-between',
        alignItems: 'center',
        flexDirection: 'row',
    },
    settingRowSection: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    settingRowLeft: {
        flex: 1,
        justifyContent: 'flex-start',
    },
    settingRowRight: {
        justifyContent: 'flex-end',
    },
    checkboxContainer: {
        width: 24,
        height: 24,
        borderRadius: 4,
        borderWidth: 2,
        borderColor: colors.Text03,
        backgroundColor: 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
    },
    checkboxActive: {
        backgroundColor: colors.Secondary300,
        borderColor: colors.Primary500,
    },
})
