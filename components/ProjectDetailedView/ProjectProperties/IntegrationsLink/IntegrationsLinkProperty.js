import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'
import NavigationService from '../../../../utils/NavigationService'
import SettingsHelper from '../../../SettingsView/SettingsHelper'
import { DV_TAB_SETTINGS_INTEGRATIONS } from '../../../../utils/TabNavigationConstants'

// Email & Calendar accounts moved from project properties to Settings → Integrations;
// this row is the pointer for users who look for them here.
export default function IntegrationsLinkProperty() {
    const openIntegrations = () => {
        SettingsHelper.processURLSettingsTab(NavigationService, DV_TAB_SETTINGS_INTEGRATIONS)
    }

    return (
        <View style={localStyles.container}>
            <View style={localStyles.labelRow}>
                <Icon name="link" size={20} color={colors.Text03} style={localStyles.icon} />
                <Text style={[styles.subtitle2, localStyles.label]}>{translate('Email & Calendar')}</Text>
            </View>
            <TouchableOpacity style={localStyles.linkButton} onPress={openIntegrations}>
                <Text style={[styles.caption1, localStyles.linkText]}>
                    {translate('Email & Calendar accounts are managed in Settings → Integrations')}
                </Text>
                <Icon name="arrow-right" size={14} color={colors.Primary100} style={{ marginLeft: 4 }} />
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        paddingVertical: 8,
    },
    labelRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    icon: {
        marginRight: 8,
    },
    label: {
        color: colors.Text03,
    },
    linkButton: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 1,
    },
    linkText: {
        color: colors.Primary100,
        flexShrink: 1,
    },
})
