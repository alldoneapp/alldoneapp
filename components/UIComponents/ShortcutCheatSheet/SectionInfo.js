import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'

export default function SectionInfo({ text, style }) {
    return (
        <View style={[localStyles.container, style]}>
            <Icon name={'info'} size={20} color={colors.Text03} />
            <Text style={localStyles.description}>{text}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 36,
        marginTop: 16,
    },
    description: {
        ...styles.caption2,
        color: colors.Text03,
        marginLeft: 8,
    },
})
