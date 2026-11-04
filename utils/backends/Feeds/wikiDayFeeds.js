import moment from 'moment'

import { FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'
import { isWikiFeed } from '../../../functions/KnowledgeBase/knowledgeWikiFeedModel'
import { getDb, getLoggedUserAccessReaderId } from '../firestore'
import { getOwnFollowedStorePath } from './feedPrivacy'

export function watchWikiDayFeeds(projectId, day, userId, followed, onChange, onError) {
    const db = getDb()
    const readerId = getLoggedUserAccessReaderId()
    const start = moment(day, 'YYYYMMDD', true)
    if (!db || readerId == null || !userId || !start.isValid()) return () => {}

    const path = followed ? getOwnFollowedStorePath(projectId, userId) : `feedsStore/${projectId}/all`
    // The main Updates subscription is capped. Read this card's whole local day with the same
    // reader/time index, without widening the main feed or copying wiki content into it.
    return db
        .collection(path)
        .where('readerIds', 'array-contains', readerId)
        .where('lastChangeDate', '>=', start.valueOf())
        .where('lastChangeDate', '<', start.clone().add(1, 'day').valueOf())
        .orderBy('lastChangeDate', 'desc')
        .onSnapshot(
            { includeMetadataChanges: true },
            snapshot => {
                const feeds = []
                snapshot.forEach(doc => {
                    const feed = doc.data()
                    const audience = feed.isPublicFor || []
                    if (isWikiFeed(feed) && (audience.includes(FEED_PUBLIC_FOR_ALL) || audience.includes(userId))) {
                        feeds.push({ ...feed, id: doc.id })
                    }
                })
                onChange(feeds, !snapshot.metadata.fromCache)
            },
            onError
        )
}
