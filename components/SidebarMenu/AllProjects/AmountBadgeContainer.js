import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import { em2px } from '../../styles/global'
import { getTheme } from '../../../Themes/Themes'
import { Themes } from '../Themes'
import useCollapsibleSidebar from '../Collapsible/UseCollapsibleSidebar'
import AmountBadge from '../ProjectFolding/Common/AmountBadge'

export default function AmountBadgeContainer() {
    const themeName = useSelector(state => state.loggedUser.themeName)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const sidebarNumbers = useSelector(state => state.sidebarNumbers)
    const archivedProjectIds = useSelector(state => state.loggedUser.archivedProjectIds)
    const templateProjectIds = useSelector(state => state.loggedUser.templateProjectIds)
    const { expanded } = useCollapsibleSidebar()

    const theme = getTheme(Themes, themeName, 'CustomSideMenu.AllProjects')

    let projects = 0
    for (let projectId in sidebarNumbers) {
        if (
            sidebarNumbers[projectId][loggedUserId] &&
            !templateProjectIds.includes(projectId) &&
            !archivedProjectIds.includes(projectId)
        ) {
            projects += sidebarNumbers[projectId][loggedUserId]
        }
    }

    return (
        <View style={expanded ? localStyles.tasksAmountContainer : localStyles.tasksAmountCollapsed}>
            {expanded ? (
                <Text style={[localStyles.amount, theme.amount]}>{projects > 0 ? projects : ''}</Text>
            ) : projects > 0 ? (
                <AmountBadge amount={projects} highlight={true} />
            ) : null}
        </View>
    )
}

const localStyles = StyleSheet.create({
    tasksAmountContainer: {
        paddingRight: 24,
    },
    tasksAmountCollapsed: {
        top: 7,
        right: 9,
        position: 'absolute',
        flexDirection: 'row',
    },
    amount: {
        fontFamily: 'Roboto-Medium',
        fontSize: 14,
        lineHeight: 14,
        letterSpacing: em2px(0.03),
        opacity: 0.8,
    },
})
