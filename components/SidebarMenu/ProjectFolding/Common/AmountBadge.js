import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import { getTheme } from '../../../../Themes/Themes'
import { Themes } from '../../Themes'
import { em2px } from '../../../styles/global'

export default function AmountBadge({ amount, active, highlight, color }) {
    const themeName = useSelector(state => state.loggedUser.themeName)
    const theme = getTheme(Themes, themeName, 'CustomSideMenu.AmountBadge')

    return (
        <View style={[localStyles.container, highlight && theme.container(color)]}>
            <Text
                style={[
                    localStyles.amount,
                    highlight ? theme.amountHighlight : active ? theme.amountActive : theme.amount,
                ]}
            >
                {amount}
            </Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 14,
        paddingHorizontal: 4,
        borderRadius: 50,
    },
    amount: {
        fontFamily: 'Roboto-Medium',
        fontSize: 12,
        lineHeight: 14,
        letterSpacing: em2px(0.03),
    },
})
