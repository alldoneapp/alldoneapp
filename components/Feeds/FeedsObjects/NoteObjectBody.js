import React from 'react'
import { View } from 'react-native'

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
import FeedRow from '../Commons/FeedRow'

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
                    <FeedRow key={feed.id} isFirst={index === 0}>
                        {feedComponent}
                    </FeedRow>
                )
            })}
        </View>
    )
}
