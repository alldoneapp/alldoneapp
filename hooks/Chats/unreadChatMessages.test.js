import { getUnreadCommentIdsToWatch, selectUnreadMessages, UNREAD_MESSAGES_FETCH_LIMIT } from './unreadChatMessages'

describe('selectUnreadMessages', () => {
    const messages = [
        { id: 'c1', commentText: 'read one' },
        { id: 'c2', commentText: 'unread one' },
        { id: 'c3', commentText: 'read two' },
        { id: 'c4', commentText: 'unread two' },
    ]

    it('keeps only unread comments', () => {
        expect(selectUnreadMessages(messages, ['c2', 'c4'])).toEqual([
            { id: 'c2', commentText: 'unread one' },
            { id: 'c4', commentText: 'unread two' },
        ])
    })

    it('preserves the thread order rather than the order of the notification ids', () => {
        // Notifications arrive from a Firestore snapshot whose order is not the thread's; the
        // preview must still read top-to-bottom exactly like the open topic does.
        expect(selectUnreadMessages(messages, ['c4', 'c2']).map(message => message.id)).toEqual(['c2', 'c4'])
    })

    it('returns nothing when there is no unread comment', () => {
        expect(selectUnreadMessages(messages, [])).toEqual([])
        expect(selectUnreadMessages(messages, undefined)).toEqual([])
    })

    it('ignores unread ids whose comment is outside the loaded window', () => {
        expect(selectUnreadMessages(messages, ['c2', 'missing'])).toEqual([{ id: 'c2', commentText: 'unread one' }])
    })

    it('survives an empty message list while the subscription is still loading', () => {
        expect(selectUnreadMessages([], ['c2'])).toEqual([])
        expect(selectUnreadMessages(undefined, ['c2'])).toEqual([])
    })
})

describe('selectUnreadMessages thread order (AT-3149)', () => {
    it('sorts by creation time, because the by-id query returns document id order', () => {
        const messages = [
            { id: 'gmail-a', created: 300 },
            { id: 'gmail-b', created: 100 },
            { id: 'gmail-c', created: 200 },
        ]
        expect(selectUnreadMessages(messages, ['gmail-a', 'gmail-b', 'gmail-c']).map(m => m.id)).toEqual([
            'gmail-b',
            'gmail-c',
            'gmail-a',
        ])
    })

    it('falls back to lastChangeDate (ISO string) when created is missing', () => {
        const messages = [
            { id: 'late', lastChangeDate: '2026-11-24T17:18:55.115Z' },
            { id: 'early', lastChangeDate: '2026-11-24T16:40:54.169Z' },
        ]
        expect(selectUnreadMessages(messages, ['late', 'early']).map(m => m.id)).toEqual(['early', 'late'])
    })
})

describe('getUnreadCommentIdsToWatch', () => {
    it('watches every unread id, whatever its position in the thread', () => {
        expect(getUnreadCommentIdsToWatch(['old', 'new'])).toEqual(['old', 'new'])
    })

    it('drops duplicates and empty ids', () => {
        expect(getUnreadCommentIdsToWatch(['a', '', null, 'a', 'b'])).toEqual(['a', 'b'])
        expect(getUnreadCommentIdsToWatch(undefined)).toEqual([])
    })

    it('caps a huge backlog to the newest ids', () => {
        const ids = Array.from({ length: 500 }, (_, index) => `c${index}`)
        const watched = getUnreadCommentIdsToWatch(ids)
        expect(watched).toHaveLength(UNREAD_MESSAGES_FETCH_LIMIT)
        expect(watched[watched.length - 1]).toBe('c499')
    })
})
