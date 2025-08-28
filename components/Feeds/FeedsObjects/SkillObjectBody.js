import React from 'react'
import { View, StyleSheet } from 'react-native'

import RegularFeed from '../FeedsTypes/RegularFeed'
import { FEED_SKILL_PROJECT_CHANGED } from '../Utils/FeedsConstants'
import ChangedProjectFeed from '../FeedsTypes/ChangedProjectFeed'

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
