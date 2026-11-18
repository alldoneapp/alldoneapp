import React from 'react'
import { View, StyleSheet } from 'react-native'

import { FOLLOWED_TAB } from '../Utils/FeedsConstants'
import { colors } from '../../styles/global'

// The dot fills the 16px slot a feed entry gives up while unread (10px on middle screens, where the
// entry keeps 6px of its margin). Its left margin places it 12px (desktop) / 14px (middle screen)
// from a project card's edge in Updates; keep the slot widths unchanged so times stay aligned.
export default function NewFeedDot({ feedActiveTab, isMiddleScreen }) {
    return (
        <View
            testID="new-feed-dot"
            style={[
                localStyles.dot,
                feedActiveTab === FOLLOWED_TAB ? localStyles.followed : localStyles.all,
                isMiddleScreen ? localStyles.middleScreen : localStyles.wideScreen,
            ]}
        />
    )
}

const localStyles = StyleSheet.create({
    dot: {
        width: 6,
        height: 6,
        borderRadius: 100,
    },
    // 0 + 6 + 4 = 10px, plus the entry's remaining 6px margin.
    middleScreen: {
        marginRight: 4,
    },
    // 4 + 6 + 6 = 16px.
    wideScreen: {
        marginLeft: 4,
        marginRight: 6,
    },
    followed: {
        backgroundColor: colors.Red200,
    },
    all: {
        backgroundColor: colors.Gray500,
    },
})
