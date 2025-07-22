import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'

export default function HeaderUser() {
    return (
        <View style={localStyles.container}>
            <Text style={localStyles.title}>{translate('Updates')}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        paddingBottom: 8,
    },
    title: {
        ...styles.title6,
        color: colors.Text01,
        marginTop: 32,
    },
})
