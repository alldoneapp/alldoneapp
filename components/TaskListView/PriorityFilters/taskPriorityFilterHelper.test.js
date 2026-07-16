/**
 * @jest-environment jsdom
 */

const mockGetState = jest.fn()

jest.mock('../../../redux/store', () => ({
    getState: () => mockGetState(),
}))

// The real openTasks.js imports this helper back (circular), so its constants
// are undefined while the helper's module body runs and only exist later. The
// mock stays EMPTY until beforeAll to emulate that — a regression to eager,
// module-scope capture of the constants makes every test here fail.
jest.mock('../../../utils/backends/openTasks', () => ({}))

beforeAll(() => {
    Object.assign(require('../../../utils/backends/openTasks'), {
        TODAY_DATE: '0',
        DATE_TASK_INDEX: 0,
        AMOUNT_TASKS_INDEX: 1,
        ESTIMATION_TASKS_INDEX: 2,
        MAIN_TASK_INDEX: 3,
        MENTION_TASK_INDEX: 4,
        SUGGESTED_TASK_INDEX: 5,
        WORKFLOW_TASK_INDEX: 6,
        OBSERVED_TASKS_INDEX: 7,
        STREAM_AND_USER_TASKS_INDEX: 8,
        ACTIVE_GOALS_INDEX: 9,
        CALENDAR_TASK_INDEX: 10,
        EMAIL_TASK_INDEX: 11,
        EMPTY_SECTION_INDEX: 12,
    })
})

jest.mock('../../../utils/EstimationHelper', () => ({
    ESTIMATION_0_MIN: 0,
    getEstimationRealValue: (projectId, estimation) => estimation,
}))

jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    checkIfSelectedProject: projectIndex => projectIndex >= 0,
}))

import {
    collectTaskPriorityCounts,
    collectTaskVmSessionRefs,
    collectTaskVmStateCounts,
    filterOpenTasksSectionsByPriority,
    filterOpenTasksSectionsByVmState,
} from './taskPriorityFilterHelper'

const OPEN_STEP = -1

const makeTask = (id, priority, estimation = 0) => ({
    id,
    priority,
    projectId: 'project-1',
    stepHistory: [OPEN_STEP],
    estimations: { [OPEN_STEP]: estimation },
})

const makeSection = (date, { mainTasks = [], observedTasks = [], emptyGoals = [], activeGoals = [] } = {}) => {
    const section = []
    section[0] = date // DATE_TASK_INDEX
    section[1] = 0 // AMOUNT_TASKS_INDEX
    section[2] = 0 // ESTIMATION_TASKS_INDEX
    section[3] = mainTasks // MAIN_TASK_INDEX
    section[4] = [] // MENTION_TASK_INDEX
    section[5] = [] // SUGGESTED_TASK_INDEX
    section[6] = [] // WORKFLOW_TASK_INDEX
    section[7] = observedTasks // OBSERVED_TASKS_INDEX
    section[8] = [] // STREAM_AND_USER_TASKS_INDEX
    section[9] = activeGoals // ACTIVE_GOALS_INDEX
    section[10] = [] // CALENDAR_TASK_INDEX
    section[11] = [] // EMAIL_TASK_INDEX
    section[12] = emptyGoals // EMPTY_SECTION_INDEX
    return section
}

