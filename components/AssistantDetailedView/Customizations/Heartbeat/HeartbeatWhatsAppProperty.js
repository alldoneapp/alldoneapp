import React from 'react'
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { updateAssistantHeartbeatSettings } from '../../../../utils/backends/Assistants/assistantsFirestore'
import { translate } from '../../../../i18n/TranslationService'

export default function HeartbeatWhatsAppProperty({ disabled, projectId, assistant }) {
    const userHasPhone = useSelector(state => !!state.loggedUser.phone)
    const sendWhatsApp = assistant.heartbeatSendWhatsApp ?? userHasPhone

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
                    activeOpacity={0.8}
                >
                    {sendWhatsApp && <Icon name="check" size={14} color={colors.Primary200} />}
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
        borderWidth: 1,
        borderColor: colors.Grey400,
        backgroundColor: '#FFFFFF',
        alignItems: 'center',
        justifyContent: 'center',
    },
    checkboxActive: {
        backgroundColor: colors.Grey100,
        borderColor: colors.Primary200,
    },
})
