import {
    getUnreadMessagesFetchSize,
    selectUnreadMessages,
    UNREAD_MESSAGES_FETCH_BUFFER,
    UNREAD_MESSAGES_FETCH_LIMIT,
} from './unreadChatMessages'

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

describe('getUnreadMessagesFetchSize', () => {
    it('asks for the unread comments plus a small buffer', () => {
        expect(getUnreadMessagesFetchSize(['c1', 'c2'])).toBe(2 + UNREAD_MESSAGES_FETCH_BUFFER)
    })

    it('never asks Firestore for a non-positive limit', () => {
        // `limit(n)` rejects n <= 0, which would break the whole row rather than the preview.
        expect(getUnreadMessagesFetchSize([])).toBeGreaterThan(0)
        expect(getUnreadMessagesFetchSize(undefined)).toBeGreaterThan(0)
    })

    it('caps the window a single chat row may open', () => {
        const manyUnread = new Array(500).fill('c')
        expect(getUnreadMessagesFetchSize(manyUnread)).toBe(UNREAD_MESSAGES_FETCH_LIMIT)
    })
})
