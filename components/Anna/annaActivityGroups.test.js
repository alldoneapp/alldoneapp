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

    it('opens the chat object of a topic, or of a thread whose type is not known yet (AT-2906)', () => {
        expect(getAnnaActivityTarget([chat('topic1', 'c', 1, 'topics').notice])).toBe('/projects/p1/chats/topic1/chat')
        // Saved before it was enriched: never the followed chats inbox, which is not the object
        // and crashed on a project whose members were still loading.
        expect(getAnnaActivityTarget([chat('x', 'c', 1).notice])).toBe('/projects/p1/chats/x/chat')
    })

    it('takes the type from any notice of the group when the last message has none', () => {
        expect(getAnnaActivityTarget([feed('a', 1).notice, chat('task1', 'c', 2).notice])).toBe(
            '/projects/p1/tasks/task1/chat'
        )
        expect(getAnnaActivityTarget([feed('a', 1, 'goal1', 'goals').notice, chat('goal1', 'c', 2).notice])).toBe(
            '/projects/p1/goals/goal1/chat'
        )
        expect(getAnnaActivityTarget([feed('a', 1, 'c1', 'contacts').notice])).toBe(
            '/projects/p1/contacts/c1/properties'
        )
    })

    it('keeps the updates inbox for objects the workspace cannot open', () => {
        expect(getAnnaActivityTarget([feed('a', 1, 'u2', 'users').notice])).toBe(
            '/projects/p1/user/u1/updates/followed'
        )
        // A known type without a workspace view (a user's or skill's chat) keeps its saved inbox.
        expect(getAnnaActivityTarget([chat('u2', 'c', 1, 'users').notice])).toBe('/projects/p1/user/u1/chats/followed')
    })

    it('never builds a path from a malformed id', () => {
        const bad = { id: 'chat/p1/bad id/c', kind: 'chat', created: 1, path: '/projects/p1/user/u1/chats/followed' }
        expect(getAnnaActivityTarget([bad])).toBe(bad.path)
    })
})
