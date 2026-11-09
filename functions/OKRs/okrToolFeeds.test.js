const mockCommit = jest.fn(async () => {})
const mockLoadState = jest.fn(async () => {})
const mockCreateProjectEntryFeed = jest.fn(async () => ({}))

jest.mock('firebase-admin', () => ({ firestore: () => ({}) }))
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { delete: () => '__delete__' } }))
jest.mock('../shared/contactUpdateHelper', () => ({
    loadFeedsStateForContactWrite: (...args) => mockLoadState(...args),
}))
jest.mock('../Feeds/projectEntryFeeds', () => ({
    createProjectEntryFeed: (...args) => mockCreateProjectEntryFeed(...args),
}))

const { createFakeFirestore } = require('../Tests/fakeFirestore')
const {
    buildOkrToolFeeds,
    describeOkrCreated,
    describeOkrUpdate,
    okrAudience,
    reconcileOkrFeedPrivacy,
    reconcileOkrFeedPrivacyOnUpdate,
} = require('./okrToolFeeds')

const okr = (extra = {}) => ({
    id: 'o1',
    ownerId: 'owner',
    label: 'Paying customers',
    currentValue: 2,
    targetValue: 10,
    unit: 'customers',
    cadence: 'monthly',
    isPrivate: false,
    isPublicFor: [0],
    ...extra,
})

beforeEach(() => jest.clearAllMocks())

describe('how an OKR change reads in Updates', () => {
    test('a new OKR names its target and cadence', () => {
        expect(describeOkrCreated(okr())).toBe('created OKR "Paying customers" • Target 10 customers, monthly')
        expect(describeOkrCreated(okr({ unit: '', cadence: 'weekly', targetValue: 3 }))).toBe(
            'created OKR "Paying customers" • Target 3, weekly'
        )
    })

    test('one line says everything a call changed, and nothing for the period dates alone', () => {
        expect(describeOkrUpdate(okr(), okr({ currentValue: 3 }))).toBe(
            'changed OKR "Paying customers" • Current value from 2 customers to 3 customers'
        )
        expect(
            describeOkrUpdate(
                okr(),
                okr({
                    label: 'Customers',
                    targetValue: 12,
                    unit: '',
                    cadence: 'quarterly',
                    isPrivate: true,
                    isPublicFor: ['owner'],
                })
            )
        ).toBe(
            'changed OKR "Customers" • Renamed from "Paying customers", target from 10 customers to 12, unit from customers to (none), cadence from monthly to quarterly, made private'
        )
        expect(describeOkrUpdate(okr({ isPrivate: true, isPublicFor: ['owner'] }), okr())).toBe(
            'changed OKR "Paying customers" • Made visible to the project'
        )
        expect(describeOkrUpdate(okr(), okr({ periodStart: 5, periodEnd: 6 }))).toBeNull()
    })

    test('an OKR is as private as the app reads it', () => {
        expect(okrAudience(okr())).toEqual([0])
        expect(okrAudience(okr({ isPublicFor: ['owner'] }))).toEqual(['owner'])
        expect(okrAudience(okr({ isPublicFor: undefined, isPrivate: true }))).toEqual(['owner'])
    })
})

describe('the entries the OKR tools write', () => {
    const feedUser = { uid: 'owner', via: 'mcp', viaClient: 'Codex' }
    const project = { id: 'p1', userIds: ['owner', 'member'] }
    const feeds = () => buildOkrToolFeeds({ db: {}, projectId: 'p1', feedUser, userId: 'owner' })

    test('a created OKR is a line on the project, carrying its id and its audience', async () => {
        await feeds().onOkrCreated(okr({ isPrivate: true, isPublicFor: ['owner'] }), project)
        expect(mockLoadState).toHaveBeenCalledWith({ db: {}, projectId: 'p1', feedUser, userId: 'owner' })
        expect(mockCreateProjectEntryFeed).toHaveBeenCalledWith(
            expect.objectContaining({
                projectId: 'p1',
                project,
                feedType: 'FEED_PROJECT_OKR_CREATED',
                entryText: 'created OKR "Paying customers" • Target 10 customers, monthly',
                isPublicFor: ['owner'],
                extraFields: { okrId: 'o1' },
                feedUser,
            })
        )
    })

    test('a changed OKR is a line with the audience it has now; no change, no line', async () => {
        await feeds().onOkrUpdated(okr(), okr({ currentValue: 4 }), project)
        expect(mockCreateProjectEntryFeed).toHaveBeenCalledWith(
            expect.objectContaining({
                feedType: 'FEED_PROJECT_OKR_CHANGED',
                entryText: 'changed OKR "Paying customers" • Current value from 2 customers to 4 customers',
                isPublicFor: [0],
            })
        )
        mockCreateProjectEntryFeed.mockClear()
        await feeds().onOkrUpdated(okr(), okr(), project)
        expect(mockCreateProjectEntryFeed).not.toHaveBeenCalled()
    })

    test('a private OKR nobody owns gets no line rather than a project-wide one', async () => {
        await feeds().onOkrCreated(okr({ ownerId: '', isPrivate: true, isPublicFor: undefined }), project)
        expect(mockCreateProjectEntryFeed).not.toHaveBeenCalled()
    })
})

