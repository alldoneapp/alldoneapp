import { ALL_TAB, FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'
import { FOLLOWED_READER_IDS_FIELD } from '../firestoreAccess'

/**
 * Firestore rules authorize chat collection queries through server-owned projections.
 * Keep every chat-list listener on the same field/value contract so one view cannot drift back
 * to querying the client-writable `isPublicFor` or `usersFollowing` fields.
 */
export const getChatAccessQueryArgs = ({ activeTab, loggedUserId, isAnonymous }) =>
    activeTab === ALL_TAB
        ? ['readerIds', 'array-contains', isAnonymous ? FEED_PUBLIC_FOR_ALL : loggedUserId]
        : [FOLLOWED_READER_IDS_FIELD, 'array-contains', loggedUserId]
