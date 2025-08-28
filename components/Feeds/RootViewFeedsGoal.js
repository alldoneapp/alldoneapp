import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import FeedDVList from './FeedDVList'
import HeaderGoal from './HeaderGoal'
import { useSelector } from 'react-redux'
import URLsGoals, { URL_GOAL_DETAILS_FEED } from '../../URLSystem/Goals/URLsGoals'
import Backend from '../../utils/BackendBridge'
import { DV_TAB_GOAL_UPDATES } from '../../utils/TabNavigationConstants'

export default function RootViewFeedsGoal({ projectId, goal, goalId }) {
    const selectedTab = useSelector(state => state.selectedNavItem)

    const [innerFeeds, setInnerFeeds] = useState(null)

    const feedViewData = { type: 'goal', goalId, goal }

    const writeBrowserURL = () => {
        if (selectedTab === DV_TAB_GOAL_UPDATES) {
            const data = { projectId, goal: goal.id }
            URLsGoals.push(URL_GOAL_DETAILS_FEED, data, projectId, goal.id)
        }
    }

    useEffect(() => {
        Backend.unsubDetailedViewFeeds()
        Backend.watchDetailedViewFeeds(projectId, 'goals', goalId, setInnerFeeds)
        writeBrowserURL()
    }, [])

    const cleanComponent = () => {
        Backend.unsubDetailedViewFeeds()
    }

    useEffect(() => {
        writeBrowserURL()
        return cleanComponent
    }, [])

    return (
        <View style={localStyles.container}>
            <HeaderGoal />
            <FeedDVList projectId={projectId} feedViewData={feedViewData} innerFeeds={innerFeeds} objectId={goalId} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginBottom: 8,
    },
})
