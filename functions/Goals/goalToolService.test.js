const { createFakeFirestore } = require('../Tests/fakeFirestore')
const {
    GoalToolError,
    createGoal,
    updateGoal,
    updateMilestone,
    getLocalNoon,
    formatDay,
    normalizeProgressInput,
} = require('./goalToolService')

const BACKLOG = Number.MAX_SAFE_INTEGER
const P = 'proj1'
const USER = 'user1'
const OTHER = 'user2'

// Berlin in November is UTC+1. The user document says 1 (hours), as the app writes it.
const NOON_2026_11_22 = Date.UTC(2026, 10, 22, 11, 0, 0)
const NOON_2026_12_20 = Date.UTC(2026, 11, 20, 11, 0, 0)

let sortCounter = 0
const createSortIndex = () => ++sortCounter

const baseDocs = (extra = {}) => ({
    [`projects/${P}`]: { name: 'Alldone Growth', userIds: [USER, OTHER] },
    [`users/${USER}`]: { timezone: 1 },
    [`users/${OTHER}`]: { timezone: 1 },
    ...extra,
})

const openMilestone = (date, extra = {}) => ({
    extendedName: '',
    created: 1,
    date,
    done: false,
    assigneesCapacityDates: {},
    doneDate: 1,
    hasStar: '#FFFFFF',
    ownerId: 'ALL_USERS',
    milestoneType: 'fixed',
    ...extra,
})

const goalDoc = (extra = {}) => ({
    name: 'existing goal',
    extendedName: 'Existing goal',
    progress: 'DYNAMIC_PERCENT',
    dynamicProgress: 0,
    assigneesIds: [USER],
    assigneesCapacity: { [USER]: 'CAPACITY_NONE' },
    assigneesReminderDate: { [USER]: NOON_2026_11_22 },
    description: '',
    startingMilestoneDate: NOON_2026_11_22,
    completionMilestoneDate: NOON_2026_11_22,
    parentDoneMilestoneIds: [],
    isPublicFor: [0],
    sortIndexByMilestone: { m1: 5 },
    ownerId: 'ALL_USERS',
    scheduleMode: 'fixed',
    ...extra,
})

const milestonesIn = db =>
    [...db.docs.entries()]
        .filter(([path]) => path.startsWith(`goalsMilestones/${P}/milestonesItems/`))
        .map(([path, data]) => ({ id: path.split('/').pop(), ...data }))

const goalsIn = db =>
    [...db.docs.entries()]
        .filter(([path]) => path.startsWith(`goals/${P}/items/`))
        .map(([path, data]) => ({ id: path.split('/').pop(), ...data }))

describe('dates', () => {
    test('a day is local noon for an integer offset and for an IANA zone', () => {
        expect(getLocalNoon('2026-11-22', { timezone: 1 })).toBe(NOON_2026_11_22)
        expect(getLocalNoon('2026-11-22', { timezone: 'Europe/Berlin' })).toBe(NOON_2026_11_22)
        expect(getLocalNoon('2026-07-01', { timezone: 'Europe/Berlin' })).toBe(Date.UTC(2026, 6, 1, 10, 0, 0))
        expect(formatDay(NOON_2026_11_22, { timezone: 1 })).toBe('2026-11-22')
        expect(formatDay(BACKLOG, {})).toBe('someday')
    })

    test('progress accepts 0-100 and "auto", and nothing else', () => {
        expect(normalizeProgressInput(40)).toBe(40)
        expect(normalizeProgressInput('55%')).toBe(55)
        expect(normalizeProgressInput('auto')).toBe('DYNAMIC_PERCENT')
        expect(() => normalizeProgressInput(120)).toThrow(GoalToolError)
        expect(() => normalizeProgressInput('soon')).toThrow(GoalToolError)
    })
})

