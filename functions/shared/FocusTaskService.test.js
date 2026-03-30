jest.mock('./ProjectService', () => ({
    ProjectService: jest.fn().mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(),
        getUserProjects: jest.fn().mockResolvedValue([]),
    })),
}))

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    generateSortIndex: jest.fn(() => 123456789),
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

    test('falls back to other projects when current project has no general or goal tasks due today', async () => {
        const service = createService({
            docs: {
                [`projects/${otherProjectId}`]: {
                    id: otherProjectId,
                    sortIndexByUser: { [userId]: 10 },
                },
            },
            collections: {
                [`items/${currentProjectId}/tasks`]: [],
                [`items/${otherProjectId}/tasks`]: [{ id: 'other-general', ...baseTask, sortIndex: 250 }],
            },
        })

        const result = await service.findAndSetNewFocusTask(userId, currentProjectId, null, null, null, null)

        expect(result.id).toBe('other-general')
        expect(service.setNewFocusTask).toHaveBeenCalledWith(
            userId,
            otherProjectId,
            expect.objectContaining({ id: 'other-general' })
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
                    sortIndexByMilestone: { milestoneA: 100 },
                },
                [`goals/${currentProjectId}/items/goal-b`]: {
                    id: 'goal-b',
                    sortIndexByMilestone: { milestoneA: 50 },
                },
            },
            collections: {
                [`items/${currentProjectId}/tasks`]: [
                    { id: 'general-1', ...baseTask, sortIndex: 500 },
                    { id: 'goal-top', ...baseTask, parentGoalId: 'goal-a', sortIndex: 300 },
                    { id: 'goal-lower', ...baseTask, parentGoalId: 'goal-b', sortIndex: 200 },
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
})