describe('filterOpenTasksSectionsByPriority', () => {
    beforeEach(() => {
        mockGetState.mockReturnValue({ currentUser: { uid: 'user-1' }, selectedProjectIndex: 0 })
    })

    test('returns the input untouched when no priorities are selected', () => {
        const sections = [makeSection('0', { mainTasks: [['goal-1', [makeTask('a', 'must_do')]]] })]
        expect(filterOpenTasksSectionsByPriority(sections, [])).toBe(sections)
    })

    test('keeps only matching tasks and recalculates amount and estimation', () => {
        const sections = [
            makeSection('0', {
                mainTasks: [['goal-1', [makeTask('a', 'must_do', 30), makeTask('b', 'do_later', 60)]]],
            }),
        ]
        sections[0][1] = 2
        sections[0][2] = 90

        const filtered = filterOpenTasksSectionsByPriority(sections, ['must_do'])
        expect(filtered).toHaveLength(1)
        expect(filtered[0][3]).toEqual([['goal-1', [expect.objectContaining({ id: 'a' })]]])
        expect(filtered[0][1]).toBe(1)
        expect(filtered[0][2]).toBe(30)
    })

    test('tasks without priority match the "none" filter', () => {
        const sections = [makeSection('0', { mainTasks: [['goal-1', [makeTask('a', undefined)]]] })]
        const filtered = filterOpenTasksSectionsByPriority(sections, ['none'])
        expect(filtered[0][1]).toBe(1)
    })

    test('drops emptied dates but keeps today in the selected-project view', () => {
        const sections = [
            makeSection('0', { mainTasks: [['goal-1', [makeTask('a', 'do_later')]]] }),
            makeSection('20260707', { mainTasks: [['goal-2', [makeTask('b', 'do_later')]]] }),
            makeSection('20260708', {
                mainTasks: [['goal-3', [makeTask('c', 'do_later')]]],
                emptyGoals: [{ id: 'goal-4' }],
            }),
        ]

        const filtered = filterOpenTasksSectionsByPriority(sections, ['must_do'])
        expect(filtered.map(section => section[0])).toEqual(['0', '20260708'])
        expect(filtered[0][1]).toBe(0)
    })

    test('drops an emptied today section in the all-projects view', () => {
        mockGetState.mockReturnValue({ currentUser: { uid: 'user-1' }, selectedProjectIndex: -1 })
        const sections = [makeSection('0', { mainTasks: [['goal-1', [makeTask('a', 'do_later')]]] })]
        expect(filterOpenTasksSectionsByPriority(sections, ['must_do'])).toEqual([])
    })

    test('keeps a parent without priority when one of its subtasks matches', () => {
        const sections = [
            makeSection('0', {
                mainTasks: [['goal-1', [makeTask('parent-1', undefined, 15), makeTask('parent-2', undefined)]]],
            }),
        ]
        const subtasksByParentId = {
            'parent-1': [makeTask('sub-1', 'must_do')],
        }

        const filtered = filterOpenTasksSectionsByPriority(sections, ['must_do'], subtasksByParentId)
        expect(filtered[0][3]).toEqual([['goal-1', [expect.objectContaining({ id: 'parent-1' })]]])
        expect(filtered[0][1]).toBe(1)
    })

    test('filters observed tasks and uses the observer estimation', () => {
        const observedTask = {
            id: 'obs',
            priority: 'must_do',
            projectId: 'project-1',
            estimationsByObserverIds: { 'user-1': 45 },
        }
        const sections = [makeSection('0', { observedTasks: [['user-2', [['goal-1', [observedTask]]]]] })]

        const filtered = filterOpenTasksSectionsByPriority(sections, ['must_do'])
        expect(filtered[0][7]).toEqual([['user-2', [['goal-1', [expect.objectContaining({ id: 'obs' })]]]]])
        expect(filtered[0][1]).toBe(1)
        expect(filtered[0][2]).toBe(45)
    })
})

describe('collectTaskPriorityCounts', () => {
    test('aggregates counts across instances and reports prioritized total', () => {
        const instanceA = {
            sections: [
                makeSection('0', {
                    mainTasks: [['goal-1', [makeTask('a', 'must_do'), makeTask('b', undefined)]]],
                }),
            ],
        }
        const instanceB = {
            sections: [
                makeSection('0', {
                    observedTasks: [['user-2', [['goal-1', [makeTask('c', 'must_do'), makeTask('d', 'do_later')]]]]],
                }),
            ],
        }

        const { counts, total, prioritized } = collectTaskPriorityCounts([instanceA, instanceB, undefined])
        expect(counts).toEqual({ must_do: 2, do_later: 1, none: 1 })
        expect(total).toBe(4)
        expect(prioritized).toBe(3)
    })

    test('counts subtasks of listed parents by their own priority', () => {
        const instance = {
            sections: [
                makeSection('0', {
                    mainTasks: [['goal-1', [makeTask('parent-1', undefined)]]],
                }),
            ],
            subtasksByParentId: {
                'parent-1': [makeTask('sub-1', 'must_do'), makeTask('sub-2', undefined)],
                'not-listed-parent': [makeTask('sub-3', 'should_do')],
            },
        }

        const { counts, total, prioritized } = collectTaskPriorityCounts([instance])
        expect(counts).toEqual({ must_do: 1, none: 2 })
        expect(total).toBe(3)
        expect(prioritized).toBe(1)
    })
})

