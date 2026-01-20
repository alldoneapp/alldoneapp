import React from 'react'
import { View, Text, StyleSheet } from 'react-native'

import { translate } from '../../../i18n/TranslationService'
import styles, { colors } from '../../styles/global'

export default function Header({ assistantsAmount }) {
    const parseText = number => {
        if (number === 0) {
            return translate('No assistants yet')
        } else if (number > 1) {
            return number + ` ${translate('Assistants')}`
        }
        return number + ` ${translate('Assistant')}`
    }

    return (
        <View style={localStyles.header}>
            <Text style={[styles.title6, { color: colors.Text01 }]}>{translate('AI Assistant Templates')}</Text>
            <View style={localStyles.headerCaption}>
                <Text style={[styles.caption2, { color: colors.Text02 }]}>{parseText(assistantsAmount)}</Text>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    header: {
        paddingTop: 32,
        paddingBottom: 12,
        alignItems: 'flex-end',
        flexDirection: 'row',
    },
    headerCaption: {
        marginLeft: 16,
        height: 22,
        justifyContent: 'center',
    },
})
