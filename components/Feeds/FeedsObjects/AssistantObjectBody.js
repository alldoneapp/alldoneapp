import React from 'react'
import { View } from 'react-native'

import RegularFeed from '../FeedsTypes/RegularFeed'
import { FEED_ASSISTANT_PICTURE_CHANGED } from '../Utils/FeedsConstants'
import AssistantPictureChangedFeed from '../FeedsTypes/AssistantPictureChangedFeed'
import FeedRow from '../Commons/FeedRow'

export default function AssistantObjectBody({ assistantId, projectId, lastChangeDate, feedActiveTab, feeds }) {
    return (
        <View>
            {feeds.map((feed, index) => {
                const { type, showLikeNew } = feed
                feed.assistantId = assistantId
                let feedComponent = null

                if (type === FEED_ASSISTANT_PICTURE_CHANGED) {
                    feedComponent = (
                        <AssistantPictureChangedFeed
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
