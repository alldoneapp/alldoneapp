jest.mock('./ProjectService', () => ({
    ProjectService: jest.fn().mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(),
        getUserProjects: jest.fn().mockResolvedValue([]),
    })),
}))

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    generateSortIndex: jest.fn(() => 123456789),
    FEED_PUBLIC_FOR_ALL: 0,
    BACKLOG_DATE_NUMERIC: Number.MAX_SAFE_INTEGER,
    DYNAMIC_PERCENT: 'DYNAMIC_PERCENT',
    BACKLOG_MILESTONE_ID: 'BACKLOG',
    DEFAULT_WORKSTREAM_ID: 'default-workstream',
    CAPACITY_NONE: 0,
    CURRENT_DAY_VERSION_ID: 'current-day',
    RECURRENCE_NEVER: 'never',
    OPEN_STEP: 'open',
    ESTIMATION_0_MIN: 0,
    ALL_USERS: 'ALL_USERS',
    TASK_ASSIGNEE_USER_TYPE: 'USER',
    PROJECT_COLOR_DEFAULT: '#000000',
    ESTIMATION_TYPE_TIME: 'time',
    PROJECT_PUBLIC: 'public',
    generateNegativeSortIndex: jest.fn(() => -1),
    getTaskNameWithoutMeta: jest.fn(value => value),
}))

const moment = require('moment')
const { FocusTaskService } = require('./FocusTaskService')
const { ProjectService } = require('./ProjectService')

const buildDocSnapshot = data => ({
    exists: data !== undefined,
    id: data?.id,
    data: () => data,
})

const buildQuerySnapshot = items => ({
    empty: items.length === 0,
    docs: items.map(item => ({
        id: item.id,
        data: () => {
            const { id, ...rest } = item
            return rest
        },
    })),
})

const createMockDatabase = ({ docs = {}, collections = {} }) => {
    const buildQuery = path => {
        const state = {
            filters: [],
            sortField: null,
            sortDirection: 'asc',
            limitValue: null,
        }

        const query = {
            where(field, operator, value) {
                state.filters.push({ field, operator, value })
                return query
            },
            orderBy(field, direction = 'asc') {
                state.sortField = field
                state.sortDirection = direction
                return query
            },
            limit(value) {
                state.limitValue = value
                return query
            },
            async get() {
                let items = [...(collections[path] || [])]

                for (const filter of state.filters) {
                    items = items.filter(item => {
                        const fieldValue = item[filter.field]
                        switch (filter.operator) {
                            case '==':
                                return fieldValue === filter.value
                            case 'array-contains-any':
                                return (
                                    Array.isArray(fieldValue) &&
                                    Array.isArray(filter.value) &&
                                    fieldValue.some(value => filter.value.includes(value))
                                )
                            case '>=':
                                return fieldValue >= filter.value
                            case '<':
                                return fieldValue < filter.value
                            default:
                                throw new Error(`Unsupported operator: ${filter.operator}`)
                        }
                    })
                }

                if (state.sortField) {
                    items.sort((a, b) => {
                        const aValue = a[state.sortField] || 0
                        const bValue = b[state.sortField] || 0
                        return state.sortDirection === 'desc' ? bValue - aValue : aValue - bValue
                    })
                }

                if (typeof state.limitValue === 'number') {
                    items = items.slice(0, state.limitValue)
                }

                return buildQuerySnapshot(items)
            },
            doc(id) {
                return {
                    async get() {
                        return buildDocSnapshot(docs[`${path}/${id}`])
                    },
                }
            },
        }

        return query
    }

    return {
        collection(path) {
            return buildQuery(path)
        },
        doc(path) {
            return {
                async get() {
                    return buildDocSnapshot(docs[path])
                },
            }
        },
    }
}

