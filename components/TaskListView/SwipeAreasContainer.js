import React from 'react'
import { StyleSheet, View } from 'react-native'

import SwipeLeftArea from './SwipeLeftArea'
import SwipeRightArea from './SwipeRightArea'

export default function SwipeAreasContainer({ isActiveOrganizeMode, style, leftText, rightText }) {
    return (
        <View style={[localStyles.swipeContainer, isActiveOrganizeMode && localStyles.dragModeSwipe, style]}>
            {leftText && <SwipeLeftArea text={leftText} />}
            {rightText && <SwipeRightArea text={rightText} />}
        </View>
    )
}

const localStyles = StyleSheet.create({
    swipeContainer: {
        height: '100%',
        width: '100%',
        borderRadius: 4,
        position: 'absolute',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    dragModeSwipe: {
        display: 'none',
    },
})
