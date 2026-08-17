import { uniq } from 'lodash'

import { FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'

/**
 * The creator always ends up following their own note — but normally that lands
 * at the END of createNoteFeedsChain (processFollowersWhenEditTexts →
 * addFollower), behind several awaited feed writes. Offline those writes only
 * ack on reconnect, so the freshly created note carried
 * `isVisibleInFollowedFor: []` — and the notes list's default Followed tab
 * filters on exactly that field, making the note invisible right after being
 * created (notes follow-ups, Pixel QA). Stamping the creator at creation time
 * closes the gap; the chain's later `arrayUnion` of the same id is idempotent.
 *
 * The visibility condition mirrors addFollower's: the creator lands in
 * isVisibleInFollowedFor only when the note is public or explicitly shared with
 * them — same rule, just applied at time zero.
 */
export const stampCreatorAsFollower = noteData => {
    const creatorId = noteData.creatorId || noteData.userId
    if (!creatorId) return noteData

    const isPublicFor = Array.isArray(noteData.isPublicFor) ? noteData.isPublicFor : []
    const followersIds = uniq([...(noteData.followersIds || []), creatorId])
    const creatorCanSeeNote = isPublicFor.includes(FEED_PUBLIC_FOR_ALL) || isPublicFor.includes(creatorId)
    const isVisibleInFollowedFor = creatorCanSeeNote
        ? uniq([...(noteData.isVisibleInFollowedFor || []), creatorId])
        : noteData.isVisibleInFollowedFor || []

    return { ...noteData, followersIds, isVisibleInFollowedFor }
}