describe('FocusTaskService general task priority', () => {
    const userId = 'user-1'
    const currentProjectId = 'project-1'
    const otherProjectId = 'project-2'
    const now = moment()
    const dueToday = now.clone().subtract(1, 'hour').valueOf()
    const dueTomorrow = now.clone().add(1, 'day').endOf('day').valueOf()

    const baseTask = {
        userId,
        done: false,
        inDone: false,
        isSubtask: false,
        userIds: [userId],
        dueDate: dueToday,
        sortIndex: 100,
    }

    beforeEach(() => {
        jest.clearAllMocks()
        ProjectService.mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(),
            getUserProjects: jest.fn().mockResolvedValue([{ id: currentProjectId }, { id: otherProjectId }]),
        }))
    })

    const createService = ({ docs = {}, collections = {} }) => {
        const service = new FocusTaskService({
            database: createMockDatabase({
                docs: {
                    [`users/${userId}`]: {
                        id: userId,
                        defaultProjectId: currentProjectId,
                    },
                    ...docs,
                },
                collections,
            }),
            moment,
        })
        service.setNewFocusTask = jest.fn().mockResolvedValue()
        return service
    }

    test('keeps focus in same-project general tasks when previous focus was general', async () => {
        const service = createService({
            collections: {
                [`items/${currentProjectId}/tasks`]: [
                    { id: 'general-1', ...baseTask, sortIndex: 300 },
                    { id: 'goal-1', ...baseTask, parentGoalId: 'goal-a', sortIndex: 200 },
                ],
            },
        })

        const result = await service.findAndSetNewFocusTask(userId, currentProjectId, null, null, null, null)

        expect(result.id).toBe('general-1')
        expect(service.setNewFocusTask).toHaveBeenCalledWith(
            userId,
            currentProjectId,
            expect.objectContaining({ id: 'general-1' })
        )
    })

    test('moves to a goal task when no general tasks remain in the project', async () => {
        const service = createService({
            collections: {
                [`items/${currentProjectId}/tasks`]: [
                    { id: 'goal-1', ...baseTask, parentGoalId: 'goal-a', sortIndex: 300 },
                    { id: 'future-general', ...baseTask, dueDate: dueTomorrow, sortIndex: 500 },
                ],
            },
        })

        const result = await service.findAndSetNewFocusTask(userId, currentProjectId, null, null, null, null)

        expect(result.id).toBe('goal-1')
        expect(service.setNewFocusTask).toHaveBeenCalledWith(
            userId,
            currentProjectId,
            expect.objectContaining({ id: 'goal-1' })
        )
    })

    test('keeps existing goal-focused behavior when previous focus task belonged to a goal', async () => {
        const service = createService({
            collections: {
                [`items/${currentProjectId}/tasks`]: [
                    { id: 'same-goal', ...baseTask, parentGoalId: 'goal-a', sortIndex: 300 },
                    { id: 'general-1', ...baseTask, sortIndex: 400 },
                    { id: 'other-goal', ...baseTask, parentGoalId: 'goal-b', sortIndex: 200 },
                ],
            },
        })

        const result = await service.findAndSetNewFocusTask(userId, currentProjectId, 'goal-a', null, null, null)

        expect(result.id).toBe('same-goal')
        expect(service.setNewFocusTask).toHaveBeenCalledWith(
            userId,
            currentProjectId,
            expect.objectContaining({ id: 'same-goal' })
        )
    })

    test('prefers single-assignee general tasks, but still stays in general with only workflow tasks left', async () => {
        const service = createService({
            collections: {
                [`items/${currentProjectId}/tasks`]: [
                    { id: 'general-single', ...baseTask, sortIndex: 400 },
                    { id: 'general-workflow', ...baseTask, userIds: [userId, 'user-2'], sortIndex: 350 },
                    { id: 'goal-1', ...baseTask, parentGoalId: 'goal-a', sortIndex: 300 },
                ],
            },
        })

        let result = await service.findAndSetNewFocusTask(userId, currentProjectId, null, null, null, null)
        expect(result.id).toBe('general-single')

        const workflowOnlyService = createService({
            collections: {
                [`items/${currentProjectId}/tasks`]: [
                    { id: 'general-workflow', ...baseTask, userIds: [userId, 'user-2'], sortIndex: 350 },
                    { id: 'goal-1', ...baseTask, parentGoalId: 'goal-a', sortIndex: 300 },
                ],
            },
        })

        result = await workflowOnlyService.findAndSetNewFocusTask(userId, currentProjectId, null, null, null, null)
        expect(result.id).toBe('general-workflow')
    })

    test('falls back to other projects and prefers goal tasks there over general tasks', async () => {
        const service = createService({
            docs: {
                [`projects/${otherProjectId}`]: {
                    id: otherProjectId,
                    sortIndexByUser: { [userId]: 10 },
                },
                [`goals/${otherProjectId}/items/goal-b`]: {
                    id: 'goal-b',
                    ownerId: 'ALL_USERS',
                    isPublicFor: [0, userId],
                    sortIndexByMilestone: {},
                },
            },
            collections: {
                [`items/${currentProjectId}/tasks`]: [],
                [`items/${otherProjectId}/tasks`]: [
                    { id: 'other-general', ...baseTask, sortIndex: 250 },
                    { id: 'other-goal', ...baseTask, parentGoalId: 'goal-b', sortIndex: 200 },
                ],
                [`goals/${otherProjectId}/items`]: [
                    {
                        id: 'goal-b',
                        ownerId: 'ALL_USERS',
                        isPublicFor: [0, userId],
                        sortIndexByMilestone: {},
                    },
                ],
            },
        })

        const result = await service.findAndSetNewFocusTask(userId, currentProjectId, null, null, null, null)

        expect(result.id).toBe('other-goal')
        expect(service.setNewFocusTask).toHaveBeenCalledWith(
            userId,
            otherProjectId,
            expect.objectContaining({ id: 'other-goal' })
        )
    })

    test('starting in a new project still prefers the highest goal task over general tasks', async () => {
        const service = createService({
            docs: {
                [`projects/${currentProjectId}`]: {
                    id: currentProjectId,
                    sortIndexByUser: { [userId]: 10 },
                },
                [`goals/${currentProjectId}/items/goal-a`]: {
                    id: 'goal-a',
                    ownerId: 'ALL_USERS',
                    isPublicFor: [0, userId],
                    sortIndexByMilestone: { milestoneA: 100 },
                },
                [`goals/${currentProjectId}/items/goal-b`]: {
                    id: 'goal-b',
                    ownerId: 'ALL_USERS',
                    isPublicFor: [0, userId],
                    sortIndexByMilestone: { milestoneA: 50 },
                },
            },
            collections: {
                [`items/${currentProjectId}/tasks`]: [
                    { id: 'general-1', ...baseTask, sortIndex: 500 },
                    { id: 'goal-top', ...baseTask, parentGoalId: 'goal-a', sortIndex: 300 },
                    { id: 'goal-lower', ...baseTask, parentGoalId: 'goal-b', sortIndex: 200 },
                ],
                [`goals/${currentProjectId}/items`]: [
                    {
                        id: 'goal-a',
                        ownerId: 'ALL_USERS',
                        isPublicFor: [0, userId],
                        sortIndexByMilestone: { milestoneA: 100 },
                    },
                    {
                        id: 'goal-b',
                        ownerId: 'ALL_USERS',
                        isPublicFor: [0, userId],
                        sortIndexByMilestone: { milestoneA: 50 },
                    },
                ],
                [`goalsMilestones/${currentProjectId}/milestonesItems`]: [
                    {
                        id: 'milestoneA',
                        ownerId: 'ALL_USERS',
                        date: dueToday,
                        done: false,
                    },
                ],
            },
        })

        const result = await service.findAndSetNewFocusTask(userId, null, null, null, null, 'milestoneA')

        expect(result.id).toBe('goal-top')
        expect(service.setNewFocusTask).toHaveBeenCalledWith(
            userId,
            currentProjectId,
            expect.objectContaining({ id: 'goal-top' })
        )
    })

    test('prefers a higher-priority task over a lower-priority one with a higher sortIndex', async () => {
        const service = createService({
            collections: {
                [`items/${currentProjectId}/tasks`]: [
                    { id: 'no-priority', ...baseTask, priority: 'none', sortIndex: 900 },
                    { id: 'should-do', ...baseTask, priority: 'should_do', sortIndex: 500 },
                    { id: 'must-do', ...baseTask, priority: 'must_do', sortIndex: 100 },
                ],
            },
        })

        const result = await service.findAndSetNewFocusTask(userId, currentProjectId, null, null, null, null)

        expect(result.id).toBe('must-do')
    })

    test('never crosses a priority tier when re-selecting focus after excluding a task', async () => {
        const service = createService({
            collections: {
                [`items/${currentProjectId}/tasks`]: [
                    { id: 'excluded', ...baseTask, priority: 'must_do', sortIndex: 999 },
                    { id: 'must-a', ...baseTask, priority: 'must_do', sortIndex: 300 },
                    { id: 'must-b', ...baseTask, priority: 'must_do', sortIndex: 200 },
                    { id: 'should-high', ...baseTask, priority: 'should_do', sortIndex: 900 },
                ],
            },
        })

        const result = await service.findAndSetNewFocusTask(userId, currentProjectId, null, 'excluded', null, null)

        // Must stay within the top (must_do) tier, never fall through to should_do.
        expect(['must-a', 'must-b']).toContain(result.id)
    })

    test('explicitly switching to a different project does not keep general-task priority from the previous project', async () => {
        const service = createService({
            docs: {
                [`users/${userId}`]: {
                    id: userId,
                    defaultProjectId: otherProjectId,
                    inFocusTaskId: 'previous-general',
                    inFocusTaskProjectId: otherProjectId,
                },
                [`projects/${currentProjectId}`]: {
                    id: currentProjectId,
                    sortIndexByUser: { [userId]: 10 },
                },
                [`goals/${currentProjectId}/items/goal-a`]: {
                    id: 'goal-a',
                    ownerId: 'ALL_USERS',
                    isPublicFor: [0, userId],
                    sortIndexByMilestone: { milestoneA: 100 },
                },
            },
            collections: {
                [`items/${currentProjectId}/tasks`]: [
                    { id: 'general-1', ...baseTask, sortIndex: 500 },
                    { id: 'goal-top', ...baseTask, parentGoalId: 'goal-a', sortIndex: 300 },
                ],
                [`goals/${currentProjectId}/items`]: [
                    {
                        id: 'goal-a',
                        ownerId: 'ALL_USERS',
                        isPublicFor: [0, userId],
                        sortIndexByMilestone: { milestoneA: 100 },
                    },
                ],
                [`goalsMilestones/${currentProjectId}/milestonesItems`]: [
                    {
                        id: 'milestoneA',
                        ownerId: 'ALL_USERS',
                        date: dueToday,
                        done: false,
                    },
                ],
            },
        })

        const result = await service.findAndSetNewFocusTask(userId, currentProjectId, null, null, null, null)

        expect(result.id).toBe('goal-top')
        expect(service.setNewFocusTask).toHaveBeenCalledWith(
            userId,
            currentProjectId,
            expect.objectContaining({ id: 'goal-top' })
        )
    })
})