describe('create_goal', () => {
    test('a date no goal uses yet creates its milestone, and the goal sits in it', async () => {
        const db = createFakeFirestore(baseDocs())
        const onGoalCreated = jest.fn()
        const result = await createGoal({
            db,
            projectId: P,
            userId: USER,
            args: { name: 'Pick the winning segment', milestoneDate: '2026-11-22', description: 'Decide by 22.11.' },
            now: 1000,
            createSortIndex,
            feeds: { onGoalCreated },
        })

        expect(result.success).toBe(true)
        expect(result.milestone).toMatchObject({ date: '2026-11-22', created: true })
        const [milestone] = milestonesIn(db)
        expect(milestone).toMatchObject({
            date: NOON_2026_11_22,
            done: false,
            ownerId: 'ALL_USERS',
            milestoneType: 'fixed',
        })

        const [goal] = goalsIn(db)
        expect(goal).toMatchObject({
            extendedName: 'Pick the winning segment',
            name: 'pick the winning segment',
            completionMilestoneDate: NOON_2026_11_22,
            startingMilestoneDate: NOON_2026_11_22,
            progress: 'DYNAMIC_PERCENT',
            assigneesIds: [USER],
            isPublicFor: [0],
            ownerId: 'ALL_USERS',
            scheduleMode: 'fixed',
            creatorId: USER,
        })
        expect(goal.sortIndexByMilestone[milestone.id]).toBeGreaterThan(0)
        expect(goal.readerIds).toBeUndefined()
        expect(onGoalCreated).toHaveBeenCalledWith(expect.objectContaining({ id: goal.id }))
    })

    test('a milestone the app wrote at a slightly different noon is reused, and the goal takes its exact date', async () => {
        // The browser that made it ran at UTC+2, so its noon is an hour earlier than ours.
        const appNoon = NOON_2026_11_22 - 60 * 60 * 1000
        const db = createFakeFirestore(
            baseDocs({
                [`goalsMilestones/${P}/milestonesItems/m1`]: openMilestone(appNoon, { extendedName: 'Discovery' }),
            })
        )
        const result = await createGoal({
            db,
            projectId: P,
            userId: USER,
            args: { name: 'Second goal', milestoneDate: '2026-11-22', progress: 30 },
            createSortIndex,
        })

        expect(result.milestone).toMatchObject({ id: 'm1', name: 'Discovery', created: false })
        expect(milestonesIn(db)).toHaveLength(1)
        const [goal] = goalsIn(db)
        expect(goal.completionMilestoneDate).toBe(appNoon)
        expect(goal.progress).toBe(30)
        expect(goal.sortIndexByMilestone.m1).toBeGreaterThan(0)
    })

    test('without a date the goal goes to someday', async () => {
        const db = createFakeFirestore(baseDocs())
        const result = await createGoal({ db, projectId: P, userId: USER, args: { name: 'Later' }, createSortIndex })
        expect(result.goal.milestoneDate).toBe('someday')
        const [goal] = goalsIn(db)
        expect(goal.completionMilestoneDate).toBe(BACKLOG)
        expect(Object.keys(goal.sortIndexByMilestone)).toEqual([`BACKLOG${P}`])
        expect(milestonesIn(db)).toHaveLength(0)
    })

    test('a retried create returns the existing goal instead of a second one', async () => {
        const db = createFakeFirestore(
            baseDocs({ [`goals/${P}/items/g1`]: goalDoc({ extendedName: 'Grow MRR', name: 'grow mrr' }) })
        )
        const result = await createGoal({ db, projectId: P, userId: USER, args: { name: '  grow MRR ' } })
        expect(result).toMatchObject({ success: true, alreadyExists: true, goal: { id: 'g1' } })
        expect(goalsIn(db)).toHaveLength(1)
        expect(db.writes).toHaveLength(0)
    })

    test('a private goal is visible to its creator and assignees only', async () => {
        const db = createFakeFirestore(baseDocs())
        await createGoal({
            db,
            projectId: P,
            userId: USER,
            args: { name: 'Secret', isPrivate: true, assigneeIds: [OTHER] },
        })
        const [goal] = goalsIn(db)
        expect(goal.isPublicFor.sort()).toEqual([USER, OTHER].sort())
        expect(goal.assigneesIds).toEqual([OTHER])
    })

    test('non-members, unknown assignees and a start after the end are refused without writing', async () => {
        const db = createFakeFirestore(baseDocs())
        await expect(createGoal({ db, projectId: P, userId: 'stranger', args: { name: 'x' } })).rejects.toThrow(
            /not a member/
        )
        await expect(
            createGoal({ db, projectId: P, userId: USER, args: { name: 'x', assigneeIds: ['nobody'] } })
        ).rejects.toThrow(/not members/)
        await expect(
            createGoal({
                db,
                projectId: P,
                userId: USER,
                args: { name: 'x', milestoneDate: '2026-11-22', startDate: '2026-12-01' },
            })
        ).rejects.toThrow(/startDate must not be after/)
        await expect(
            createGoal({ db, projectId: P, userId: USER, args: { name: 'x', milestoneDate: '22.11.2026' } })
        ).rejects.toThrow(/YYYY-MM-DD/)
        expect(goalsIn(db)).toHaveLength(0)
    })

    test('a failing feed does not undo the goal', async () => {
        const db = createFakeFirestore(baseDocs())
        const result = await createGoal({
            db,
            projectId: P,
            userId: USER,
            args: { name: 'Goal' },
            feeds: {
                onGoalCreated: async () => {
                    throw new Error('feed down')
                },
            },
        })
        expect(result.success).toBe(true)
        expect(result.warnings[0]).toMatch(/feed down/)
        expect(goalsIn(db)).toHaveLength(1)
    })
})

