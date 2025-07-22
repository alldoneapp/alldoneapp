import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'

export default function CommentInfo() {
    return (
        <View style={localStyles.container}>
            <Icon name="info" size={18} color={colors.Text03} />
            <Text style={localStyles.text}>{translate('Optional comment')}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 22,
        flexDirection: 'row',
        alignItems: 'center',
    },
    text: {
        ...styles.body2,
        color: colors.Text03,
        marginLeft: 8,
    },
})
