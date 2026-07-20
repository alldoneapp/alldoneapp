'use strict'

const { getMenubarLastComment, __private__ } = require('./menubarLastComment')

const {
    buildLastCommentUrl,
    isChatVisibleToUser,
    isPreferredChatNotification,
    selectLastCommentSource,
    selectPreferredChatNotification,
} = __private__

describe('menubar cross-project last comment', () => {
    test('uses the main app followed-then-newest notification priority', () => {
        const notifications = [
            { projectId: 'project-new', followed: false, date: 300 },
            { projectId: 'project-old-followed', followed: true, date: 100 },
            { projectId: 'project-new-followed', followed: true, date: 200 },
        ]

        expect(selectPreferredChatNotification(notifications)).toEqual(notifications[2])
        expect(isPreferredChatNotification(notifications[0], notifications[2])).toBe(false)
    })

    test('falls back to the all-project assistant pointer only without unread chat notifications', () => {
        const fallback = {
            projectId: 'project-2',
            objectId: 'task-9',
            objectType: 'tasks',
            creatorId: 'assistant-1',
            creatorType: 'assistant',
            date: 500,
        }
        const userData = { lastAssistantCommentData: { allProjects: fallback } }

        expect(selectLastCommentSource(userData, [], ['project-1', 'project-2'])).toEqual({
            ...fallback,
            fromNotification: false,
        })
        expect(
            selectLastCommentSource(
                userData,
                [{ projectId: 'project-1', followed: false, date: 1 }],
                ['project-1', 'project-2']
            )
        ).toEqual(expect.objectContaining({ projectId: 'project-1', fromNotification: true }))
    })

    test('does not expose a stale fallback from an inactive project', () => {
        const userData = {
            lastAssistantCommentData: {
                allProjects: { projectId: 'archived-project', objectId: 'task-1', objectType: 'tasks' },
            },
        }
        expect(selectLastCommentSource(userData, [], ['active-project'])).toBeNull()
    })

    test('builds the canonical main-app chat routes for topics and parent objects', () => {
        expect(buildLastCommentUrl('https://my.alldone.app/', 'p1', 'topics', 'c1')).toBe(
            'https://my.alldone.app/projects/p1/chats/c1/chat'
        )
        expect(buildLastCommentUrl('https://my.alldone.app', 'p2', 'tasks', 't1')).toBe(
            'https://my.alldone.app/projects/p2/tasks/t1/chat'
        )
        expect(buildLastCommentUrl('https://my.alldone.app', 'p3', 'users', 'u1')).toBe(
            'https://my.alldone.app/projects/p3/contacts/u1/chat'
        )
    })

    test('keeps private chat previews restricted to their allowed users', () => {
        expect(isChatVisibleToUser({ isPublicFor: [0] }, 'user-1')).toBe(true)
        expect(isChatVisibleToUser({ isPublicFor: ['user-1'] }, 'user-1')).toBe(true)
        expect(isChatVisibleToUser({ isPublicFor: ['other-user'] }, 'user-1')).toBe(false)
    })

    test('resolves the selected notification to its latest comment in another project', async () => {
        const docs = {
            'projects/project-2': { userIds: ['user-1'], name: 'Launch' },
            'chatObjects/project-2/chats/task-9': { title: 'Approve campaign' },
            'assistants/project-2/items/assistant-1': { displayName: 'Anna Launch' },
        }
        const comment = {
            creatorId: 'assistant-1',
            fromAssistant: true,
            commentText: 'The assets are ready.',
            created: 900,
        }
        const query = {
            orderBy: () => query,
            limit: () => query,
            get: async () => ({
                empty: false,
                docs: [{ id: 'comment-9', data: () => comment }],
            }),
        }
        const db = {
            doc: path => ({
                get: async () => ({
                    exists: !!docs[path],
                    data: () => docs[path],
                }),
            }),
            collection: () => query,
        }
        const notifications = [
            {
                projectId: 'project-2',
                chatId: 'task-9',
                chatType: 'tasks',
                creatorId: 'assistant-1',
                creatorType: 'assistant',
                followed: true,
                date: 800,
                commentId: 'comment-9',
            },
        ]

        await expect(
            getMenubarLastComment(
                db,
                'user-1',
                { displayName: 'Karsten' },
                ['project-1', 'project-2'],
                'https://my.alldone.app',
                notifications
            )
        ).resolves.toEqual({
            projectId: 'project-2',
            projectName: 'Launch',
            objectId: 'task-9',
            objectType: 'tasks',
            objectName: 'Approve campaign',
            authorName: 'Anna Launch',
            text: 'The assets are ready.',
            richText: 'The assets are ready.',
            links: [],
            createdAt: 900,
            pending: false,
            unreadCount: 1,
            followed: true,
            url: 'https://my.alldone.app/projects/project-2/tasks/task-9/chat',
        })
    })
})