describe('update_goal', () => {
    const seeded = (goalExtra = {}, extraDocs = {}) =>
        createFakeFirestore(
            baseDocs({
                [`goalsMilestones/${P}/milestonesItems/m1`]: openMilestone(NOON_2026_11_22),
                [`goals/${P}/items/g1`]: goalDoc(goalExtra),
                ...extraDocs,
            })
        )

    test('progress, name and description change and are reported to the feed', async () => {
        const db = seeded()
        const onGoalUpdated = jest.fn()
        const result = await updateGoal({
            db,
            projectId: P,
            userId: USER,
            args: { goalId: 'g1', progress: 60, name: 'Renamed goal', description: 'New text' },
            now: 5000,
            feeds: { onGoalUpdated },
        })
        expect(result.changes).toEqual(['name', 'description', 'progress'])
        const goal = db.docs.get(`goals/${P}/items/g1`)
        expect(goal).toMatchObject({
            progress: 60,
            extendedName: 'Renamed goal',
            name: 'renamed goal',
            description: 'New text',
            lastEditionDate: 5000,
            lastEditorId: USER,
        })
        expect(onGoalUpdated).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'g1' }),
            expect.objectContaining({
                progress: 60,
                name: { from: 'Existing goal', to: 'Renamed goal' },
                description: { from: '', to: 'New text' },
            })
        )
    })

    test('"auto" hands progress back to the done tasks, and an unchanged call writes nothing', async () => {
        const db = seeded({ progress: 40 })
        await updateGoal({ db, projectId: P, userId: USER, args: { goalId: 'g1', progress: 'auto' } })
        expect(db.docs.get(`goals/${P}/items/g1`).progress).toBe('DYNAMIC_PERCENT')

        const writesBefore = db.writes.length
        const result = await updateGoal({
            db,
            projectId: P,
            userId: USER,
            args: { goalId: 'g1', progress: 'auto', name: 'Existing goal' },
        })
        expect(result.unchanged).toBe(true)
        expect(db.writes).toHaveLength(writesBefore)
    })

    test('moving the last goal of a milestone creates the new milestone and removes the empty old one', async () => {
        const db = seeded()
        const result = await updateGoal({
            db,
            projectId: P,
            userId: USER,
            args: { goalId: 'g1', milestoneDate: '2026-12-20' },
            createSortIndex,
        })
        expect(result.changes).toEqual(['milestone date'])
        expect(result.removedEmptyMilestone).toBe('2026-11-22')
        const milestones = milestonesIn(db)
        expect(milestones).toHaveLength(1)
        expect(milestones[0].date).toBe(NOON_2026_12_20)

        const goal = db.docs.get(`goals/${P}/items/g1`)
        expect(goal.completionMilestoneDate).toBe(NOON_2026_12_20)
        expect(goal.startingMilestoneDate).toBe(NOON_2026_12_20)
        expect(goal.assigneesReminderDate).toEqual({ [USER]: NOON_2026_12_20 })
        expect(goal.sortIndexByMilestone[milestones[0].id]).toBeGreaterThan(0)
    })

    test('a milestone another goal still uses stays', async () => {
        const db = seeded({}, { [`goals/${P}/items/g2`]: goalDoc({ extendedName: 'Other goal', name: 'other goal' }) })
        const result = await updateGoal({
            db,
            projectId: P,
            userId: USER,
            args: { goalId: 'g1', milestoneDate: 'someday' },
            createSortIndex,
        })
        expect(result.removedEmptyMilestone).toBeUndefined()
        expect(milestonesIn(db).map(milestone => milestone.id)).toContain('m1')
        const goal = db.docs.get(`goals/${P}/items/g1`)
        expect(goal.completionMilestoneDate).toBe(BACKLOG)
        expect(goal.startingMilestoneDate).toBe(BACKLOG)
        expect(goal.sortIndexByMilestone[`BACKLOG${P}`]).toBeGreaterThan(0)
    })

    test('a goal is found by a unique part of its name, and several matches ask for the id', async () => {
        const db = seeded(
            {},
            { [`goals/${P}/items/g2`]: goalDoc({ extendedName: 'Existing other', name: 'existing other' }) }
        )
        const found = await updateGoal({
            db,
            projectId: P,
            userId: USER,
            args: { goalName: 'existing goal', progress: 10 },
        })
        expect(found.goal.id).toBe('g1')

        await expect(
            updateGoal({ db, projectId: P, userId: USER, args: { goalName: 'existing', progress: 10 } })
        ).rejects.toMatchObject({
            details: { matches: expect.arrayContaining([expect.objectContaining({ id: 'g2' })]) },
        })
    })

    test('a comment alone goes into the thread without touching the goal', async () => {
        const db = seeded()
        const postComment = jest.fn(async () => ({ commentId: 'c1', notifiedFollowers: 2 }))
        const result = await updateGoal({
            db,
            projectId: P,
            userId: USER,
            args: { goalId: 'g1', comment: '  Segment A answers best.  ' },
            postComment,
        })
        expect(postComment).toHaveBeenCalledWith({
            goal: expect.objectContaining({ id: 'g1' }),
            comment: 'Segment A answers best.',
        })
        expect(result).toMatchObject({ changes: ['comment'], comment: { commentId: 'c1', notifiedFollowers: 2 } })
        expect(db.writes).toHaveLength(0)
    })

    test('a comment next to other changes follows them, and its failure leaves them saved', async () => {
        const db = seeded()
        const postComment = jest.fn(async () => {
            throw new Error('thread unavailable')
        })
        const result = await updateGoal({
            db,
            projectId: P,
            userId: USER,
            args: { goalId: 'g1', progress: 70, comment: 'Raised to 70%: two pilots signed.' },
            postComment,
        })
        expect(db.docs.get(`goals/${P}/items/g1`).progress).toBe(70)
        expect(postComment).toHaveBeenCalledWith(
            expect.objectContaining({ goal: expect.objectContaining({ progress: 70 }) })
        )
        expect(result.changes).toEqual(['progress'])
        expect(result.warnings[0]).toMatch(/comment could not be added \(thread unavailable\)/)
    })

    test('an empty comment is refused before anything is written', async () => {
        const db = seeded()
        await expect(
            updateGoal({
                db,
                projectId: P,
                userId: USER,
                args: { goalId: 'g1', progress: 50, comment: '  ' },
                postComment: jest.fn(),
            })
        ).rejects.toThrow(/comment must not be empty/)
        expect(db.writes).toHaveLength(0)
    })

    test("someone else's private goal does not exist for the caller", async () => {
        const db = seeded({ isPublicFor: [OTHER] })
        await expect(
            updateGoal({ db, projectId: P, userId: USER, args: { goalId: 'g1', progress: 10 } })
        ).rejects.toThrow(/No goal with id/)
    })

    test('assignees change for a shared goal; a private goal refuses a new assignee', async () => {
        const db = seeded()
        const result = await updateGoal({
            db,
            projectId: P,
            userId: USER,
            args: { goalId: 'g1', assigneeIds: [USER, OTHER] },
        })
        expect(result.changes).toEqual(['assignees'])
        expect(db.docs.get(`goals/${P}/items/g1`)).toMatchObject({
            assigneesIds: [USER, OTHER],
            assigneesCapacity: { [USER]: 'CAPACITY_NONE', [OTHER]: 'CAPACITY_NONE' },
        })

        const privateDb = seeded({ isPublicFor: [USER] })
        await expect(
            updateGoal({ db: privateDb, projectId: P, userId: USER, args: { goalId: 'g1', assigneeIds: [OTHER] } })
        ).rejects.toThrow(/private/)
    })
})

