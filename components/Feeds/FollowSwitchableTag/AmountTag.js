import React from 'react'
import { StyleSheet, View, Text } from 'react-native'

import { colors } from '../../styles/global'

export default function AmountTag({ feedAmount, isFollowedButton, style }) {
    const feedAmountParsed = feedAmount < 100 ? feedAmount : '+99'

    return (
        <View style={[localStyles.container, isFollowedButton ? localStyles.followedTag : localStyles.allTag, style]}>
            <Text style={localStyles.feedAmount}>{feedAmountParsed}</Text>
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
    followedTag: {
        backgroundColor: colors.UtilityRed200,
    },
    allTag: {
        backgroundColor: colors.Gray500,
    },
    feedAmount: {
        fontFamily: 'Roboto-Regular',
        fontWeight: 'bold',
        fontSize: 9,
        lineHeight: 10,
        letterSpacing: 0.5,
        color: '#FFFFFF',
    },
})
