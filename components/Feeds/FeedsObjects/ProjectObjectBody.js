import React from 'react'
import { StyleSheet, View } from 'react-native'

import RegularFeed from '../FeedsTypes/RegularFeed'
import ProjectColorChangedFeed from '../FeedsTypes/ProjectColorChangedFeed'
import ProjectKickedMemberFeed from '../FeedsTypes/ProjectKickedMemberFeed'
import ProjectChangedGuide from '../FeedsTypes/ProjectChangedGuide'
import GiveKarmaFeed from '../FeedsTypes/GiveKarmaFeed'
import {
    FEED_PROJECT_BACKLINK,
    FEED_PROJECT_COLOR_CHANGED,
    FEED_PROJECT_GIVE_KARMA,
    FEED_PROJECT_KICKED_MEMBER,
    FEED_PROJECT_GUIDE_CHANGED,
} from '../Utils/FeedsConstants'
import BacklinkFeed from '../FeedsTypes/BacklinkFeed'

export default function ProjectObjectBody({ projectId, lastChangeDate, feedActiveTab, feeds }) {
    return (
        <View>
            {feeds.map((feed, index) => {
                const { type, showLikeNew } = feed
                feed.projectId = projectId
                let feedComponent = null

                if (type === FEED_PROJECT_GIVE_KARMA) {
                    feedComponent = (
                        <GiveKarmaFeed
                            feed={feed}
                            projectId={projectId}
                            lastChangeDateObject={lastChangeDate}
                            showNewFeedDot={showLikeNew}
                            feedActiveTab={feedActiveTab}
                        />
                    )
                } else if (type === FEED_PROJECT_GUIDE_CHANGED) {
                    feedComponent = (
                        <ProjectChangedGuide
                            feed={feed}
                            projectId={projectId}
                            lastChangeDateObject={lastChangeDate}
                            showNewFeedDot={showLikeNew}
                            feedActiveTab={feedActiveTab}
                        />
                    )
                } else if (type === FEED_PROJECT_KICKED_MEMBER) {
                    feedComponent = (
                        <ProjectKickedMemberFeed
                            feed={feed}
                            projectId={projectId}
                            lastChangeDateObject={lastChangeDate}
                            showNewFeedDot={showLikeNew}
                            feedActiveTab={feedActiveTab}
                        />
                    )
                } else if (type === FEED_PROJECT_BACKLINK) {
                    feedComponent = (
                        <BacklinkFeed
                            feed={feed}
                            projectId={projectId}
                            lastChangeDateObject={lastChangeDate}
                            showNewFeedDot={showLikeNew}
                            feedActiveTab={feedActiveTab}
                        />
                    )
                } else if (type === FEED_PROJECT_COLOR_CHANGED) {
                    feedComponent = (
                        <ProjectColorChangedFeed
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
