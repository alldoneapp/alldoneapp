jest.mock('firebase-admin', () => ({ firestore: jest.fn() }))

const DELETE_SENTINEL = { sentinel: 'delete' }
jest.mock('firebase-admin/firestore', () => ({
    FieldValue: { delete: jest.fn(() => DELETE_SENTINEL) },
}))

const {
    hasFeedPrivacyChanged,
    reconcileObjectFeedPrivacy,
    reconcileObjectFeedPrivacyOnUpdate,
    resolveFeedPrivacyReaders,
} = require('./objectFeedPrivacy')

const PROJECT = 'project-1'
const TASK = 'task-1'
const OWNER = 'owner'
const TEAMMATE = 'teammate'
const OUTSIDER_IN_LIST = 'former-member'

const feedDoc = (id, data = {}) => ({ id, data: () => data })

// A Firestore double: queries answer per collection path, writes are recorded per batch.
const makeDatabase = ({ docsByPath = {}, project = { userIds: [OWNER, TEAMMATE] } } = {}) => {
    const queries = []
    const writes = { set: [], delete: [] }
    const batch = () => ({
        set: jest.fn((ref, data, options) => writes.set.push({ path: ref.path, data, options })),
        delete: jest.fn(ref => writes.delete.push(ref.path)),
        update: jest.fn(),
        commit: jest.fn(() => Promise.resolve()),
    })
    const collection = jest.fn(path => ({
        where: jest.fn((field, op, value) => ({
            get: jest.fn(() => {
                queries.push({ path, field, op, value })
                return Promise.resolve({ docs: docsByPath[path] || [] })
            }),
        })),
    }))
    const doc = jest.fn(path => ({
        path,
        get: jest.fn(() =>
            Promise.resolve(
                path === `projects/${PROJECT}` ? { exists: Boolean(project), data: () => project } : { exists: false }
            )
        ),
    }))
    return { database: { batch, collection, doc }, queries, writes }
}

describe('hasFeedPrivacyChanged', () => {
    it('ignores order and unrelated fields, and sees a real move', () => {
        expect(
            hasFeedPrivacyChanged({ isPublicFor: [0, OWNER], name: 'a' }, { isPublicFor: [OWNER, 0], name: 'b' })
        ).toBe(false)
        expect(hasFeedPrivacyChanged({ isPublicFor: [0] }, { isPublicFor: [OWNER] })).toBe(true)
        expect(hasFeedPrivacyChanged({}, {})).toBe(false)
        expect(hasFeedPrivacyChanged({}, { isPublicFor: [OWNER] })).toBe(true)
    })
})

describe('resolveFeedPrivacyReaders', () => {
    it('answers in project members, never in the raw list', () => {
        expect(resolveFeedPrivacyReaders([OWNER, OUTSIDER_IN_LIST], [OWNER, TEAMMATE])).toEqual({
            isProjectWide: false,
            usersWithAccess: [OWNER],
            usersWithoutAccess: [TEAMMATE],
        })
        expect(resolveFeedPrivacyReaders([0], [OWNER, TEAMMATE])).toEqual({
            isProjectWide: true,
            usersWithAccess: [OWNER, TEAMMATE],
            usersWithoutAccess: [],
        })
    })
})

