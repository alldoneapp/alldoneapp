import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import { translate } from '../../i18n/TranslationService'

export default function ShowMoreButton({ expanded, contract, expand, style, expandText, contractText }) {
    return (
        <View style={[localStyles.moreButton, style]}>
            <TouchableOpacity style={localStyles.container} onPress={expanded ? contract : expand}>
                {expandText || contractText ? (
                    <Text style={localStyles.text}>{translate(expanded ? contractText : expandText)}</Text>
                ) : (
                    <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={24} color={colors.Text04} />
                )}
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        justifyContent: 'center',
    },
    moreButton: {
        flex: 1,
        height: 24,
        flexDirection: 'row',
        justifyContent: 'center',
    },
    text: {
        ...styles.buttonLabel,
        fontFamily: 'Roboto-Regular',
        color: colors.Text03,
    },
})