describe('VM state task list filters', () => {
    beforeEach(() => {
        mockGetState.mockReturnValue({ currentUser: { uid: 'user-1' }, selectedProjectIndex: 0 })
    })

    test('keeps only tasks matching any selected VM state and recalculates totals', () => {
        const sections = [
            makeSection('0', {
                mainTasks: [['goal-1', [makeTask('a', 'must_do', 30), makeTask('b', 'must_do', 60), makeTask('c')]]],
            }),
        ]
        const vmStatesByTask = {
            'project-1__a': 'in_progress',
            'project-1__b': 'failed',
        }

        const filtered = filterOpenTasksSectionsByVmState(sections, ['in_progress', 'paused'], vmStatesByTask)
        expect(filtered[0][3]).toEqual([['goal-1', [expect.objectContaining({ id: 'a' })]]])
        expect(filtered[0][1]).toBe(1)
        expect(filtered[0][2]).toBe(30)
    })

    test('returns the input untouched when no VM state is selected', () => {
        const sections = [makeSection('0', { mainTasks: [['goal-1', [makeTask('a')]]] })]
        expect(filterOpenTasksSectionsByVmState(sections, [], {})).toBe(sections)
    })

    test('keeps a parent when one of its subtasks has the selected VM state', () => {
        const sections = [
            makeSection('0', {
                mainTasks: [['goal-1', [makeTask('parent-1'), makeTask('parent-2')]]],
            }),
        ]
        const subtasksByParentId = {
            'parent-1': [makeTask('sub-1')],
        }
        const filtered = filterOpenTasksSectionsByVmState(
            sections,
            ['paused'],
            { 'project-1__sub-1': 'paused' },
            subtasksByParentId
        )

        expect(filtered[0][3]).toEqual([['goal-1', [expect.objectContaining({ id: 'parent-1' })]]])
        expect(filtered[0][1]).toBe(1)
    })

    test('composes with the priority filter as an intersection', () => {
        const sections = [
            makeSection('0', {
                mainTasks: [
                    ['goal-1', [makeTask('a', 'must_do'), makeTask('b', 'must_do'), makeTask('c', 'do_later')]],
                ],
            }),
        ]
        const prioritized = filterOpenTasksSectionsByPriority(sections, ['must_do'])
        const filtered = filterOpenTasksSectionsByVmState(prioritized, ['failed'], {
            'project-1__a': 'in_progress',
            'project-1__b': 'failed',
            'project-1__c': 'failed',
        })

        expect(filtered[0][3]).toEqual([['goal-1', [expect.objectContaining({ id: 'b' })]]])
    })

    test('counts supported states while keeping all tasks in the All total', () => {
        const instance = {
            sections: [makeSection('0', { mainTasks: [['goal-1', [makeTask('a'), makeTask('b')]]] })],
            subtasksByParentId: { a: [makeTask('sub-1')] },
        }
        const result = collectTaskVmStateCounts([instance], {
            'project-1__a': 'in_progress',
            'project-1__sub-1': 'failed',
        })

        expect(result).toEqual({ counts: { in_progress: 1, failed: 1 }, total: 3, available: 2 })
    })

    test('collects unique session references for listed tasks and subtasks', () => {
        const repeatedTask = makeTask('a')
        const instance = {
            sections: [
                makeSection('0', { mainTasks: [['goal-1', [repeatedTask]]] }),
                makeSection('later', { mainTasks: [['goal-1', [repeatedTask]]] }),
            ],
            subtasksByParentId: { a: [makeTask('sub-1')] },
        }

        expect(collectTaskVmSessionRefs([instance])).toEqual([
            { key: 'project-1__a', projectId: 'project-1', taskId: 'a' },
            { key: 'project-1__sub-1', projectId: 'project-1', taskId: 'sub-1' },
        ])
    })
})
