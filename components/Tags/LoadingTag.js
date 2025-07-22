import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'

export default function LoadingTag() {
    return (
        <View style={localStyles.container}>
            <Icon color={colors.Primary100} size={16} name="loading-static" />
            <Text style={[localStyles.text, windowTagStyle()]} numberOfLines={1}>
                Loading...
            </Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 4,
        paddingRight: 8,
        backgroundColor: colors.UtilityBlue112,
        height: 24,
        borderRadius: 50,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Primary100,
        marginLeft: 6,
    },
})
