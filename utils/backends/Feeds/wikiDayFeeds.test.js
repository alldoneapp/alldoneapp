import moment from 'moment'

const mockQuery = { where: jest.fn(), orderBy: jest.fn(), onSnapshot: jest.fn() }
const mockCollection = jest.fn(() => mockQuery)

jest.mock('../firestore', () => ({
    getDb: () => ({ collection: mockCollection }),
    getLoggedUserAccessReaderId: () => 'reader',
}))

import { watchWikiDayFeeds } from './wikiDayFeeds'

const wikiEntry = { type: 'FEED_WIKI_PAGE_CHANGED', isPublicFor: [0] }

beforeEach(() => {
    jest.clearAllMocks()
    mockQuery.where.mockReturnValue(mockQuery)
    mockQuery.orderBy.mockReturnValue(mockQuery)
})

it('watches all readable entries in the displayed calendar day and emits only its wiki changes', () => {
    const onChange = jest.fn()
    const onError = jest.fn()
    const stop = jest.fn()
    mockQuery.onSnapshot.mockReturnValue(stop)

    expect(watchWikiDayFeeds('project', '20261025', 'member', false, onChange, onError)).toBe(stop)
    expect(mockCollection).toHaveBeenCalledWith('feedsStore/project/all')
    expect(mockQuery.where.mock.calls).toEqual([
        ['readerIds', 'array-contains', 'reader'],
        ['lastChangeDate', '>=', moment('20261025', 'YYYYMMDD').valueOf()],
        ['lastChangeDate', '<', moment('20261026', 'YYYYMMDD').valueOf()],
    ])
    expect(mockQuery.orderBy).toHaveBeenCalledWith('lastChangeDate', 'desc')
    const [options, deliver, fail] = mockQuery.onSnapshot.mock.calls[0]
    expect(options).toEqual({ includeMetadataChanges: true })
    expect(fail).toBe(onError)

    const docs = [
        { id: 'wiki_kunden_000001', data: () => wikiEntry },
        { id: 'task', data: () => ({ ...wikiEntry, type: 'FEED_TASK_CREATED' }) },
        { id: 'other', data: () => ({ ...wikiEntry, isPublicFor: ['other'] }) },
    ]
    for (const fromCache of [true, false]) {
        deliver({ forEach: visit => docs.forEach(visit), metadata: { fromCache } })
        expect(onChange).toHaveBeenLastCalledWith([{ id: 'wiki_kunden_000001', ...wikiEntry }], !fromCache)
    }
})

it('uses the same day range in the selected user’s Followed store', () => {
    watchWikiDayFeeds('project', '20261025', 'member', true, jest.fn(), jest.fn())
    expect(mockCollection).toHaveBeenCalledWith('/feedsStore/project/member/feeds/followed')
})
