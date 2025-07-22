import React, { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../styles/global'
import AssistantOptions from './AssistantOptions/AssistantOptions'
import { calculateAmountOfOptionButtons } from './AssistantOptions/helper'
import LastCommentArea from './LastCommentArea'

export default function AssistantLine() {
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const [amountOfButtonOptions, setAmountOfButtonOptions] = useState(0)

    const onLayout = data => {
        const amountOfButtonOptions = calculateAmountOfOptionButtons(data.nativeEvent.layout.width, isMiddleScreen)
        setAmountOfButtonOptions(amountOfButtonOptions)
    }

    return (
        <View style={localStyles.container} onLayout={onLayout}>
            <LastCommentArea />
            <AssistantOptions amountOfButtonOptions={amountOfButtonOptions} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: '100%',
        backgroundColor: colors.Grey100,
        marginTop: 8,
        borderRadius: 4,
        height: 128,
        paddingLeft: 10,
        paddingRight: 16,
        paddingTop: 14,
        paddingBottom: 12,
    },
})
