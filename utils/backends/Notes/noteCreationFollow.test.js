import { stampCreatorAsFollower } from './noteCreationFollow'
import { FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'

describe('stampCreatorAsFollower', () => {
    const base = {
        creatorId: 'user1',
        userId: 'user1',
        isPublicFor: [FEED_PUBLIC_FOR_ALL, 'user1'],
        followersIds: [],
        isVisibleInFollowedFor: [],
    }

    it('stamps the creator into followersIds and isVisibleInFollowedFor for a public note', () => {
        const stamped = stampCreatorAsFollower({ ...base })
        expect(stamped.followersIds).toEqual(['user1'])
        expect(stamped.isVisibleInFollowedFor).toEqual(['user1'])
    })

    it('keeps existing followers and stays idempotent', () => {
        const stamped = stampCreatorAsFollower({
            ...base,
            followersIds: ['user2', 'user1'],
            isVisibleInFollowedFor: ['user1'],
        })
        expect(stamped.followersIds).toEqual(['user2', 'user1'])
        expect(stamped.isVisibleInFollowedFor).toEqual(['user1'])
    })

    it('stamps visibility for a private note explicitly shared with the creator', () => {
        const stamped = stampCreatorAsFollower({ ...base, isPublicFor: ['user1'] })
        expect(stamped.isVisibleInFollowedFor).toEqual(['user1'])
    })

    it('follows but stays invisible when the note is not shared with the creator', () => {
        const stamped = stampCreatorAsFollower({ ...base, creatorId: 'user2', userId: 'user2', isPublicFor: ['user1'] })
        expect(stamped.followersIds).toEqual(['user2'])
        expect(stamped.isVisibleInFollowedFor).toEqual([])
    })

    it('returns the data untouched when no creator can be resolved', () => {
        const input = { isPublicFor: [FEED_PUBLIC_FOR_ALL] }
        expect(stampCreatorAsFollower(input)).toBe(input)
    })
})
