import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../../styles/global'

const LinkedTasksHeader = () => {
    const [amount, setAmount] = useState(0)

    const calcAmount = () => {
        return 3
    }

    const parseNotesAmount = () => {
        const notes = calcAmount()
        let amount = ''

        if (notes === 0) {
            amount = ''
        } else if (notes === 1) {
            amount = '1 task'
        } else if (notes === -1) {
        } else {
            amount = `${notes} tasks`
        }

        return amount
    }

    return (
        <View style={localStyles.container}>
            <View style={localStyles.info}>
                <View>
                    <Text style={[styles.title6, { color: colors.Text01, marginRight: 16 }]}>Linked tasks</Text>
                </View>
                <View>
                    <Text style={[styles.caption2, { color: colors.Text02 }]}>{parseNotesAmount()}</Text>
                </View>
            </View>
        </View>
    )
}
export default LinkedTasksHeader

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        maxHeight: 80,
        height: 80,
        paddingTop: 40,
        paddingBottom: 8,
        marginHorizontal: 64,
    },
    info: {
        marginTop: 'auto',
        flexDirection: 'row',
        alignItems: 'baseline',
    },
})
