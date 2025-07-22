import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'

export default function CustomizationsHeader({ text, containerStyle, rightContent }) {
    return (
        <View style={[localStyles.container, containerStyle]}>
            <Text style={localStyles.text}>{translate(text)}</Text>
            {rightContent && <View style={localStyles.rightContent}>{rightContent}</View>}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 72,
        paddingTop: 32,
        paddingBottom: 12,
        alignItems: 'flex-end',
        flexDirection: 'row',
    },
    text: {
        ...styles.title6,
        color: colors.Text01,
    },
    rightContent: {
        marginLeft: 'auto',
    },
})
