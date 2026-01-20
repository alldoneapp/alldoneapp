import React from 'react'
import { StyleSheet, View, TouchableOpacity, Text } from 'react-native'

import { translate } from '../../../i18n/TranslationService'
import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'

export default function AddAssistantPresentation({ onPress }) {
    return (
        <View style={localStyles.container}>
            <TouchableOpacity style={localStyles.placeholder} onPress={onPress}>
                <Icon name="plus-square" size={24} color={colors.Primary100} />
                <Text style={localStyles.text}>{translate('Type to add new assistant template')}</Text>
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 56,
        paddingLeft: 8,
    },
    placeholder: {
        flex: 1,
        height: 56,
        flexDirection: 'row',
        alignItems: 'center',
    },
    text: {
        ...styles.body1,
        color: colors.Text03,
        marginLeft: 12,
    },
})
