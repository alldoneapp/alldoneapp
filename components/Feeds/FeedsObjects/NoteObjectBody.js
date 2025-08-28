import React from 'react'
import { View, StyleSheet } from 'react-native'

import RegularFeed from '../FeedsTypes/RegularFeed'
import NoteOwnerChangedFeed from '../FeedsTypes/NoteOwnerChangedFeed'
import ChangedProjectFeed from '../FeedsTypes/ChangedProjectFeed'

import {
    FEED_NOTE_OWNER_CHANGED,
    FEED_NOTE_PROJECT_CHANGED_TO,
    FEED_NOTE_PROJECT_CHANGED_FROM,
    FEED_NOTE_BACKLINK,
} from '../Utils/FeedsConstants'
import BacklinkFeed from '../FeedsTypes/BacklinkFeed'

export default function NoteObjectBody({ noteId, projectId, lastChangeDate, feedActiveTab, feeds }) {
    return (
        <View>
            {feeds.map((feed, index) => {
                const { type, showLikeNew } = feed
                feed.noteId = noteId
                let feedComponent = null

                if (type === FEED_NOTE_OWNER_CHANGED) {
                    feedComponent = (
                        <NoteOwnerChangedFeed
                            feed={feed}
                            projectId={projectId}
                            lastChangeDateObject={lastChangeDate}
                            showNewFeedDot={showLikeNew}
                            feedActiveTab={feedActiveTab}
                        />
                    )
                } else if (type === FEED_NOTE_PROJECT_CHANGED_TO || type === FEED_NOTE_PROJECT_CHANGED_FROM) {
                    feedComponent = (
                        <ChangedProjectFeed
                            feed={feed}
                            projectId={projectId}
                            lastChangeDateObject={lastChangeDate}
                            showNewFeedDot={showLikeNew}
                            feedActiveTab={feedActiveTab}
                        />
                    )
                } else if (type === FEED_NOTE_BACKLINK) {
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
