import store from '../../../redux/store'
import { FEED_PUBLIC_FOR_ALL } from '../../Feeds/Utils/FeedsConstants'

class FeedHelper {
    static isPrivateTopic = topic => {
        const { loggedUser } = store.getState()
        const { isAnonymous, uid } = loggedUser

        const isPrivate = topic && topic.isPublicFor && !topic.isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
        return isPrivate && (isAnonymous || (topic.creatorId !== uid && !topic.isPublicFor.includes(uid)))
    }
}

export default FeedHelper
