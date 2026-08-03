import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'

import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'

export default function QuickActionsToggle({ expanded, onPress }) {
    const label = translate(expanded ? 'Show less' : 'Show all')

    return (
        <TouchableOpacity
            style={localStyles.button}
            onPress={onPress}
            accessibilityLabel={label}
            accessibilityRole={'button'}
        >
            <Text style={[styles.subtitle2, localStyles.text]}>{label}</Text>
            <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.Text03} />
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    button: {
        flexDirection: 'row',
        borderRadius: 50,
        justifyContent: 'center',
        alignItems: 'center',
        height: 24,
        alignSelf: 'flex-start',
        borderWidth: 1,
        borderColor: colors.Text03,
        paddingLeft: 10,
        paddingRight: 6,
        marginHorizontal: 8,
        marginBottom: 8,
    },
    text: {
        color: colors.Text03,
        marginRight: 4,
    },
})