describe('update_milestone', () => {
    const seeded = extra =>
        createFakeFirestore(
            baseDocs({
                [`goalsMilestones/${P}/milestonesItems/m1`]: openMilestone(NOON_2026_11_22),
                [`goals/${P}/items/g1`]: goalDoc(),
                ...extra,
            })
        )

    test('a milestone found by its date gets a name', async () => {
        const db = seeded()
        const result = await updateMilestone({
            db,
            projectId: P,
            userId: USER,
            args: { date: '2026-11-22', name: 'Discovery done' },
        })
        expect(result).toMatchObject({
            success: true,
            changes: ['name'],
            milestone: { id: 'm1', name: 'Discovery done' },
        })
        expect(db.docs.get(`goalsMilestones/${P}/milestonesItems/m1`).extendedName).toBe('Discovery done')
    })

    test('moving a milestone moves its goals along', async () => {
        const db = seeded()
        const result = await updateMilestone({
            db,
            projectId: P,
            userId: USER,
            args: { milestoneId: 'm1', newDate: '2026-12-20' },
            createSortIndex,
        })
        expect(result).toMatchObject({ changes: ['date'], movedGoals: 1, milestone: { date: '2026-12-20' } })
        expect(db.docs.get(`goalsMilestones/${P}/milestonesItems/m1`).date).toBe(NOON_2026_12_20)
        expect(db.docs.get(`goals/${P}/items/g1`)).toMatchObject({
            completionMilestoneDate: NOON_2026_12_20,
            startingMilestoneDate: NOON_2026_12_20,
            assigneesReminderDate: { [USER]: NOON_2026_12_20 },
        })
    })

    test('moving onto a day that already has a milestone merges the two', async () => {
        const db = seeded({ [`goalsMilestones/${P}/milestonesItems/m2`]: openMilestone(NOON_2026_12_20) })
        const result = await updateMilestone({
            db,
            projectId: P,
            userId: USER,
            args: { milestoneId: 'm1', newDate: '2026-12-20' },
            createSortIndex,
        })
        expect(result.mergedIntoMilestoneId).toBe('m2')
        expect(db.docs.has(`goalsMilestones/${P}/milestonesItems/m1`)).toBe(false)
        const goal = db.docs.get(`goals/${P}/items/g1`)
        expect(goal.completionMilestoneDate).toBe(NOON_2026_12_20)
        expect(goal.sortIndexByMilestone.m2).toBeGreaterThan(0)
    })

    test('done goes through the milestone transition, and a done milestone is not moved', async () => {
        const db = seeded()
        const setMilestoneDone = jest.fn(async () => ({ success: true, updatedGoalCount: 1 }))
        const result = await updateMilestone({
            db,
            projectId: P,
            userId: USER,
            args: { date: '2026-11-22', done: true },
            setMilestoneDone,
        })
        expect(setMilestoneDone).toHaveBeenCalledWith({ projectId: P, milestoneId: 'm1', targetDone: true })
        expect(result).toMatchObject({ changes: ['marked done'], updatedGoalCount: 1 })

        const doneDb = seeded({
            [`goalsMilestones/${P}/milestonesItems/m1`]: openMilestone(NOON_2026_11_22, { done: true }),
        })
        await expect(
            updateMilestone({
                db: doneDb,
                projectId: P,
                userId: USER,
                args: { milestoneId: 'm1', newDate: '2026-12-20' },
            })
        ).rejects.toThrow(/done milestone cannot be moved/)
    })

    test('an automatic milestone keeps its date, and an unknown day lists the open milestones', async () => {
        const db = seeded({
            [`goalsMilestones/${P}/milestonesItems/m1`]: openMilestone(NOON_2026_11_22, { milestoneType: 'linear' }),
        })
        await expect(
            updateMilestone({ db, projectId: P, userId: USER, args: { milestoneId: 'm1', newDate: '2026-12-20' } })
        ).rejects.toThrow(/automatic milestones/)

        await expect(
            updateMilestone({ db, projectId: P, userId: USER, args: { date: '2026-12-01', name: 'x' } })
        ).rejects.toMatchObject({ details: { openMilestones: [expect.objectContaining({ id: 'm1' })] } })
    })
})
