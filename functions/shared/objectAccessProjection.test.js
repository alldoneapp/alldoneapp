'use strict'

const {
    buildBacklinkToken,
    buildObjectAccessProjection,
    getInitialProjectionCursor,
    isAccessProjectionOnlyChange,
    synchronizeProjectAccessProjectionPage,
    valuesEqual,
} = require('./objectAccessProjection')

function createPagingDb(documentsByPath, collectionPathsByDoc = {}) {
    const writes = []

    const makeCollection = (path, documents = []) => ({
        id: path.split('/').pop(),
        doc: id => ({ collection: child => makeCollection(`${path}/${id}/${child}`, []) }),
        orderBy: () => {
            let afterId = null
            let limit = Infinity
            const query = {
                startAfter: id => {
                    afterId = id
                    return query
                },
                limit: value => {
                    limit = value
                    return query
                },
                get: async () => {
                    const docs = documents
                        .filter(document => !afterId || document.id > afterId)
                        .slice(0, limit)
                        .map(document => ({
                            id: document.id,
                            data: () => document.data,
                            ref: { path: `${path}/${document.id}` },
                        }))
                    return { docs, size: docs.length, empty: docs.length === 0 }
                },
            }
            return query
        },
    })

    return {
        writes,
        collection: path => makeCollection(path, documentsByPath[path] || []),
        doc: path => ({
            listCollections: async () =>
                (collectionPathsByDoc[path] || []).map(collectionPath =>
                    makeCollection(collectionPath, documentsByPath[collectionPath] || [])
                ),
        }),
        bulkWriter: () => ({
            set: (ref, data, options) => writes.push({ ref, data, options }),
            close: async () => {},
        }),
    }
}

describe('object access projection', () => {
    it('expands a project-public object to the authoritative project members', () => {
        expect(
            buildObjectAccessProjection(
                {
                    isPublicFor: [0, 'stale-user'],
                    observersIds: ['observer-2', 'observer-1'],
                    linkedParentTasksIds: ['task-b', 'task-a'],
                },
                ['member-2', 'member-1', 'member-1'],
                'observersIds'
            )
        ).toEqual({
            readerIds: [0, 'member-1', 'member-2'],
            roleIdsVisibleTo: {
                0: ['observer-1', 'observer-2'],
                'member-1': ['observer-1', 'observer-2'],
                'member-2': ['observer-1', 'observer-2'],
            },
            followedByVisibleTo: {},
            followedReaderIds: [],
            backlinkIdsVisibleTo: {
                0: [
                    buildBacklinkToken('linkedParentTasksIds', 'task-a'),
                    buildBacklinkToken('linkedParentTasksIds', 'task-b'),
                ],
                'member-1': [
                    buildBacklinkToken('linkedParentTasksIds', 'task-a'),
                    buildBacklinkToken('linkedParentTasksIds', 'task-b'),
                ],
                'member-2': [
                    buildBacklinkToken('linkedParentTasksIds', 'task-a'),
                    buildBacklinkToken('linkedParentTasksIds', 'task-b'),
                ],
            },
        })
    })

    it('intersects private readers with current project membership', () => {
        expect(
            buildObjectAccessProjection(
                { isPublicFor: ['member-2', 'former-member'], assigneesIds: ['assignee-1'] },
                ['member-1', 'member-2'],
                'assigneesIds'
            )
        ).toEqual({
            readerIds: ['member-2'],
            roleIdsVisibleTo: { 'member-2': ['assignee-1'] },
            followedByVisibleTo: {},
            followedReaderIds: [],
            backlinkIdsVisibleTo: {},
        })
    })

    it('projects followed chats only for followers who can read them', () => {
        expect(
            buildObjectAccessProjection(
                { isPublicFor: [0], usersFollowing: ['member-1', 'former-member'] },
                ['member-1', 'member-2'],
                null,
                'usersFollowing'
            )
        ).toEqual({
            readerIds: [0, 'member-1', 'member-2'],
            roleIdsVisibleTo: { 0: [], 'member-1': [], 'member-2': [] },
            followedByVisibleTo: { 'member-1': true },
            followedReaderIds: ['member-1'],
            backlinkIdsVisibleTo: {},
        })
    })

    it('projects followed notes from their privacy-filtered follower field', () => {
        expect(
            buildObjectAccessProjection(
                {
                    isPublicFor: ['member-1'],
                    isVisibleInFollowedFor: ['member-1', 'member-2'],
                },
                ['member-1', 'member-2'],
                null,
                'isVisibleInFollowedFor'
            )
        ).toMatchObject({ followedReaderIds: ['member-1'] })
    })

    it('recognizes the server projection write so business triggers can ignore it', () => {
        const before = { title: 'Task', isPublicFor: [0], readerIds: ['member-1'] }

        expect(
            isAccessProjectionOnlyChange(before, {
                ...before,
                readerIds: ['member-1', 'member-2'],
                roleIdsVisibleTo: { 'member-1': [], 'member-2': [] },
                backlinkIdsVisibleTo: { 'member-1': [], 'member-2': [] },
            })
        ).toBe(true)
        expect(isAccessProjectionOnlyChange(before, { ...before, title: 'Changed' })).toBe(false)
    })

    it('treats Firestore map key reordering as equal without ignoring array order', () => {
        expect(valuesEqual({ memberB: [], memberA: ['observer'] }, { memberA: ['observer'], memberB: [] })).toBe(true)
        expect(valuesEqual(['member-a', 'member-b'], ['member-b', 'member-a'])).toBe(false)
    })

    it('reconciles membership changes in bounded resumable pages', async () => {
        const db = createPagingDb({
            'items/project-1/tasks': [
                { id: 'task-1', data: { isPublicFor: [0] } },
                { id: 'task-2', data: { isPublicFor: [0] } },
                { id: 'task-3', data: { isPublicFor: [0] } },
            ],
        })

        const first = await synchronizeProjectAccessProjectionPage(
            db,
            'project-1',
            ['member-1'],
            getInitialProjectionCursor(),
            2
        )
        expect(first).toMatchObject({
            scanned: 2,
            updated: 2,
            done: false,
            cursor: { phase: 'objects', specIndex: 0, documentId: 'task-2' },
        })

        const second = await synchronizeProjectAccessProjectionPage(db, 'project-1', ['member-1'], first.cursor, 2)
        expect(second).toMatchObject({
            scanned: 1,
            updated: 1,
            done: true,
            cursor: null,
        })
        expect(db.writes).toHaveLength(3)
    })

    it('packs small nested feed collections into one bounded page', async () => {
        const feedPaths = Array.from(
            { length: 30 },
            (_, index) => `projectsFeeds/project-1/date-${String(index + 1).padStart(2, '0')}`
        )
        const db = createPagingDb(
            Object.fromEntries(
                feedPaths.map((path, index) => [path, [{ id: `feed-${index + 1}`, data: { isPublicFor: [0] } }]])
            ),
            { 'projectsFeeds/project-1': feedPaths }
        )

        const first = await synchronizeProjectAccessProjectionPage(
            db,
            'project-1',
            ['member-1'],
            getInitialProjectionCursor(),
            400
        )
        expect(first).toMatchObject({
            scanned: 25,
            updated: 25,
            done: false,
            cursor: { phase: 'project-feeds', collectionId: 'date-26', documentId: null },
        })

        const second = await synchronizeProjectAccessProjectionPage(db, 'project-1', ['member-1'], first.cursor, 400)
        expect(second).toMatchObject({ scanned: 5, updated: 5, done: true, cursor: null })
        expect(db.writes).toHaveLength(30)
    })
})
