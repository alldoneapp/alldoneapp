import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../../../../Icon'
import Switch from '../../../../UIControls/Switch'
import Button from '../../../../UIControls/Button'
import styles, { colors } from '../../../../styles/global'
import { translate } from '../../../../../i18n/TranslationService'
import {
    distributeManualSkillPoints,
    setUserAutomaticSkillPointDistributionEnabled,
} from '../../../../../utils/backends/Users/usersFirestore'

export default function AutomaticSkillPointDistribution() {
    const [processing, setProcessing] = useState(false)
    const userId = useSelector(state => state.loggedUser.uid)
    const automaticSkillPointDistributionEnabled = useSelector(
        state => state.loggedUser.automaticSkillPointDistributionEnabled !== false
    )

    const setEnabled = enabled => {
        setUserAutomaticSkillPointDistributionEnabled(userId, enabled)
    }

    const manuallyDistributePoints = async () => {
        setProcessing(true)
        try {
            await distributeManualSkillPoints()
        } catch (error) {
            console.error('Error manually distributing skill points', error)
        } finally {
            setProcessing(false)
        }
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
            <View style={localStyles.manualButton}>
                <Button
                    icon={'trending-up'}
                    type={'secondary'}
                    title={translate('Distribute 5 skill points')}
                    onPress={manuallyDistributePoints}
                    disabled={processing}
                    processing={processing}
                    processingTitle={translate('Distributing')}
                />
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
    manualButton: {
        marginLeft: 40,
        alignSelf: 'flex-start',
    },
})