/**
 * AT-2193 (follow-up) — the picker must never hand back a task that has already moved on.
 *
 * The first round of this ticket only released focus when a task changed workflow step. Production
 * on 2026-08-07 14:36:07 showed that was half the fix: the release fired correctly and then
 * immediately selected a REPLACEMENT that was itself parked in the AI assistant's step. Both
 * pickers query on `userId` (ownership), which still matches a task the user has handed on, so the
 * user simply got another workflow-parked task as their focus task — exactly the reported symptom.
 */
describe('FocusTaskService workflow-step eligibility (AT-2193)', () => {
    const userId = 'user-1'
    const currentProjectId = 'project-1'
    const otherProjectId = 'project-2'
    const assistantId = 'assistant-1'
    const now = moment()
    const dueToday = now.clone().subtract(1, 'hour').valueOf()

    const baseTask = {
        userId,
        done: false,
        inDone: false,
        isSubtask: false,
        userIds: [userId],
        currentReviewerId: userId,
        dueDate: dueToday,
        sortIndex: 100,
    }

    // The task the user owns but has already handed to the next step's reviewer.
    const parkedTask = overrides => ({
        ...baseTask,
        userIds: [userId, assistantId],
        currentReviewerId: assistantId,
        stepHistory: [-1, 'step-1'],
        ...overrides,
    })

    beforeEach(() => {
        jest.clearAllMocks()
        ProjectService.mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(),
            getUserProjects: jest.fn().mockResolvedValue([{ id: currentProjectId }, { id: otherProjectId }]),
        }))
    })

    const createService = ({ docs = {}, collections = {} }) => {
        const service = new FocusTaskService({
            database: createMockDatabase({
                docs: {
                    [`users/${userId}`]: { id: userId, defaultProjectId: currentProjectId },
                    ...docs,
                },
                collections,
            }),
            moment,
        })
        service.setNewFocusTask = jest.fn().mockResolvedValue()
        return service
    }

    test('never selects a task parked in another reviewer step, even as the only candidate', async () => {
        const service = createService({
            collections: {
                [`items/${currentProjectId}/tasks`]: [parkedTask({ id: 'parked-1', sortIndex: 400 })],
            },
        })

        const result = await service.findAndSetNewFocusTask(userId, currentProjectId, null, null, null, null)

        expect(result).toBeNull()
        expect(service.setNewFocusTask).not.toHaveBeenCalled()
    })

    test('skips the parked task and selects the one still on the user plate', async () => {
        // The parked task sorts higher, so before the fix it won.
        const service = createService({
            collections: {
                [`items/${currentProjectId}/tasks`]: [
                    parkedTask({ id: 'parked-1', sortIndex: 900 }),
                    { ...baseTask, id: 'mine-1', sortIndex: 100 },
                ],
            },
        })

        const result = await service.findAndSetNewFocusTask(userId, currentProjectId, null, null, null, null)

        expect(result.id).toBe('mine-1')
    })

    test('applies the same rule when falling back to other projects', async () => {
        const service = createService({
            docs: {
                [`projects/${otherProjectId}`]: { id: otherProjectId, sortIndexByUser: { [userId]: 10 } },
            },
            collections: {
                [`items/${currentProjectId}/tasks`]: [],
                [`items/${otherProjectId}/tasks`]: [
                    parkedTask({ id: 'parked-other', sortIndex: 900 }),
                    { ...baseTask, id: 'mine-other', sortIndex: 100 },
                ],
            },
        })

        const result = await service.findAndSetNewFocusTask(userId, currentProjectId, null, null, null, null)

        expect(result.id).toBe('mine-other')
    })

    test('does not select a parked calendar task in the upcoming-calendar phase', async () => {
        const soon = now.clone().add(5, 'minutes')
        const calendarShape = {
            dueDate: dueToday,
            sortIndex: soon.valueOf(),
            calendarData: { start: { dateTime: soon.toISOString() } },
        }

        const service = createService({
            collections: {
                [`items/${currentProjectId}/tasks`]: [parkedTask({ id: 'parked-cal', ...calendarShape })],
                [`items/${otherProjectId}/tasks`]: [],
            },
        })

        const result = await service.findAndSetNewFocusTask(userId, currentProjectId, null, null, null, null)

        expect(service.setNewFocusTask).not.toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.objectContaining({ id: 'parked-cal' })
        )
        expect(result).toBeNull()
    })

    // Tasks written before currentReviewerId existed must stay selectable or the picker starves.
    test('still selects a legacy task that records no current reviewer', async () => {
        const { currentReviewerId, ...legacyBase } = baseTask
        const service = createService({
            collections: {
                [`items/${currentProjectId}/tasks`]: [{ ...legacyBase, id: 'legacy-1', sortIndex: 400 }],
            },
        })

        const result = await service.findAndSetNewFocusTask(userId, currentProjectId, null, null, null, null)

        expect(result.id).toBe('legacy-1')
    })
})

