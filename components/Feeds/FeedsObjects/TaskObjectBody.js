import React from 'react'
import { View, StyleSheet } from 'react-native'

import RegularFeed from '../FeedsTypes/RegularFeed'
import TaskAssigneeChangedFeed from '../FeedsTypes/TaskAssigneeChangedFeed'
import TaskMovedInWorkflowFeed from '../FeedsTypes/TaskMovedInWorkflowFeed'
import GiveKarmaFeed from '../FeedsTypes/GiveKarmaFeed'
import TaskChangedProjectFeed from '../FeedsTypes/TaskChangedProjectFeed'
import TaskCreatedToAnotherUser from '../FeedsTypes/TaskCreatedToAnotherUser'
import TaskChangedParentGoal from '../FeedsTypes/TaskChangedParentGoal'
import {
    FEED_TASK_TO_ANOTHER_USER,
    FEED_TASK_ASSIGNEE_CHANGED,
    FEED_TASK_PROJECT_CHANGED_TO,
    FEED_TASK_PROJECT_CHANGED_FROM,
    FEED_TASK_MOVED_IN_WORKFLOW,
    FEED_TASK_GIVE_KARMA,
    FEED_TASK_BACKLINK,
    FEED_TASK_PARENT_GOAL,
} from '../Utils/FeedsConstants'
import BacklinkFeed from '../FeedsTypes/BacklinkFeed'

export default function TaskObjectBody({ taskId, projectId, lastChangeDate, feedActiveTab, feeds }) {
    return (
        <View>
            {feeds.map((feed, index) => {
                const { type, showLikeNew } = feed
                feed.taskId = taskId
                let feedComponent = null

                if (type === FEED_TASK_GIVE_KARMA) {
                    feedComponent = (
                        <GiveKarmaFeed
                            feed={feed}
                            projectId={projectId}
                            lastChangeDateObject={lastChangeDate}
                            showNewFeedDot={showLikeNew}
                            feedActiveTab={feedActiveTab}
                        />
                    )
                } else if (type === FEED_TASK_PARENT_GOAL) {
                    feedComponent = (
                        <TaskChangedParentGoal
                            feed={feed}
                            projectId={projectId}
                            showNewFeedDot={showLikeNew}
                            feedActiveTab={feedActiveTab}
                        />
                    )
                } else if (type === FEED_TASK_TO_ANOTHER_USER) {
                    feedComponent = (
                        <TaskCreatedToAnotherUser
                            feed={feed}
                            projectId={projectId}
                            lastChangeDateObject={lastChangeDate}
                            showNewFeedDot={showLikeNew}
                            feedActiveTab={feedActiveTab}
                        />
                    )
                } else if (type === FEED_TASK_MOVED_IN_WORKFLOW) {
                    feedComponent = (
                        <TaskMovedInWorkflowFeed
                            feed={feed}
                            projectId={projectId}
                            lastChangeDateObject={lastChangeDate}
                            showNewFeedDot={showLikeNew}
                            feedActiveTab={feedActiveTab}
                        />
                    )
                } else if (type === FEED_TASK_ASSIGNEE_CHANGED) {
                    feedComponent = (
                        <TaskAssigneeChangedFeed
                            feed={feed}
                            projectId={projectId}
                            lastChangeDateObject={lastChangeDate}
                            showNewFeedDot={showLikeNew}
                            feedActiveTab={feedActiveTab}
                        />
                    )
                } else if (type === FEED_TASK_PROJECT_CHANGED_TO || type === FEED_TASK_PROJECT_CHANGED_FROM) {
                    feedComponent = (
                        <TaskChangedProjectFeed
                            feed={feed}
                            projectId={projectId}
                            lastChangeDateObject={lastChangeDate}
                            showNewFeedDot={showLikeNew}
                            feedActiveTab={feedActiveTab}
                        />
                    )
                } else if (type === FEED_TASK_BACKLINK) {
                    feedComponent = (
                        <BacklinkFeed
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
