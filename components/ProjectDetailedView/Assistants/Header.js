import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'

export default function Header({ amount }) {
    const parseText = number => {
        if (number === 0) {
            return translate('No assistants yet')
        } else if (number > 1) {
            return number + ` ${translate('Assistants')}`
        }
        return number + ` ${translate('Assistant')}`
    }

    return (
        <View style={localStyles.container}>
            <Text style={[styles.title6, { color: colors.Text01 }]}>{translate('AI Assistants')}</Text>
            <View style={localStyles.amountContainer}>
                <Text style={localStyles.amountText}>{parseText(amount)}</Text>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 72,
        paddingTop: 32,
        paddingBottom: 12,
        alignItems: 'flex-end',
        flexDirection: 'row',
    },
    headerText: {
        ...styles.title6,
        color: colors.Text01,
    },
    amountContainer: {
        marginLeft: 16,
        height: 22,
        justifyContent: 'center',
    },
    amountText: {
        ...styles.caption2,
        color: colors.Text02,
    },
})
