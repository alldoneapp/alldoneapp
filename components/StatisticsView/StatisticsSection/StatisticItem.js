import React from 'react'
import { View, StyleSheet, Text } from 'react-native'

import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import Gold from '../../../assets/svg/Gold'
import { translate } from '../../../i18n/TranslationService'

export default function StatisticItem({ icon, text, amount, isGold }) {
    const statisticAmount = amount ? amount : 0

    return (
        <View style={localStyles.container}>
            <View style={localStyles.subContainer}>
                {isGold ? (
                    <Gold width={24} height={24} id="statisticsSection" />
                ) : (
                    <Icon name={icon} size={24} color={colors.Text03} />
                )}
                <Text style={localStyles.text}>{translate(text)}</Text>
            </View>
            <Text style={localStyles.value}>{statisticAmount}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        height: 56,
        minHeight: 56,
        maxHeight: 56,
        paddingLeft: 8,
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    subContainer: {
        flexDirection: 'row',
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
        marginLeft: 8,
    },
    value: {
        ...styles.body1,
        color: colors.Text01,
    },
})
