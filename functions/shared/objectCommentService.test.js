const { createFakeFirestore } = require('../Tests/fakeFirestore')
const { ObjectCommentService } = require('./objectCommentService')

const P = 'proj1'
const OWNER = 'karsten'
const MEMBER = 'anna'
const OUTSIDER = 'bob'

const project = { [`projects/${P}`]: { name: 'Alldone Growth', userIds: [OWNER, MEMBER, OUTSIDER] } }

const goal = (extra = {}) => ({
    extendedName: 'Pick the winning segment',
    name: 'pick the winning segment',
    creatorId: OWNER,
    assigneesIds: [OWNER, 'ws@default'],
    isPublicFor: [0],
    commentsData: { amount: 2, lastComment: 'older' },
    ...extra,
})

let idCounter = 0
const service = db =>
    new ObjectCommentService({
        database: db,
        createId: () => `c${++idCounter}`,
        createTimestamp: () => 'TIMESTAMP',
        baseUrl: 'https://my.alldone.app',
    })

const notificationsFor = db =>
    [...db.docs.keys()].filter(path => path.startsWith(`chatNotifications/${P}/`)).map(path => path.split('/')[2])
const firstDocUnder = (db, prefix) => [...db.docs.keys()].find(path => path.startsWith(prefix))

describe('ObjectCommentService on goals', () => {
    test('writes the comment, the goal and chat metadata and the followers in one go, and notifies the others', async () => {
        const db = createFakeFirestore({
            ...project,
            [`goals/${P}/items/g1`]: goal(),
            [`followers/${P}/goals/g1`]: { usersFollowing: [MEMBER] },
        })
        const result = await service(db).addComment({
            objectType: 'goals',
            projectId: P,
            objectId: 'g1',
            comment: '  Segment A answers best so far.  ',
            actor: { uid: 'assistant-1', displayName: 'Growth Lead' },
            fromAssistant: true,
            requestUserId: OWNER,
        })

        expect(result).toMatchObject({ success: true, notifiedFollowers: 2, silent: false })
        const commentId = result.commentId
        expect(db.docs.get(`chatComments/${P}/goals/g1/comments/${commentId}`)).toEqual({
            creatorId: 'assistant-1',
            commentText: 'Segment A answers best so far.',
            originalContent: 'Segment A answers best so far.',
            commentType: 2, // STAYWARD_COMMENT
            lastChangeDate: 'TIMESTAMP',
            created: expect.any(Number),
            fromAssistant: true,
            requestUserId: OWNER,
        })
        expect(db.docs.get(`goals/${P}/items/g1`).commentsData).toMatchObject({
            amount: 3,
            lastComment: 'Segment A answers best so far.',
            lastCommentOwnerId: 'assistant-1',
        })
        const chat = db.docs.get(`chatObjects/${P}/chats/g1`)
        expect(chat).toMatchObject({
            id: 'g1',
            type: 'goals',
            title: 'Pick the winning segment',
            isPublicFor: [0],
            assistantId: 'assistant-1',
            commentsData: { amount: 1, lastComment: 'Segment A answers best so far.' },
        })
        // The workstream placeholder is not a person and never follows anything.
        expect([...chat.usersFollowing].sort()).toEqual([MEMBER, OWNER, 'assistant-1'].sort())
        expect([...db.docs.get(`followers/${P}/goals/g1`).usersFollowing].sort()).toEqual(
            [...chat.usersFollowing].sort()
        )

        expect(notificationsFor(db).sort()).toEqual([MEMBER, OWNER].sort())
        expect(db.docs.get(`chatNotifications/${P}/${OWNER}/${commentId}`)).toMatchObject({
            chatId: 'g1',
            chatType: 'goals',
            creatorType: 'assistant',
        })
        expect(db.docs.get('emailNotifications/g1')).toMatchObject({ objectType: 'goals', objectId: 'g1' })
        expect(db.docs.get(`pushNotifications/${commentId}`)).toMatchObject({
            body: 'Alldone Growth\n  ✔ Pick the winning segment\n Growth Lead commented: Segment A answers best so far.',
            link: `https://my.alldone.app/projects/${P}/goals/g1/chat`,
            chatId: 'g1',
            initiatorId: 'assistant-1',
        })
    })

    test("an MCP client's comment carries the marker and also notifies the user it acted for", async () => {
        const db = createFakeFirestore({ ...project, [`goals/${P}/items/g1`]: goal() })
        await service(db).addComment({
            objectType: 'goals',
            projectId: P,
            objectId: 'g1',
            comment: 'Done for today.',
            actor: { uid: OWNER, displayName: 'Karsten Wysk', via: 'mcp', viaClient: 'Claude' },
        })
        expect(db.docs.get(firstDocUnder(db, 'chatComments/'))).toMatchObject({
            via: 'mcp',
            viaClient: 'Claude',
            fromAssistant: false,
        })
        expect(notificationsFor(db)).toEqual([OWNER])
        const push = db.docs.get(firstDocUnder(db, 'pushNotifications/'))
        expect(push).toMatchObject({ initiatorVia: 'mcp' })
        expect(push.body).toMatch(/Karsten Wysk \(via Claude\) commented/)
    })

    test('a silent comment is in the thread but marks nothing unread', async () => {
        const db = createFakeFirestore({ ...project, [`goals/${P}/items/g1`]: goal() })
        const result = await service(db).addComment({
            objectType: 'goals',
            projectId: P,
            objectId: 'g1',
            comment: 'Quiet note.',
            actor: { uid: 'assistant-1' },
            fromAssistant: true,
            silent: true,
        })
        expect(result).toMatchObject({ silent: true, notifiedFollowers: 0 })
        expect(firstDocUnder(db, 'chatComments/')).toBeDefined()
        expect(notificationsFor(db)).toEqual([])
        expect(firstDocUnder(db, 'pushNotifications/')).toBeUndefined()
    })

    test('followers who cannot see a private goal are not notified', async () => {
        const db = createFakeFirestore({
            ...project,
            [`goals/${P}/items/g1`]: goal({ isPublicFor: [OWNER] }),
            [`followers/${P}/goals/g1`]: { usersFollowing: [OUTSIDER] },
        })
        await service(db).addComment({
            objectType: 'goals',
            projectId: P,
            objectId: 'g1',
            comment: 'Private.',
            actor: { uid: MEMBER },
        })
        expect(notificationsFor(db)).toEqual([OWNER])
    })

    test('an empty comment, a missing object or an unknown type writes nothing', async () => {
        const db = createFakeFirestore({ ...project, [`goals/${P}/items/g1`]: goal() })
        const base = { projectId: P, actor: { uid: OWNER } }
        await expect(
            service(db).addComment({ ...base, objectType: 'goals', objectId: 'g1', comment: '   ' })
        ).rejects.toThrow(/must not be empty/)
        await expect(
            service(db).addComment({ ...base, objectType: 'goals', objectId: 'nope', comment: 'x' })
        ).rejects.toThrow(/Goal not found/)
        await expect(
            service(db).addComment({ ...base, objectType: 'tasks', objectId: 'g1', comment: 'x' })
        ).rejects.toThrow(/not supported/)
        expect(db.writes).toHaveLength(0)
    })
})

