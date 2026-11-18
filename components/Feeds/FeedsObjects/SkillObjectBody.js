import React from 'react'
import { View } from 'react-native'

import RegularFeed from '../FeedsTypes/RegularFeed'
import { FEED_SKILL_PROJECT_CHANGED } from '../Utils/FeedsConstants'
import ChangedProjectFeed from '../FeedsTypes/ChangedProjectFeed'
import FeedRow from '../Commons/FeedRow'

export default function SkillObjectBody({ skillId, projectId, lastChangeDate, feedActiveTab, feeds }) {
    return (
        <View>
            {feeds.map((feed, index) => {
                const { type, showLikeNew } = feed
                feed.skillId = skillId
                let feedComponent = null
                if (type === FEED_SKILL_PROJECT_CHANGED) {
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
                    <FeedRow key={feed.id} isFirst={index === 0}>
                        {feedComponent}
                    </FeedRow>
                )
            })}
        </View>
    )
}