describe('reconcileObjectFeedPrivacy', () => {
    it('removes the activity from members that lost access and re-privatises what the rest can see', async () => {
        const teammateStore = `feedsStore/${PROJECT}/${TEAMMATE}/feeds/followed`
        const ownerStore = `feedsStore/${PROJECT}/${OWNER}/feeds/followed`
        const allStore = `feedsStore/${PROJECT}/all`
        const history = `projectsInnerFeeds/${PROJECT}/tasks/${TASK}/feeds`
        const { database, queries, writes } = makeDatabase({
            docsByPath: {
                [teammateStore]: [feedDoc('t-1'), feedDoc('t-2')],
                [ownerStore]: [feedDoc('o-1')],
                [allStore]: [feedDoc('a-1', { isCommentPublicFor: [TEAMMATE] })],
                [history]: [feedDoc('h-1')],
            },
        })

        await expect(
            reconcileObjectFeedPrivacy({
                database,
                projectId: PROJECT,
                objectType: 'tasks',
                objectId: TASK,
                isPublicFor: [OWNER],
                projectUserIds: [OWNER, TEAMMATE],
            })
        ).resolves.toEqual({ deleted: 2, updated: 3, counters: 1 })

        expect(queries.map(query => query.path).sort()).toEqual([teammateStore, ownerStore, allStore, history].sort())
        queries.forEach(query => expect([query.field, query.op, query.value]).toEqual(['objectId', '==', TASK]))

        expect(writes.delete).toEqual([`${teammateStore}/t-1`, `${teammateStore}/t-2`])
        expect(writes.set).toContainEqual({
            path: `feedsCount/${PROJECT}/${TEAMMATE}/followed`,
            data: { tasks: { [TASK]: DELETE_SENTINEL } },
            options: { merge: true },
        })
        expect(writes.set).toContainEqual({
            path: `feedsCount/${PROJECT}/${TEAMMATE}/all`,
            data: { tasks: { [TASK]: DELETE_SENTINEL } },
            options: { merge: true },
        })
        expect(writes.set).toContainEqual({
            path: `${ownerStore}/o-1`,
            data: { isPublicFor: [OWNER] },
            options: { merge: true },
        })
        // A comment shared with the teammate keeps them as a reader of that one entry.
        expect(writes.set).toContainEqual({
            path: `${allStore}/a-1`,
            data: { isPublicFor: [OWNER, TEAMMATE] },
            options: { merge: true },
        })
        expect(writes.set).toContainEqual({
            path: `${history}/h-1`,
            data: { isPublicFor: [OWNER] },
            options: { merge: true },
        })
        expect(writes.set.some(write => write.path.startsWith(`feedsCount/${PROJECT}/${OWNER}/`))).toBe(false)
    })

    it('opens the activity back up to every member when the object becomes project-wide', async () => {
        const teammateStore = `feedsStore/${PROJECT}/${TEAMMATE}/feeds/followed`
        const { database, writes } = makeDatabase({ docsByPath: { [teammateStore]: [feedDoc('t-1')] } })

        await expect(
            reconcileObjectFeedPrivacy({
                database,
                projectId: PROJECT,
                objectType: 'notes',
                objectId: 'note-1',
                isPublicFor: [0],
                projectUserIds: [OWNER, TEAMMATE],
            })
        ).resolves.toEqual({ deleted: 0, updated: 1, counters: 0 })
        expect(writes.delete).toEqual([])
        expect(writes.set).toEqual([
            { path: `${teammateStore}/t-1`, data: { isPublicFor: [0] }, options: { merge: true } },
        ])
    })

    it('refuses to act on an object without a readable privacy', async () => {
        const { database } = makeDatabase()
        await expect(
            reconcileObjectFeedPrivacy({ database, projectId: PROJECT, objectType: 'tasks', objectId: TASK })
        ).resolves.toEqual({ deleted: 0, updated: 0, counters: 0 })
        expect(database.collection).not.toHaveBeenCalled()
    })
})

describe('reconcileObjectFeedPrivacyOnUpdate', () => {
    it('is a no-op for an update that did not move isPublicFor', async () => {
        const { database } = makeDatabase()
        await expect(
            reconcileObjectFeedPrivacyOnUpdate({
                database,
                projectId: PROJECT,
                objectType: 'tasks',
                objectId: TASK,
                before: { isPublicFor: [OWNER], name: 'a' },
                after: { isPublicFor: [OWNER], name: 'b' },
            })
        ).resolves.toBeNull()
        expect(database.doc).not.toHaveBeenCalled()
    })

    it('resolves the members from the project document and reconciles a real change', async () => {
        const teammateStore = `feedsStore/${PROJECT}/${TEAMMATE}/feeds/followed`
        const { database, writes } = makeDatabase({ docsByPath: { [teammateStore]: [feedDoc('t-1')] } })

        await expect(
            reconcileObjectFeedPrivacyOnUpdate({
                database,
                projectId: PROJECT,
                objectType: 'tasks',
                objectId: TASK,
                before: { isPublicFor: [0] },
                after: { isPublicFor: [OWNER] },
            })
        ).resolves.toEqual({ deleted: 1, updated: 0, counters: 1 })
        expect(writes.delete).toEqual([`${teammateStore}/t-1`])
    })

    it('does nothing for a project that no longer exists', async () => {
        const { database } = makeDatabase({ project: null })
        await expect(
            reconcileObjectFeedPrivacyOnUpdate({
                database,
                projectId: PROJECT,
                objectType: 'tasks',
                objectId: TASK,
                before: { isPublicFor: [0] },
                after: { isPublicFor: [OWNER] },
            })
        ).resolves.toBeNull()
        expect(database.collection).not.toHaveBeenCalled()
    })
})
