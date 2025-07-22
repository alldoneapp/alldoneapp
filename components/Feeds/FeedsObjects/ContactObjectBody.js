import React from 'react'
import { View, StyleSheet } from 'react-native'

import RegularFeed from '../FeedsTypes/RegularFeed'
import ContactAddedContactFeed from '../FeedsTypes/ContactAddedContactFeed'
import ContactPictureChangedFeed from '../FeedsTypes/ContactPictureChangedFeed'
import GiveKarmaFeed from '../FeedsTypes/GiveKarmaFeed'
import {
    FEED_CONTACT_ADDED,
    FEED_CONTACT_PICTURE_CHANGED,
    FEED_CONTACT_GIVE_KARMA,
    FEED_CONTACT_BACKLINK,
} from '../Utils/FeedsConstants'
import BacklinkFeed from '../FeedsTypes/BacklinkFeed'

export default function ContactObjectBody({ contactId, projectId, lastChangeDate, feedActiveTab, feeds }) {
    return (
        <View>
            {feeds.map((feed, index) => {
                const { type, showLikeNew } = feed
                feed.contactId = contactId
                let feedComponent = null

                if (type === FEED_CONTACT_GIVE_KARMA) {
                    feedComponent = (
                        <GiveKarmaFeed
                            feed={feed}
                            projectId={projectId}
                            lastChangeDateObject={lastChangeDate}
                            showNewFeedDot={showLikeNew}
                            feedActiveTab={feedActiveTab}
                        />
                    )
                } else if (type === FEED_CONTACT_PICTURE_CHANGED) {
                    feedComponent = (
                        <ContactPictureChangedFeed
                            feed={feed}
                            projectId={projectId}
                            lastChangeDateObject={lastChangeDate}
                            showNewFeedDot={showLikeNew}
                            feedActiveTab={feedActiveTab}
                        />
                    )
                } else if (type === FEED_CONTACT_ADDED) {
                    feedComponent = (
                        <ContactAddedContactFeed
                            feed={feed}
                            projectId={projectId}
                            lastChangeDateObject={lastChangeDate}
                            showNewFeedDot={showLikeNew}
                            feedActiveTab={feedActiveTab}
                        />
                    )
                } else if (type === FEED_CONTACT_BACKLINK) {
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
