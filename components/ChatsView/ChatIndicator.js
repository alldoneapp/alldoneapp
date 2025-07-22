import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import Colors from '../../Themes/Colors'

export default function ChatIndicator({ notificationsAmount, backgroundColor }) {
    const unReadMessagesParsed = notificationsAmount < 100 ? notificationsAmount : '+99'
    return (
        <View style={[localStyles.indicator, { backgroundColor }]}>
            <Text style={localStyles.indicatorText}>{unReadMessagesParsed}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    indicator: {
        height: 14,
        borderRadius: 50,
        backgroundColor: Colors.UtilityRed200,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 8,
        paddingHorizontal: 4,
    },
    indicatorText: {
        fontFamily: 'Roboto-Regular',
        fontWeight: 'bold',
        fontSize: 12,
        lineHeight: 14,
        color: Colors.White,
    },
})