describe('the entries follow the OKR when its privacy changes', () => {
    const entry = (extra = {}) => ({ type: 'FEED_PROJECT_OKR_CHANGED', okrId: 'o1', isPublicFor: [0], ...extra })
    const seeded = () =>
        createFakeFirestore({
            'projects/p1': { userIds: ['owner', 'member'] },
            'feedsStore/p1/all/f1': entry(),
            'feedsStore/p1/all/f2': entry({ okrId: 'o2' }),
            'feedsStore/p1/owner/feeds/followed/f1': entry(),
            'feedsStore/p1/member/feeds/followed/f1': entry(),
            'feedsStore/p1/member/feeds/followed/f3': entry({
                okrId: undefined,
                type: 'FEED_PROJECT_DESCRIPTION_CHANGED',
            }),
            'projectsInnerFeeds/p1/projects/p1/feeds/f1': entry(),
        })

    test('made private: the owner keeps its lines, everybody else loses them, their counters included', async () => {
        const db = seeded()
        const totals = await reconcileOkrFeedPrivacy({
            database: db,
            projectId: 'p1',
            okrId: 'o1',
            isPublicFor: ['owner'],
            projectUserIds: ['owner', 'member'],
        })

        expect(totals).toEqual({ deleted: 1, updated: 3, counters: 1 })
        expect(db.docs.get('feedsStore/p1/all/f1').isPublicFor).toEqual(['owner'])
        expect(db.docs.get('projectsInnerFeeds/p1/projects/p1/feeds/f1').isPublicFor).toEqual(['owner'])
        expect(db.docs.get('feedsStore/p1/owner/feeds/followed/f1').isPublicFor).toEqual(['owner'])
        expect(db.docs.has('feedsStore/p1/member/feeds/followed/f1')).toBe(false)
        // Another OKR's line and the project's own lines stay as they are.
        expect(db.docs.get('feedsStore/p1/all/f2').isPublicFor).toEqual([0])
        expect(db.docs.has('feedsStore/p1/member/feeds/followed/f3')).toBe(true)
        // Only this OKR's slots of the project's counter, never the whole project slot.
        const counterWrites = db.writes.filter(write => write.path.startsWith('feedsCount/'))
        expect(counterWrites.map(write => write.path).sort()).toEqual([
            'feedsCount/p1/member/all',
            'feedsCount/p1/member/followed',
        ])
        counterWrites.forEach(write => expect(write.data).toEqual({ projects: { p1: { f1: '__delete__' } } }))
    })

    test('the trigger does nothing unless the audience moved', async () => {
        const db = seeded()
        await expect(
            reconcileOkrFeedPrivacyOnUpdate({
                database: db,
                projectId: 'p1',
                okrId: 'o1',
                before: okr({ currentValue: 1 }),
                after: okr({ currentValue: 2 }),
            })
        ).resolves.toBeNull()
        expect(db.writes).toHaveLength(0)

        const totals = await reconcileOkrFeedPrivacyOnUpdate({
            database: db,
            projectId: 'p1',
            okrId: 'o1',
            before: okr(),
            after: okr({ isPrivate: true, isPublicFor: ['owner'] }),
        })
        expect(totals).toMatchObject({ deleted: 1, updated: 3 })
    })
})
