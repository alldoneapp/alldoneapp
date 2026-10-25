import { ALL_TAB, FOLLOWED_TAB } from '../../../components/Feeds/Utils/FeedsConstants'
import { getChatAccessQueryArgs } from './chatAccessQuery'

describe('getChatAccessQueryArgs', () => {
    it('uses the signed-in reader projection for the All tab', () => {
        expect(getChatAccessQueryArgs({ activeTab: ALL_TAB, loggedUserId: 'member-1', isAnonymous: false })).toEqual([
            'readerIds',
            'array-contains',
            'member-1',
        ])
    })

    it('uses the public reader projection for an anonymous All tab', () => {
        expect(getChatAccessQueryArgs({ activeTab: ALL_TAB, loggedUserId: 'anonymous', isAnonymous: true })).toEqual([
            'readerIds',
            'array-contains',
            0,
        ])
    })

    it('uses the fixed followed projection for the Followed tab', () => {
        expect(
            getChatAccessQueryArgs({ activeTab: FOLLOWED_TAB, loggedUserId: 'member-1', isAnonymous: false })
        ).toEqual(['followedReaderIds', 'array-contains', 'member-1'])
    })
})
