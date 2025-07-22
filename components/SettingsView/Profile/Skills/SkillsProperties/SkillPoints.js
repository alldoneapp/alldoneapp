import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import Icon from '../../../../Icon'
import styles, { colors } from '../../../../styles/global'
import { translate } from '../../../../../i18n/TranslationService'
import { useSelector } from 'react-redux'
import useInProfileSettings from '../../useInProfileSettings'

export default function SkillPoints() {
    const skillPoints = useSelector(state => state.loggedUser.skillPoints)
    const inSettings = useInProfileSettings()

    return (
        <View style={localStyles.settingRow}>
            <View style={[localStyles.settingRowSection, localStyles.settingRowLeft]}>
                <Icon name={'trending-up'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                    {translate('Skillpoints available')}
                </Text>
                {inSettings && <Text style={[styles.body1, { marginLeft: 8 }]}>{skillPoints}</Text>}
            </View>
            {!inSettings && (
                <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                    <Text style={styles.body1}>{skillPoints}</Text>
                </View>
            )}
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
})
