import React from 'react'
import { StyleSheet, View, Text } from 'react-native'

import { colors } from '../../styles/global'

export default function AmountTag({ noteAmount, isFollowedButton, style }) {
    const noteAmountParsed = noteAmount < 100 ? noteAmount : '+99'
    return (
        <View
            style={[localStyles.container, isFollowedButton ? localStyles.followTag : localStyles.notFollowTag, style]}
        >
            <Text style={localStyles.noteAmount}>{noteAmountParsed}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'center',
        paddingHorizontal: 4,
        height: 12,
        borderRadius: 10,
    },
    followTag: {
        backgroundColor: colors.UtilityRed200,
    },
    notFollowTag: {
        backgroundColor: colors.Gray500,
    },
    noteAmount: {
        fontFamily: 'Roboto-Regular',
        fontWeight: 'bold',
        fontSize: 9,
        lineHeight: 10,
        letterSpacing: 0.5,
        color: '#FFFFFF',
    },
})
