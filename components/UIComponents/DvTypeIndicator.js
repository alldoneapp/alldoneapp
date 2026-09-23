import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import Icon from '../Icon'
import { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'

export default function DvTypeIndicator({ label, icon, mobile }) {
    return (
        <View style={localStyles.container}>
            {!mobile && <Text style={localStyles.label}>{translate(label)}</Text>}
            <Icon name={icon} size={14} color={colors.Text03} style={!mobile && localStyles.icon} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 14,
    },
    label: {
        fontFamily: 'Roboto-Medium',
        fontSize: 12,
        lineHeight: 14,
        color: colors.Text03,
    },
    icon: {
        marginLeft: 8,
    },
})
