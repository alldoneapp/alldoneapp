import React from 'react'
import { View, StyleSheet } from 'react-native'

import { FOLLOWED_TAB } from '../Utils/FeedsConstants'
import { colors } from '../../styles/global'

export default function NewFeedDot({ feedActiveTab, isMiddleScreen }) {
    return (
        <View
            style={[
                localStyles.dot,
                feedActiveTab === FOLLOWED_TAB ? localStyles.followed : localStyles.all,
                isMiddleScreen ? { marginRight: 4 } : { marginRight: 8, marginLeft: 2 },
            ]}
        />
    )
}

const localStyles = StyleSheet.create({
    dot: {
        width: 6,
        height: 6,
        borderRadius: 100,
        marginRight: 8,
    },
    followed: {
        backgroundColor: colors.Red200,
    },
    all: {
        backgroundColor: colors.Gray500,
    },
})