describe('FocusTaskService.getCurrentFocusTask workflow-step eligibility (AT-2193)', () => {
    const userId = 'user-1'
    const projectId = 'project-1'
    const assistantId = 'assistant-1'

    // The mock database only implements `get`; getCurrentFocusTask also writes, so record updates.
    const createTrackingService = (docs, updates) => {
        const db = createMockDatabase({ docs, collections: {} })
        const originalDoc = db.doc.bind(db)
        db.doc = path => ({
            ...originalDoc(path),
            update: async data => {
                updates.push({ path, data })
            },
        })
        return new FocusTaskService({ database: db, moment })
    }

    // Self-healing: focus state set before this rule existed (or by any path that bypasses the
    // trigger) is dropped the next time the focus task is read, rather than lingering forever.
    test('clears a focus task that has been handed on to another reviewer', async () => {
        const updates = []
        const service = createTrackingService(
            {
                [`users/${userId}`]: { id: userId, inFocusTaskId: 'task-1', inFocusTaskProjectId: projectId },
                [`items/${projectId}/tasks/task-1`]: {
                    id: 'task-1',
                    userId,
                    done: false,
                    inDone: false,
                    currentReviewerId: assistantId,
                    stepHistory: [-1, 'step-1'],
                },
            },
            updates
        )

        const result = await service.getCurrentFocusTask(userId)

        expect(result).toBeNull()
        expect(updates).toContainEqual({
            path: `users/${userId}`,
            data: { inFocusTaskId: '', inFocusTaskProjectId: '' },
        })
    })

    test('keeps a focus task that is still the user to act on', async () => {
        const db = createMockDatabase({
            docs: {
                [`users/${userId}`]: { id: userId, inFocusTaskId: 'task-1', inFocusTaskProjectId: projectId },
                [`items/${projectId}/tasks/task-1`]: {
                    id: 'task-1',
                    userId,
                    done: false,
                    inDone: false,
                    currentReviewerId: userId,
                    stepHistory: [-1],
                },
                [`projects/${projectId}`]: { id: projectId, name: 'Project One' },
            },
            collections: {},
        })

        const service = new FocusTaskService({ database: db, moment })
        const result = await service.getCurrentFocusTask(userId)

        expect(result).not.toBeNull()
        expect(result.id).toBe('task-1')
    })
})
