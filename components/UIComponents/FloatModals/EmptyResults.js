import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'

export default function EmptyResults({ text = translate('There are no search results yet'), style }) {
    return (
        <View style={[localStyles.container, style]}>
            <Icon name={'info'} size={32} color={colors.Text04} />
            <Text style={localStyles.text}>{text}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingTop: 32,
        alignItems: 'center',
        paddingHorizontal: 8,
    },
    text: {
        ...styles.title6,
        color: colors.Text04,
        textAlign: 'center',
        marginTop: 8,
    },
})
