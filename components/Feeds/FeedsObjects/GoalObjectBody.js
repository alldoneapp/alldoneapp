import React from 'react'
import { View, StyleSheet } from 'react-native'

import RegularFeed from '../FeedsTypes/RegularFeed'
import {
    FEED_GOAL_ASSIGNEES_CHANGED,
    FEED_GOAL_PROJECT_CHANGED,
    FEED_GOAL_BACKLINK,
    FEED_GOAL_CAPACITY_CHANGED,
} from '../Utils/FeedsConstants'
import GoalChangedAssigneesFeed from '../FeedsTypes/GoalChangedAssigneesFeed'
import ChangedProjectFeed from '../FeedsTypes/ChangedProjectFeed'
import BacklinkFeed from '../FeedsTypes/BacklinkFeed'
import GoalChangedCapacityFeed from '../FeedsTypes/GoalChangedCapacityFeed'

export default function GoalObjectBody({ goalId, projectId, lastChangeDate, feedActiveTab, feeds }) {
    return (
        <View>
            {feeds.map((feed, index) => {
                const { type, showLikeNew } = feed
                feed.goalId = goalId
                let feedComponent = null

                if (type === FEED_GOAL_ASSIGNEES_CHANGED) {
                    feedComponent = (
                        <GoalChangedAssigneesFeed
                            feed={feed}
                            projectId={projectId}
                            lastChangeDateObject={lastChangeDate}
                            showNewFeedDot={showLikeNew}
                            feedActiveTab={feedActiveTab}
                        />
                    )
                } else if (type === FEED_GOAL_CAPACITY_CHANGED) {
                    feedComponent = (
                        <GoalChangedCapacityFeed
                            feed={feed}
                            projectId={projectId}
                            lastChangeDateObject={lastChangeDate}
                            showNewFeedDot={showLikeNew}
                            feedActiveTab={feedActiveTab}
                        />
                    )
                } else if (type === FEED_GOAL_BACKLINK) {
                    feedComponent = (
                        <BacklinkFeed
                            feed={feed}
                            projectId={projectId}
                            lastChangeDateObject={lastChangeDate}
                            showNewFeedDot={showLikeNew}
                            feedActiveTab={feedActiveTab}
                        />
                    )
                } else if (type === FEED_GOAL_PROJECT_CHANGED) {
                    feedComponent = (
                        <ChangedProjectFeed
                            feed={feed}
                            projectId={projectId}
                            lastChangeDateObject={lastChangeDate}
                            showNewFeedDot={showLikeNew}
                            feedActiveTab={feedActiveTab}
                        />
                    )
                } else {
                    feedComponent = (
                        <RegularFeed
                            feed={feed}
                            projectId={projectId}
                            lastChangeDateObject={lastChangeDate}
                            showNewFeedDot={showLikeNew}
                            feedActiveTab={feedActiveTab}
                        />
                    )
                }

                return (
                    <View key={feed.id} style={[localStyles.margin, index !== 0 ? localStyles.feed : null]}>
                        {feedComponent}
                    </View>
                )
            })}
        </View>
    )
}

const localStyles = StyleSheet.create({
    feed: {
        marginTop: 8,
    },
    margin: {
        marginLeft: -16,
    },
})
