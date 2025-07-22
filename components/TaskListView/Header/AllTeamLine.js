import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { translate } from '../../../i18n/TranslationService'

export default function AllTeamLine() {
    const mobile = useSelector(state => state.smallScreenNavigation)
    return (
        <View style={localStyles.container}>
            <Icon size={18} name="workstream" color={colors.Text03} style={{ marginRight: 4 }} />
            {!mobile && (
                <Text style={[styles.subtitle1, localStyles.userName]} numberOfLines={1}>
                    {translate('Team')}
                </Text>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        alignItems: 'center',
        justifyContent: 'flex-start',
        flexDirection: 'row',
    },
    userName: {
        color: colors.Text01,
    },
})
