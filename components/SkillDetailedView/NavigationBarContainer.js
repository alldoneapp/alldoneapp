import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import NavigationBar from '../NavigationBar/NavigationBar'
import {
    DV_TAB_SKILL_PROPERTIES,
    DV_TAB_SKILL_BACKLINKS,
    DV_TAB_SKILL_NOTE,
    DV_TAB_SKILL_CHAT,
    DV_TAB_SKILL_UPDATES,
} from '../../utils/TabNavigationConstants'
import TasksHelper from '../TaskListView/Utils/TasksHelper'
import { setSelectedNavItem } from '../../redux/actions'

export default function NavigationBarContainer({ userHasAccessToProject }) {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const selectedNavItem = useSelector(state => state.selectedNavItem)

    const navigationTabs = [
        DV_TAB_SKILL_PROPERTIES,
        DV_TAB_SKILL_BACKLINKS,
        DV_TAB_SKILL_NOTE,
        DV_TAB_SKILL_CHAT,
        DV_TAB_SKILL_UPDATES,
    ]

    if (!userHasAccessToProject) {
        const indexBL = navigationTabs.indexOf(DV_TAB_SKILL_BACKLINKS)
        navigationTabs.splice(indexBL, 1)
    }

    useEffect(() => {
        const tab = navigationTabs.includes(selectedNavItem) ? selectedNavItem : DV_TAB_SKILL_PROPERTIES
        TasksHelper.changeSharedMode(userHasAccessToProject)
        dispatch(setSelectedNavItem(tab))
    }, [selectedNavItem])

    return (
        <View style={smallScreenNavigation ? localStyles.navigationBar : undefined}>
            <NavigationBar taskDetail isSecondary tabs={navigationTabs} style={{ height: 56 }} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    navigationBar: {
        marginHorizontal: -16,
    },
})
