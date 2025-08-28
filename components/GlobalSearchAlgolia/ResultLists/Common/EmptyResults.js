import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'

export default function EmptyResults({ style, text }) {
    return (
        <View style={[localStyles.container, style]}>
            <Icon name={'info'} size={32} color={colors.Text04} />
            <Text style={localStyles.text}>{text ? translate(text) : 'There are no search results yet :)'}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingTop: 32,
        alignItems: 'center',
        paddingHorizontal: 16,
    },
    text: {
        ...styles.title6,
        color: colors.Text04,
        textAlign: 'center',
        marginTop: 8,
    },
})
