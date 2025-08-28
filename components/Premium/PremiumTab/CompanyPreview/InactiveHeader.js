import React from 'react'
import { View, Text, StyleSheet } from 'react-native'

import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'

export default function InactiveHeader() {
    return (
        <View style={localStyles.container}>
            <Icon name={'info'} size={20} color={colors.Text03} style={{ marginRight: 8 }} />
            <Text style={[styles.subtitle1, { color: colors.Text03 }]}>{translate('Company inactive')}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
        height: 48,
        borderTopLeftRadius: 4,
        borderTopRightRadius: 4,
        backgroundColor: colors.Grey300,
    },
    text: {
        ...styles.subtitle1,
        color: colors.Text03,
    },
})
