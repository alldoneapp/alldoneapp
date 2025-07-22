import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import Shortcut, { SHORTCUT_LIGHT } from '../../UIControls/Shortcut'
import Badge from './Badge'

export default function HeaderTab({ text, badgeValue, onPress, isActive, isNextShortcutTab, showShortcuts }) {
    return (
        <View style={localStyles.container}>
            <TouchableOpacity style={localStyles.container} onPress={onPress}>
                <Text style={[localStyles.text, isActive ? localStyles.activeText : null]}>{text}</Text>
                <View style={[localStyles.firstLine, isActive ? localStyles.activeLine : null]} />
            </TouchableOpacity>
            <View style={[localStyles.lastLine, isActive ? localStyles.activeLine : null]} />

            {showShortcuts && isNextShortcutTab && (
                <View style={{ position: 'absolute', top: 0, right: -2 }}>
                    <Shortcut text={'Just_Tab'} theme={SHORTCUT_LIGHT} />
                </View>
            )}

            <Badge value={badgeValue} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
        textAlign: 'center',
        paddingVertical: 11,
        height: 44,
    },
    activeText: {
        color: '#ffffff',
    },
    firstLine: {
        width: '100%',
        height: 3,
    },
    lastLine: {
        width: '100%',
        height: 1,
        backgroundColor: colors.Gray400,
    },
    activeLine: {
        backgroundColor: colors.Primary400,
    },
})
