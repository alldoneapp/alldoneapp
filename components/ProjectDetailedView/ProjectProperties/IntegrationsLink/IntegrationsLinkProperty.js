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
    const integrationsLink = `${translate('Settings')} → ${translate('Integrations')}`

    return (
        <View testID="email-calendar-property-row" style={localStyles.container}>
            <View testID="email-calendar-property-label" style={localStyles.labelRow}>
                <Icon name="link" size={24} color={colors.Text03} style={localStyles.icon} />
                <Text numberOfLines={1} style={[styles.subtitle2, localStyles.label]}>
                    {translate('Email & Calendar')}
                </Text>
            </View>
            <TouchableOpacity
                testID="email-calendar-property-link"
                style={localStyles.linkButton}
                onPress={openIntegrations}
            >
                <Text
                    testID="email-calendar-property-link-text"
                    numberOfLines={1}
                    style={[styles.body3, localStyles.linkText]}
                >
                    {integrationsLink}
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
        height: 56,
    },
    labelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        minWidth: 0,
    },
    icon: {
        marginHorizontal: 8,
    },
    label: {
        color: colors.Text03,
        flexShrink: 1,
    },
    linkButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        marginLeft: 8,
    },
    linkText: {
        color: colors.Primary100,
        flexShrink: 1,
    },
})
