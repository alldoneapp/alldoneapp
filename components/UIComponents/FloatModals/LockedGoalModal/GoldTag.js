import React from 'react'
import { useSelector } from 'react-redux'
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native'

import styles, { colors } from '../../../styles/global'
import { parseNumberToUseThousand } from '../../../StatisticsView/statisticsHelper'
import Gold from '../../../../assets/svg/Gold'

export default function GoldTag() {
    const gold = useSelector(state => state.loggedUser.gold)

    return (
        <View style={{ flexDirection: 'row' }}>
            <View style={localStyle.container}>
                <View style={{ padding: 1.286 }}>
                    <Gold width={21.43} height={21.43} />
                </View>
                <Text style={localStyle.text}>{parseNumberToUseThousand(gold)}</Text>
            </View>
        </View>
    )
}

const localStyle = StyleSheet.create({
    container: {
        padding: 2,
        paddingRight: 12,
        flexDirection: 'row',
        borderRadius: 16,
        alignItems: 'center',
        marginRight: 16,
        height: 28,
        backgroundColor: '#ffffff',
    },
    text: {
        ...styles.caption2,
        marginLeft: 8,
        color: colors.UtilityBlue200,
    },
})
