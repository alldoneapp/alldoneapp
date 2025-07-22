import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'

export default function PropertiesHeader() {
    return (
        <View style={localStyles.container}>
            <Text style={localStyles.text}>{translate('Properties')}</Text>
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
    text: {
        ...styles.title6,
        color: colors.Text01,
    },
})
