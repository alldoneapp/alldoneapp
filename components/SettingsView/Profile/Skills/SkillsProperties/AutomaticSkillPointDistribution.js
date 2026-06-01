import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../../../../Icon'
import Switch from '../../../../UIControls/Switch'
import styles, { colors } from '../../../../styles/global'
import { translate } from '../../../../../i18n/TranslationService'
import { setUserAutomaticSkillPointDistributionEnabled } from '../../../../../utils/backends/Users/usersFirestore'

export default function AutomaticSkillPointDistribution() {
    const userId = useSelector(state => state.loggedUser.uid)
    const automaticSkillPointDistributionEnabled = useSelector(
        state => state.loggedUser.automaticSkillPointDistributionEnabled !== false
    )

    const setEnabled = enabled => {
        setUserAutomaticSkillPointDistributionEnabled(userId, enabled)
    }

    return (
        <View style={localStyles.container}>
            <View style={localStyles.settingRow}>
                <View style={[localStyles.settingRowSection, localStyles.settingRowLeft]}>
                    <Icon name={'zap'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                    <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                        {translate('Automatic skill point distribution')}
                    </Text>
                </View>
                <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                    <Switch
                        active={automaticSkillPointDistributionEnabled}
                        activeSwitch={() => setEnabled(true)}
                        deactiveSwitch={() => setEnabled(false)}
                    />
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingBottom: 8,
    },
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
})
