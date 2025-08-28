import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'

import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'

export default function ClearAllFilters({ onPress }) {
    return (
        <TouchableOpacity accessible={false} onPress={onPress} style={localStyles.container}>
            <Icon size={16} name={'delete'} color={colors.Text03} />
            <Text style={localStyles.text}>{translate('Clear all')}</Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 24,
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 4,
        paddingRight: 8,
        borderWidth: 1,
        borderRadius: 4,
        borderColor: colors.Text03,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
        marginLeft: 6,
    },
})
