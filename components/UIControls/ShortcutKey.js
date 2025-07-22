import React from 'react'

import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../styles/global'
import { SHORTCUT_DARK, SHORTCUT_LIGHT } from './Shortcut'

export default function ShortcutKey({ sText, containerStyle, textStyle, theme = SHORTCUT_DARK }) {
    return (
        <View style={[localStyles.containerKey, theme === SHORTCUT_LIGHT && localStyles.light, containerStyle]}>
            <Text
                style={[
                    localStyles.text,
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
    containerKey: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        minWidth: 16,
        minHeight: 16,
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        paddingVertical: 2,
        paddingHorizontal: 4,
    },
    text: {
        ...styles.caption1,
        lineHeight: 12,
    },
    textDark: {
        color: '#ffffff',
    },
    textLight: {
        color: colors.Text03,
    },
    light: {
        borderWidth: 1,
        borderColor: colors.Text03,
    },
})
