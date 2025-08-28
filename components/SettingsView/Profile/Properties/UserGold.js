import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import Gold from '../../../../assets/svg/Gold'

export default function UserGold({ gold }) {
    const mobileNav = useSelector(state => state.smallScreenNavigation)

    return (
        <View style={localStyles.settingRow}>
            <View style={[localStyles.settingRowSection, localStyles.settingRowLeft, { paddingLeft: 8 }]}>
                <Gold width={24} height={24} id="statisticsSection" />
                {mobileNav ? (
                    <Text style={[styles.body1, { marginLeft: 8 }]} numberOfLines={1}>
                        {gold}
                    </Text>
                ) : (
                    <Text style={[styles.subtitle2, { color: colors.Text03, marginLeft: 8 }]} numberOfLines={1}>
                        {translate('Gold points')}
                    </Text>
                )}
            </View>
            <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                {!mobileNav && (
                    <Text style={[styles.body1, { marginRight: 8 }]} numberOfLines={1}>
                        {gold}
                    </Text>
                )}
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
})
