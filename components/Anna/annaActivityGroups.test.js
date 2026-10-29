import { groupAnnaTimeline, getAnnaActivityTarget, ANNA_ACTIVITY_GROUP_WINDOW_MS } from './annaActivityGroups'

const feed = (feedId, created, objectId = 'task1', objectType = 'tasks') => ({
    notice: {
        id: `feed/p1/${objectType}/${objectId}/${feedId}`,
        kind: 'feed',
        created,
        path: '/projects/p1/user/u1/updates/followed',
    },
    created,
})
const chat = (chatId, commentId, created, objectType) => ({
    notice: {
        id: `chat/p1/${chatId}/${commentId}`,
        kind: 'chat',
        created,
        path: '/projects/p1/user/u1/chats/followed',
        ...(objectType ? { content: { objectType } } : {}),
    },
    created,
})
const message = created => ({ message: { id: `m${created}` }, created })
const shape = timeline => timeline.map(entry => (entry.notices ? entry.notices.map(n => n.id) : entry.message.id))

describe('groupAnnaTimeline (AT-2906)', () => {
    it('joins adjacent activity on one object, whether feed or chat', () => {
        expect(shape(groupAnnaTimeline([feed('a', 1), feed('b', 2), chat('task1', 'c', 3)]))).toEqual([
            ['feed/p1/tasks/task1/a', 'feed/p1/tasks/task1/b', 'chat/p1/task1/c'],
        ])
    })

    it('never joins across a message, another object or a long pause', () => {
        const late = 2 + ANNA_ACTIVITY_GROUP_WINDOW_MS + 1
        expect(
            shape(
                groupAnnaTimeline([
                    feed('a', 1),
                    message(2),
                    feed('b', 3),
                    feed('c', 4, 'note1', 'notes'),
                    feed('d', late),
                ])
            )
        ).toEqual([
            ['feed/p1/tasks/task1/a'],
            'm2',
            ['feed/p1/tasks/task1/b'],
            ['feed/p1/notes/note1/c'],
            ['feed/p1/tasks/task1/d'],
        ])
    })

    it('leaves non-activity notices alone', () => {
        const looking = { notice: { id: 'look', title: 'Tasks' }, created: 1 }
        expect(groupAnnaTimeline([looking])).toEqual([looking])
    })
})

describe('getAnnaActivityTarget (AT-2906)', () => {
    it('opens the object, or its chat when a message arrived', () => {
        expect(getAnnaActivityTarget([feed('a', 1).notice])).toBe('/projects/p1/tasks/task1/properties')
        expect(getAnnaActivityTarget([feed('a', 1).notice, chat('task1', 'c', 2, 'tasks').notice])).toBe(
            '/projects/p1/tasks/task1/chat'
        )
        expect(getAnnaActivityTarget([feed('a', 1, 'note1', 'notes').notice])).toBe('/projects/p1/notes/note1/editor')
    })

    it('keeps the inbox for objects the workspace cannot open, or an unknown chat type', () => {
        expect(getAnnaActivityTarget([chat('topic1', 'c', 1, 'topics').notice])).toBe(
            '/projects/p1/user/u1/chats/followed'
        )
        expect(getAnnaActivityTarget([chat('x', 'c', 1).notice])).toBe('/projects/p1/user/u1/chats/followed')
        expect(getAnnaActivityTarget([feed('a', 1, 'u2', 'users').notice])).toBe(
            '/projects/p1/user/u1/updates/followed'
        )
    })
})
