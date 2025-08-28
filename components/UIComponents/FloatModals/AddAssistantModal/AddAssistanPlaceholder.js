import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'

export default function AddAssistanPlaceholder({ onPress }) {
    return (
        <TouchableOpacity onPress={onPress}>
            <View style={localStyles.container}>
                <Icon name={'plus-square'} size={24} color={colors.Primary100} style={localStyles.icon} />
                <Text style={localStyles.text}>{translate('Type to add new assistant')}</Text>
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 40,
        paddingLeft: 4,
        paddingRight: 8,
        paddingVertical: 8,
    },
    icon: {
        marginRight: 12,
    },
    text: {
        ...styles.body1,
        color: colors.Text03,
    },
})
