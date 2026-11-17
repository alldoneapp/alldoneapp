// alldone.team reads an Alldone project two ways: inside alldone.app the embed window pushes the
// snapshot live (utils/roadmapSourceBridge.js, with the web app's mappers and OKR helpers), on
// alldone.team itself POST /api/roadmap/source reads it once on the server
// (functions/Roadmap/roadmapSourceApi.js, with the server's mappers). alldone.team's projection
// consumes both unchanged, so for the same documents they must be equal.
//
// A web-located suite that requires functions code: runs in ci/jest.functions.config.js
// (BRIDGE_SUITES), not in the web config.

jest.mock('../../utils/backends/firestore', () => ({
    ...jest.requireActual('../../utils/backends/firestore'),
    getDb: jest.fn(),
}))

const { getDb, mapProjectData } = require('../../utils/backends/firestore')
const { PROJECT_COLOR_DEFAULT, PROJECT_COLOR_SYSTEM } = require('../../Themes/Modern/ProjectColors')
const { getActiveRoadmapProjects, subscribeToRoadmapProject } = require('../../utils/roadmapSourceBridge')
const { createFakeFirestore } = require('../../functions/Tests/fakeFirestore')
const { ROADMAP_PROJECT_COLORS, ROADMAP_PROJECT_COLOR_DEFAULT } = require('../../functions/Roadmap/roadmapSourceModel')
const { __private__: server } = require('../../functions/Roadmap/roadmapSourceApi')

const NOW = Date.UTC(2026, 10, 17, 12, 0, 0)
const DAY = 24 * 60 * 60 * 1000
const USER = 'user-1'
const PROJECT = 'project-1'

const statistic = (day, doneTime) => ({ day, doneTime })

