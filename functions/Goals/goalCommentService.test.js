const { createFakeFirestore } = require('../Tests/fakeFirestore')
const { GoalCommentService } = require('./goalCommentService')

const P = 'proj1'
const G = 'goal1'
const OWNER = 'karsten'
const MEMBER = 'anna'
const OUTSIDER = 'bob'

const seeded = (goalExtra = {}, extra = {}) =>
    createFakeFirestore({
        [`projects/${P}`]: { name: 'Alldone Growth', userIds: [OWNER, MEMBER, OUTSIDER] },
        [`goals/${P}/items/${G}`]: {
            extendedName: 'Pick the winning segment',
            name: 'pick the winning segment',
            creatorId: OWNER,
            assigneesIds: [OWNER, 'ws@default'],
            isPublicFor: [0],
            commentsData: { amount: 2, lastComment: 'older' },
            ...goalExtra,
        },
        ...extra,
    })

let idCounter = 0
const service = db =>
    new GoalCommentService({
        database: db,
        createId: () => `c${++idCounter}`,
        createTimestamp: () => 'TIMESTAMP',
        baseUrl: 'https://my.alldone.app',
    })

const notificationsFor = db =>
    [...db.docs.keys()].filter(path => path.startsWith(`chatNotifications/${P}/`)).map(path => path.split('/')[2])

describe('GoalCommentService', () => {
    test('writes the comment, the goal and chat metadata and the followers in one go, and notifies the others', async () => {
        const db = seeded({}, { [`followers/${P}/goals/${G}`]: { usersFollowing: [MEMBER] } })
        const result = await service(db).addComment({
            projectId: P,
            goalId: G,
            comment: '  Segment A answers best so far.  ',
            actor: { uid: 'assistant-1', displayName: 'Growth Lead' },
            fromAssistant: true,
            requestUserId: OWNER,
        })

        expect(result).toMatchObject({ success: true, commentId: 'c1', notifiedFollowers: 2, silent: false })
        expect(db.docs.get(`chatComments/${P}/goals/${G}/comments/c1`)).toEqual({
            creatorId: 'assistant-1',
            commentText: 'Segment A answers best so far.',
            originalContent: 'Segment A answers best so far.',
            commentType: 2, // STAYWARD_COMMENT
            lastChangeDate: 'TIMESTAMP',
            created: expect.any(Number),
            fromAssistant: true,
            requestUserId: OWNER,
        })
        expect(db.docs.get(`goals/${P}/items/${G}`).commentsData).toMatchObject({
            amount: 3,
            lastComment: 'Segment A answers best so far.',
            lastCommentOwnerId: 'assistant-1',
        })
        const chat = db.docs.get(`chatObjects/${P}/chats/${G}`)
        expect(chat).toMatchObject({
            id: G,
            type: 'goals',
            title: 'Pick the winning segment',
            isPublicFor: [0],
            assistantId: 'assistant-1',
            commentsData: { amount: 1, lastComment: 'Segment A answers best so far.' },
        })
        // The workstream placeholder is not a person and never follows anything.
        expect(chat.usersFollowing.sort()).toEqual([MEMBER, OWNER, 'assistant-1'].sort())
        expect([...db.docs.get(`followers/${P}/goals/${G}`).usersFollowing].sort()).toEqual(
            [...chat.usersFollowing].sort()
        )

        expect(notificationsFor(db).sort()).toEqual([MEMBER, OWNER].sort())
        expect(db.docs.get(`chatNotifications/${P}/${OWNER}/c1`)).toMatchObject({
            chatId: G,
            chatType: 'goals',
            creatorType: 'assistant',
        })
        expect(db.docs.get(`emailNotifications/${G}`)).toMatchObject({ objectType: 'goals', objectId: G })
        expect(db.docs.get(`pushNotifications/c1`)).toMatchObject({
            body: 'Alldone Growth\n  ✔ Pick the winning segment\n Growth Lead commented: Segment A answers best so far.',
            link: `https://my.alldone.app/projects/${P}/goals/${G}/chat`,
            chatId: G,
            initiatorId: 'assistant-1',
        })
    })

    test("an MCP client's comment carries the marker and also notifies the user it acted for", async () => {
        const db = seeded()
        await service(db).addComment({
            projectId: P,
            goalId: G,
            comment: 'Done for today.',
            actor: { uid: OWNER, displayName: 'Karsten Wysk', via: 'mcp', viaClient: 'Claude' },
        })
        const [commentPath] = [...db.docs.keys()].filter(path => path.startsWith(`chatComments/`))
        expect(db.docs.get(commentPath)).toMatchObject({ via: 'mcp', viaClient: 'Claude', fromAssistant: false })
        expect(notificationsFor(db)).toEqual([OWNER])
        const [pushPath] = [...db.docs.keys()].filter(path => path.startsWith('pushNotifications/'))
        expect(db.docs.get(pushPath)).toMatchObject({ initiatorVia: 'mcp' })
        expect(db.docs.get(pushPath).body).toMatch(/Karsten Wysk \(via Claude\) commented/)
    })

    test('a silent comment is in the thread but marks nothing unread', async () => {
        const db = seeded()
        const result = await service(db).addComment({
            projectId: P,
            goalId: G,
            comment: 'Quiet note.',
            actor: { uid: 'assistant-1' },
            fromAssistant: true,
            silent: true,
        })
        expect(result).toMatchObject({ silent: true, notifiedFollowers: 0 })
        expect([...db.docs.keys()].some(path => path.startsWith('chatComments/'))).toBe(true)
        expect(notificationsFor(db)).toEqual([])
        expect([...db.docs.keys()].some(path => path.startsWith('pushNotifications/'))).toBe(false)
    })

    test('followers who cannot see a private goal are not notified', async () => {
        const db = seeded({ isPublicFor: [OWNER] }, { [`followers/${P}/goals/${G}`]: { usersFollowing: [OUTSIDER] } })
        await service(db).addComment({ projectId: P, goalId: G, comment: 'Private.', actor: { uid: MEMBER } })
        expect(notificationsFor(db)).toEqual([OWNER])
    })

    test('an empty comment or a missing goal writes nothing', async () => {
        const db = seeded()
        await expect(
            service(db).addComment({ projectId: P, goalId: G, comment: '   ', actor: { uid: OWNER } })
        ).rejects.toThrow(/must not be empty/)
        await expect(
            service(db).addComment({ projectId: P, goalId: 'nope', comment: 'x', actor: { uid: OWNER } })
        ).rejects.toThrow(/Goal not found/)
        expect(db.writes).toHaveLength(0)
    })
})
