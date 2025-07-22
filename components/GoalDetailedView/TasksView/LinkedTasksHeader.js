import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'

export default function LinkedTasksHeader() {
    return (
        <View style={localStyles.container}>
            <Text style={localStyles.text}>{translate('Tasks')}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 72,
        paddingTop: 32,
        paddingBottom: 12,
        flexDirection: 'row',
        alignItems: 'flex-end',
    },
    text: {
        ...styles.title6,
        color: colors.Text01,
    },
})