function documents() {
    return {
        [`users/${USER}`]: {
            projectIds: [PROJECT, 'project-2', 'project-archived'],
            archivedProjectIds: ['project-archived'],
        },
        [`projects/${PROJECT}`]: {
            color: '#CB70FF',
            userIds: [USER, 'user-2'],
            focusAreas: {
                fa2: { name: ' Sales   pipeline ' },
                fa1: { name: 'Product' },
                general: { name: 'General' },
                blank: { name: '   ' },
            },
            hourlyRatesData: { currency: 'EUR', hourlyRates: { [USER]: 80, 'user-2': 200 } },
        },
        'projects/project-2': { name: 'Beta', color: '#123456', userIds: [USER] },
        'projects/project-archived': { name: 'Old', color: '#FF5274', userIds: [USER] },

        // Goals: dynamic progress, zero progress, mentions, missing dates, comments, focus areas.
        [`goals/${PROJECT}/items/g-dynamic`]: {
            extendedName: 'Ship v2 with @Anna#user-2',
            readerIds: [USER],
            ownerId: 'ALL_USERS',
            dynamicProgress: 62,
            startingMilestoneDate: NOW - 30 * DAY,
            completionMilestoneDate: NOW + 30 * DAY,
            parentDoneMilestoneIds: ['m-done'],
            progressByDoneMilestone: { 'm-done': 20 },
            dateByDoneMilestone: { 'm-done': { startingMilestoneDate: NOW - 60 * DAY } },
            sortIndexByMilestone: { 'm-open': 3 },
            scheduleMode: 'dynamic',
            focusAreaId: 'fa1',
            commentsData: { lastComment: '  Needs sign-off ', lastCommentType: 'comment', amount: 2.6 },
        },
        [`goals/${PROJECT}/items/g-zero`]: {
            name: 'Backlog idea',
            progress: 0,
            readerIds: [USER, 'user-2'],
            ownerId: 'ALL_USERS',
            scheduleMode: 'something-old',
            focusAreaId: 7,
            commentsData: { lastComment: '   ' },
        },
        [`goals/${PROJECT}/items/g-fixed`]: {
            extendedName: 'Hire designer',
            progress: 100,
            readerIds: [USER],
            ownerId: 'ALL_USERS',
            commentsData: { lastComment: 'Done', amount: 'many' },
        },
        // Not visible to the user, and a personal goal: neither may appear.
        [`goals/${PROJECT}/items/g-other-reader`]: {
            extendedName: 'Secret',
            readerIds: ['user-2'],
            ownerId: 'ALL_USERS',
        },
        [`goals/${PROJECT}/items/g-personal`]: { extendedName: 'Mine', readerIds: [USER], ownerId: USER },

        // Milestones: fixed, linear with a period, done without a done date, another owner.
        [`goalsMilestones/${PROJECT}/milestonesItems/m-open`]: {
            extendedName: 'Beta launch',
            date: NOW + 14 * DAY,
            ownerId: 'ALL_USERS',
        },
        [`goalsMilestones/${PROJECT}/milestonesItems/m-done`]: {
            extendedName: '',
            date: NOW - 14 * DAY,
            done: true,
            ownerId: 'ALL_USERS',
        },
        [`goalsMilestones/${PROJECT}/milestonesItems/m-linear`]: {
            extendedName: 'December',
            date: NOW + 40 * DAY,
            ownerId: 'ALL_USERS',
            milestoneType: 'linear',
            periodStartDate: NOW + 10 * DAY,
            periodEndDate: NOW + 40 * DAY,
            periodKey: '2026-12',
            cadence: 'monthly',
        },
        [`goalsMilestones/${PROJECT}/milestonesItems/m-personal`]: { extendedName: 'Mine', date: NOW, ownerId: USER },

        // OKRs: manual on track, manual behind, time-logged revenue, closed, someone else's.
        [`okrs/${PROJECT}/projectOkrs/o-manual`]: {
            label: 'Signups',
            currentValue: 55,
            targetValue: 100,
            unit: 'users',
            cadence: 'monthly',
            periodStart: NOW - 15 * DAY,
            periodEnd: NOW + 15 * DAY,
            status: 'active',
            ownerId: USER,
            readerIds: [USER],
        },
        [`okrs/${PROJECT}/projectOkrs/o-behind`]: {
            label: 'NPS',
            currentValue: '3',
            targetValue: 50,
            periodStart: NOW - 25 * DAY,
            periodEnd: NOW + 5 * DAY,
            ownerId: USER,
            readerIds: [USER],
            isPrivate: true,
        },
        [`okrs/${PROJECT}/projectOkrs/o-revenue`]: {
            label: 'Billable revenue',
            type: 'timeLoggedRevenue',
            currentValue: 1,
            targetValue: 4000,
            unit: 'EUR',
            cadence: 'monthly',
            periodStart: Date.UTC(2026, 10, 1),
            periodEnd: Date.UTC(2026, 10, 30, 23, 59, 59),
            ownerId: USER,
            readerIds: [USER],
        },
        [`okrs/${PROJECT}/projectOkrs/o-closed`]: {
            label: 'Q3 churn',
            currentValue: 2,
            targetValue: 1,
            periodStart: NOW - 90 * DAY,
            periodEnd: NOW - 1 * DAY,
            status: 'closed',
            ownerId: USER,
            readerIds: [USER],
        },
        [`okrs/${PROJECT}/projectOkrs/o-other`]: {
            label: 'Their OKR',
            targetValue: 10,
            ownerId: 'user-2',
            readerIds: [USER, 'user-2'],
        },

        // Logged time: inside and outside the revenue OKR's period, and another user's.
        [`statistics/${PROJECT}/${USER}/20261031`]: statistic(20261031, 600),
        [`statistics/${PROJECT}/${USER}/20261101`]: statistic(20261101, 90),
        [`statistics/${PROJECT}/${USER}/20261117`]: statistic(20261117, 240),
        [`statistics/${PROJECT}/${USER}/20261201`]: statistic(20261201, 600),
        [`statistics/${PROJECT}/user-2/20261110`]: statistic(20261110, 600),
    }
}

const flush = async () => {
    for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve))
}

async function bridgeSnapshot(db) {
    getDb.mockReturnValue(db)
    const snapshots = []
    const errors = []
    const unsubscribe = subscribeToRoadmapProject({
        projectId: PROJECT,
        userId: USER,
        onSnapshot: snapshot => snapshots.push(snapshot),
        onError: error => errors.push(error),
    })
    await flush()
    unsubscribe()
    expect(errors).toEqual([])
    expect(snapshots.length).toBeGreaterThan(0)
    return snapshots[snapshots.length - 1]
}

beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW)
})

afterEach(() => {
    jest.restoreAllMocks()
})

