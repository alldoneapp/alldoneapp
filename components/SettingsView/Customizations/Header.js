import React from 'react'
import { View, Text, StyleSheet } from 'react-native'

import { translate } from '../../../i18n/TranslationService'
import styles, { colors } from '../../styles/global'

export default function Header() {
    return (
        <View style={localStyles.header}>
            <Text style={[styles.title6, { color: colors.Text01 }]}>{translate('Customizations')}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    header: {
        height: 72,
        paddingTop: 32,
        paddingBottom: 12,
        alignItems: 'flex-end',
        flexDirection: 'row',
    },
})
