import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import AmountBadge from '../../ProjectFolding/Common/AmountBadge'
import useCollapsibleSidebar from '../../Collapsible/UseCollapsibleSidebar'

export default function Amount({ userId, projectColor, projectId }) {
    const currentUserId = useSelector(state => state.currentUser.uid)
    const sidebarNumbersInProject = useSelector(state => state.sidebarNumbers[projectId])
    const { expanded } = useCollapsibleSidebar()

    const highlight = currentUserId === userId

    const amount = sidebarNumbersInProject
        ? sidebarNumbersInProject[userId] > 0
            ? sidebarNumbersInProject[userId]
            : ''
        : ''

    return (
        <View style={!expanded && highlight ? localStyles.amountCollapsed : localStyles.amountContainer}>
            {amount > 0 && <AmountBadge amount={amount} highlight={highlight} color={projectColor} />}
        </View>
    )
}

const localStyles = StyleSheet.create({
    amountContainer: {
        flexDirection: 'row',
        paddingRight: 24,
    },
    amountCollapsed: {
        top: 3,
        right: 9,
        position: 'absolute',
        flexDirection: 'row',
    },
})
