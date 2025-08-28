import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import ShortcutTag from './ShortcutTag'
import styles, { colors } from '../../styles/global'

export default function CheatShortcutItem({ shortcuts, description, style }) {
    return (
        <View style={[localStyles.section, style]}>
            {shortcuts.map((item, i) => (
                <ShortcutTag key={i} windowShortcut={item.win} macShortcut={item.mac} style={{ marginRight: 8 }} />
            ))}
            <Text style={localStyles.description}>{description}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    description: {
        ...styles.body1,
        color: colors.Text03,
    },
    section: { flexDirection: 'row', marginTop: 16 },
})
