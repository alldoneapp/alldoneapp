import React from 'react'
import { View } from 'react-native'

import RegularFeed from '../FeedsTypes/RegularFeed'
import GiveKarmaFeed from '../FeedsTypes/GiveKarmaFeed'
import UserFollowingAllMembers from '../FeedsTypes/UserFollowingAllMembers'
import UserAllMembersFollowing from '../FeedsTypes/UserAllMembersFollowing'
import {
    FEED_USER_GIVE_KARMA,
    FEED_USER_FOLLOWING_ALL_MEMBERS,
    FEED_USER_ALL_MEMBERS_FOLLOWING,
    FEED_USER_WORKFLOW_ADDED,
    FEED_USER_WORKFLOW_REMOVE,
    FEED_USER_WORKFLOW_CHANGED,
    FEED_USER_BACKLINK,
} from '../Utils/FeedsConstants'
import UserWorkflowStepFeed from '../FeedsTypes/UserWorkflowStepFeed'
import BacklinkFeed from '../FeedsTypes/BacklinkFeed'
import FeedRow from '../Commons/FeedRow'

export default function UserObjectBody({ userId, projectId, lastChangeDate, feedActiveTab, feeds }) {
    return (
        <View>
            {feeds.map((feed, index) => {
                const { type, showLikeNew } = feed
                feed.userId = userId
                let feedComponent = null

                if (type === FEED_USER_GIVE_KARMA) {
                    feedComponent = (
                        <GiveKarmaFeed
                            feed={feed}
                            projectId={projectId}
                            lastChangeDateObject={lastChangeDate}
                            showNewFeedDot={showLikeNew}
                            feedActiveTab={feedActiveTab}
                        />
                    )
                } else if (type === FEED_USER_FOLLOWING_ALL_MEMBERS) {
                    feedComponent = (
                        <UserFollowingAllMembers
                            feed={feed}
                            projectId={projectId}
                            lastChangeDateObject={lastChangeDate}
                            showNewFeedDot={showLikeNew}
                            feedActiveTab={feedActiveTab}
                        />
                    )
                } else if (type === FEED_USER_ALL_MEMBERS_FOLLOWING) {
                    feedComponent = (
                        <UserAllMembersFollowing
                            feed={feed}
                            projectId={projectId}
                            lastChangeDateObject={lastChangeDate}
                            showNewFeedDot={showLikeNew}
                            feedActiveTab={feedActiveTab}
                        />
                    )
                } else if (type === FEED_USER_BACKLINK) {
                    feedComponent = (
                        <BacklinkFeed
                            feed={feed}
                            projectId={projectId}
                            lastChangeDateObject={lastChangeDate}
                            showNewFeedDot={showLikeNew}
                            feedActiveTab={feedActiveTab}
                        />
                    )
                } else if (
                    type === FEED_USER_WORKFLOW_ADDED ||
                    type === FEED_USER_WORKFLOW_REMOVE ||
                    type === FEED_USER_WORKFLOW_CHANGED
                ) {
                    feedComponent = (
                        <UserWorkflowStepFeed
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
                    <FeedRow key={feed.id} isFirst={index === 0}>
                        {feedComponent}
                    </FeedRow>
                )
            })}
        </View>
    )
}
