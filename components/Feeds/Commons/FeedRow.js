import React, { useContext } from 'react'
import { View, StyleSheet } from 'react-native'

import { ProjectSectionContext } from '../../TaskListView/TaskHierarchy'

/**
 * One feed entry under a feed object (task, goal, note, ...).
 *
 * Every feed type reserves a 16px slot left of its time for the unread dot (`NewFeedDot`): the
 * entry has `marginLeft: 16` while read and gives that margin to the dot while unread, so read and
 * unread times line up.
 *
 * Outside a project card (the Updates tab of a detailed view) the entry is pulled 16px left so the
 * time lines up with the object header and the dot hangs in the page gutter.
 *
 * AT-3103: inside a project card (the Updates page) there is no gutter - the card body only has 8px
 * of padding - so the same pull put the dot half or fully outside the card's left edge. There the
 * slot stays inside the card: the dot sits 12-14px from the card edge and the time and content
 * start right of it, for read and unread entries alike.
 */
export default function FeedRow({ isFirst, children }) {
    const inProjectCard = useContext(ProjectSectionContext)
    return (
        <View testID="feed-row" style={[!inProjectCard && localStyles.outdent, !isFirst && localStyles.spacing]}>
            {children}
        </View>
    )
}

const localStyles = StyleSheet.create({
    outdent: {
        marginLeft: -16,
    },
    spacing: {
        marginTop: 8,
    },
})
