import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import FeedDVList from './FeedDVList'
import HeaderGoal from './HeaderGoal'
import { useSelector } from 'react-redux'
import URLsGoals, { URL_GOAL_DETAILS_FEED } from '../../URLSystem/Goals/URLsGoals'
import Backend from '../../utils/BackendBridge'
import { DV_TAB_GOAL_UPDATES } from '../../utils/TabNavigationConstants'
import { filterDetailedViewFeeds, getAttachedNoteFeedSource, getAttachedNoteId } from './Utils/DetailFeedHelper'

export default function RootViewFeedsGoal({ projectId, goal, goalId }) {
    const selectedTab = useSelector(state => state.selectedNavItem)

    const [innerFeeds, setInnerFeeds] = useState(null)
    const noteId = getAttachedNoteId(goal, projectId)
    const relatedObjectIds = noteId ? [noteId] : []
    const relatedFeedSources = [getAttachedNoteFeedSource(noteId)].filter(Boolean)

    const feedViewData = { type: 'goal', goalId, goal }

    const writeBrowserURL = () => {
        if (selectedTab === DV_TAB_GOAL_UPDATES) {
            const data = { projectId, goal: goal.id }
            URLsGoals.push(URL_GOAL_DETAILS_FEED, data, projectId, goal.id)
        }
    }

    useEffect(() => {
        Backend.unsubDetailedViewFeeds()
        Backend.watchDetailedViewFeeds(projectId, 'goals', goalId, setInnerFeeds, relatedFeedSources)
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
            <FeedDVList
                projectId={projectId}
                feedViewData={feedViewData}
                innerFeeds={filterDetailedViewFeeds(innerFeeds, goalId, relatedObjectIds)}
                objectId={goalId}
                relatedObjectIds={relatedObjectIds}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginBottom: 8,
    },
})