describe('roadmap source parity: embed bridge vs. /api/roadmap/source', () => {
    test('the server snapshot equals the bridge snapshot for the same documents', async () => {
        const db = createFakeFirestore(documents())
        const userData = (await db.doc(`users/${USER}`).get()).data()

        const fromBridge = await bridgeSnapshot(db)
        const fromServer = await server.readRoadmapSnapshot(db, { projectId: PROJECT, userId: USER, userData })

        expect(fromServer).toEqual({ snapshot: fromBridge })

        // The fixture covers what it claims to, so equality is not equality of empty lists.
        expect(fromBridge.project).toEqual({
            id: PROJECT,
            name: 'Untitled project',
            color: '#CB70FF',
            focusAreas: [
                { id: 'fa1', name: 'Product' },
                { id: 'fa2', name: 'Sales pipeline' },
            ],
        })
        expect(fromBridge.goals.map(goal => goal.id).sort()).toEqual(['g-dynamic', 'g-fixed', 'g-zero'])
        expect(fromBridge.goals.find(goal => goal.id === 'g-dynamic')).toMatchObject({
            name: 'Ship v2 with @Anna',
            progress: -1,
            commentsData: { lastComment: 'Needs sign-off', amount: 3 },
        })
        expect(fromBridge.milestones.map(milestone => milestone.id)).toEqual(['m-done', 'm-open', 'm-linear'])
        expect(fromBridge.milestones[0]).toMatchObject({ name: 'Milestone', done: true, doneDate: NOW })
        const okrs = Object.fromEntries(fromBridge.okrs.map(okr => [okr.id, okr]))
        expect(Object.keys(okrs).sort()).toEqual(['o-behind', 'o-closed', 'o-manual', 'o-revenue'])
        // 90 + 240 minutes at 80/h, the user's own time only.
        expect(okrs['o-revenue']).toMatchObject({ currentValue: 1, resolvedCurrentValue: 440 })
        expect(okrs['o-manual'].paceStatus).toBe('onTrack')
        expect(okrs['o-behind'].paceStatus).toBe('offTrack')
        expect(okrs['o-revenue'].paceStatus).toBe('offTrack')
        expect(okrs['o-closed'].paceStatus).toBe('completed')
    })

    test('a member who reads less gets the same reduced snapshot both ways', async () => {
        const db = createFakeFirestore(documents())
        getDb.mockReturnValue(db)
        const snapshots = []
        const unsubscribe = subscribeToRoadmapProject({
            projectId: PROJECT,
            userId: 'user-2',
            onSnapshot: snapshot => snapshots.push(snapshot),
            onError: () => {},
        })
        await flush()
        unsubscribe()

        const fromServer = await server.readRoadmapSnapshot(db, { projectId: PROJECT, userId: 'user-2', userData: {} })
        expect(fromServer).toEqual({ snapshot: snapshots[snapshots.length - 1] })
        expect(fromServer.snapshot.goals.map(goal => goal.id).sort()).toEqual(['g-other-reader', 'g-zero'])
    })

    test('the project list equals the one the embed window offers', async () => {
        const db = createFakeFirestore(documents())
        const userData = (await db.doc(`users/${USER}`).get()).data()
        const webProjects = ['project-1', 'project-2', 'project-archived'].map(id =>
            mapProjectData(id, db.docs.get(`projects/${id}`))
        )

        const fromServer = await server.readRoadmapProjects(db, USER, userData)
        expect(fromServer).toEqual(getActiveRoadmapProjects(webProjects, userData))
        expect(fromServer).toEqual([
            { id: 'project-2', name: 'Beta', color: ROADMAP_PROJECT_COLOR_DEFAULT },
            { id: PROJECT, name: 'Untitled project', color: '#CB70FF' },
        ])
    })

    test('the shared marker colours are the app project colours', () => {
        expect([...ROADMAP_PROJECT_COLORS].sort()).toEqual(Object.keys(PROJECT_COLOR_SYSTEM).sort())
        Object.entries(PROJECT_COLOR_SYSTEM).forEach(([stored, system]) => expect(system.MARKER).toBe(stored))
        expect(ROADMAP_PROJECT_COLOR_DEFAULT).toBe(PROJECT_COLOR_DEFAULT)
    })
})
