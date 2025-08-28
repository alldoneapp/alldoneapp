import React from 'react'
import { StyleSheet, View } from 'react-native'
import { colors } from '../../../../styles/global'
import Icon from '../../../../Icon'

export default function CheckMark({ style }) {
    return (
        <View style={[localStyles.container, style]}>
            <Icon size={12} name={'check'} color={'#ffffff'} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        justifyContent: 'center',
        alignItems: 'center',
        width: 16,
        height: 16,
        borderRadius: 50,
        backgroundColor: colors.Primary100,
        paddingHorizontal: 2,
        paddingVertical: 2,
    },
})
