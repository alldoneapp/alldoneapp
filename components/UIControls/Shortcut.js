import React from 'react'

import { StyleSheet, View } from 'react-native'
import { colors } from '../styles/global'
import ShortcutKey from './ShortcutKey'
import ShortcutSplit from './ShortcutSplit'

export const SHORTCUT_DARK = 'SHORTCUT_DARK'
export const SHORTCUT_LIGHT = 'SHORTCUT_LIGHT'

export default function Shortcut({
    text,
    parentStyle,
    containerStyle,
    textStyle,
    theme = SHORTCUT_DARK,
    custom = false,
}) {
    const getChunks = () => {
        return text.trim().split(' ')
    }

    return (
        <View style={[localStyles.container, containerStyle, parentStyle]}>
            {custom ? (
                <View style={[localStyles.containerKey, theme === SHORTCUT_LIGHT && localStyles.light, containerStyle]}>
                    {text != null ? (typeof text === 'string' ? text.replace('_', ' ') : text) : ''}
                </View>
            ) : (
                getChunks().map((text, i) => {
                    let finalText = text != null && text.replace('_', ' ')
                    return i % 2 === 0 ? (
                        <ShortcutKey
                            key={i}
                            sText={finalText}
                            containerStyle={containerStyle}
                            textStyle={textStyle}
                            theme={theme}
                        />
                    ) : (
                        <ShortcutSplit
                            key={i}
                            sText={finalText}
                            containerStyle={containerStyle}
                            textStyle={textStyle}
                            theme={theme}
                        />
                    )
                })
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
    },
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
    light: {
        borderWidth: 1,
        borderColor: colors.Text03,
    },
})
