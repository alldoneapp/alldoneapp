import React from 'react'

import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../styles/global'
import { SHORTCUT_DARK } from './Shortcut'

export default function ShortcutSplit({ sText, containerStyle, textStyle, theme = SHORTCUT_DARK }) {
    return (
        <View style={[localStyles.containerSplit, containerStyle]}>
            <Text
                style={[
                    localStyles.text,
                    localStyles.textSplit,
                    theme === SHORTCUT_DARK ? localStyles.textDark : localStyles.textLight,
                    textStyle,
                ]}
            >
                {sText}
            </Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    containerSplit: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: 16,
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        paddingVertical: 2,
        paddingHorizontal: 2,
    },
    text: {
        ...styles.caption1,
        lineHeight: 12,
    },
    textSplit: {
        lineHeight: 20,
    },
    textDark: {
        color: '#ffffff',
    },
    textLight: {
        color: colors.Text03,
    },
})
