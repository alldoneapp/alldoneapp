import React from 'react'
import { View, Text, StyleSheet } from 'react-native'

import styles from '../../../styles/global'
import Icon from '../../../Icon'
import { getRelativeLevelXp, getXpNeededToReachLevel } from '../../../../utils/Levels'
import { translate, useTranslator } from '../../../../i18n/TranslationService'

import { themed } from '../../../../Themes/colorMode'

export default function XpBarSetting({ xp, level }) {
    useTranslator()
    const barPercent = (getRelativeLevelXp(level, xp) / getXpNeededToReachLevel(level + 1)) * 100
    const xpText = `${Math.round(barPercent)}%`
    return (
        <View style={localStyle.container}>
            <View style={localStyle.xpContainer}>
                <View>
                    <Text style={[styles.body2, localStyle.xpText]}>{xpText}</Text>
                </View>
                <View style={localStyle.levelContainer}>
                    <Icon name="star" size={15} color="#091540" />
                    <Text style={[styles.subtitle2, localStyle.levelText]}>{translate('Level', { level })}</Text>
                </View>
            </View>
            <View style={[localStyle.progressContainer, { width: `${barPercent}%` }]} />
        </View>
    )
}

const localStyle = StyleSheet.create({
    container: {
        backgroundColor: themed.Grey200,
        borderRadius: 16,
        zIndex: -3,
    },
    xpContainer: {
        paddingHorizontal: 12,
        alignItems: 'center',
        flexDirection: 'row',
        height: 24,
        width: 200,
    },
    progressContainer: {
        position: 'absolute',
        backgroundColor: themed.UtilityBlue112,
        borderRadius: 16,
        height: 24,
        zIndex: -1,
    },
    xpText: {
        color: '#0070E0',
        alignSelf: 'flex-start',
    },
    levelContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'flex-end',
    },
    levelText: {
        color: themed.Text01,
        marginLeft: 5,
        alignSelf: 'center',
    },
})