describe('ObjectCommentService on contacts and artifacts', () => {
    test("a contact's thread is followed by whoever recorded the contact", async () => {
        const db = createFakeFirestore({
            ...project,
            [`projectsContacts/${P}/contacts/c9`]: { displayName: 'Jane Prospect', recorderUserId: MEMBER },
        })
        const result = await service(db).addComment({
            objectType: 'contacts',
            projectId: P,
            objectId: 'c9',
            comment: 'Replied on LinkedIn, wants a demo next week.',
            actor: { uid: OWNER, displayName: 'Karsten Wysk', via: 'mcp', viaClient: 'Claude' },
        })
        expect(db.docs.get(`chatComments/${P}/contacts/c9/comments/${result.commentId}`)).toMatchObject({
            commentText: 'Replied on LinkedIn, wants a demo next week.',
        })
        expect(db.docs.get(`projectsContacts/${P}/contacts/c9`).commentsData).toMatchObject({ amount: 1 })
        expect(db.docs.get(`chatObjects/${P}/chats/c9`)).toMatchObject({
            type: 'contacts',
            title: 'Jane Prospect',
            // A contact without a stored audience is visible to the project and its recorder, as in
            // mapContactData.
            isPublicFor: [0, MEMBER],
            creatorId: MEMBER,
        })
        expect(notificationsFor(db).sort()).toEqual([MEMBER, OWNER].sort())
        expect(db.docs.get(`pushNotifications/${result.commentId}`).link).toBe(
            `https://my.alldone.app/projects/${P}/contacts/c9/chat`
        )
    })

    test("an artifact's thread is followed by its owner, and a private artifact notifies only them", async () => {
        const db = createFakeFirestore({
            ...project,
            [`artifactItems/${P}/artifacts/a1`]: {
                title: 'Growth Scoreboard',
                userId: OWNER,
                creatorId: OWNER,
                isPrivate: true,
                isPublicFor: [OWNER],
            },
            [`followers/${P}/artifacts/a1`]: { usersFollowing: [MEMBER] },
        })
        const result = await service(db).addComment({
            objectType: 'artifacts',
            projectId: P,
            objectId: 'a1',
            comment: 'Traffic now includes the app property.',
            actor: { uid: 'assistant-1', displayName: 'Growth Lead' },
            fromAssistant: true,
        })
        expect(db.docs.get(`chatObjects/${P}/chats/a1`)).toMatchObject({
            type: 'artifacts',
            title: 'Growth Scoreboard',
            isPublicFor: [OWNER],
        })
        expect(notificationsFor(db)).toEqual([OWNER])
        expect(db.docs.get(`pushNotifications/${result.commentId}`).link).toBe(
            `https://my.alldone.app/projects/${P}/artifacts/a1/chat`
        )
    })
})
