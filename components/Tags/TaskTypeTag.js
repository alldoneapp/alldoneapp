import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import { translate } from '../../i18n/TranslationService'

export default function TaskTypeTag({ icon, containerStyle, text }) {
    return (
        <View style={[localStyles.container, containerStyle]}>
            <Icon name={icon} size={16} color={colors.Text03} style={localStyles.icon} />
            <Text style={localStyles.text}>{translate(text)}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: colors.Gray300,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        height: 24,
        paddingHorizontal: 4,
    },
    icon: {
        marginHorizontal: 4,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
        marginVertical: 1,
        marginRight: 4,
        marginLeft: 2,
    },
})
