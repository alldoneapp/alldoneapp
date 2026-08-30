import React from 'react'
import renderer, { act } from 'react-test-renderer'

const mockDispatch = jest.fn()
const mockWatchOpenTasks = jest.fn()
const mockUnwatchOpenTasks = jest.fn()
const mockFilterOpenTasks = jest.fn()

let mockState

jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
    useSelector: selector => selector(mockState),
    shallowEqual: (left, right) => left === right,
}))

jest.mock('../../../redux/store', () => ({
    getState: () => mockState,
}))

jest.mock('../../../utils/backends/openTasks', () => ({
    WATCHER_VARS_DEFAULT: {
        storedTasks: {},
        estimationByDate: {},
        amountOfTasksByDate: {},
        tasksMap: {},
        subtasksByParentId: {},
        subtasksMap: {},
    },
    watchOpenTasks: (...args) => mockWatchOpenTasks(...args),
    unwatchOpenTasks: (...args) => mockUnwatchOpenTasks(...args),
    addWatchersForOneStreamAndUser: jest.fn(),
    contractOpenTasks: jest.fn(),
    filterOpTasks: (...args) => mockFilterOpenTasks(...args),
    updateOpTasks: jest.fn(),
    contractSomedayOpenTasks: jest.fn(),
}))

jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    checkIfSelectedProject: () => false,
}))

jest.mock('../../Workstreams/WorkstreamHelper', () => ({
    cleanDataWhenRemoveWorkstreamMember: jest.fn(),
    WORKSTREAM_ID_PREFIX: 'ws_',
}))

jest.mock('../../../hooks/useEffectDebug', () => jest.fn())
jest.mock('../../HashtagFilters/UseSelectorHashtagFilters', () => () => [new Map(), []])
jest.mock('../../../utils/editingGuard', () => ({ useIsUserEditing: () => false }))
jest.mock('../../../utils/backends/firestore', () => ({ checkIfCalendarConnected: jest.fn() }))
jest.mock('../../../utils/backends/EmailLine/emailLineBackend', () => ({ fetchEmailLineSummary: jest.fn() }))

import OpenTasksByProjectHandler from './OpenTasksByProjectHandler'

const emptyToday = ['0', 0, 0, [], [], [], [], [], [], [], [], []]

const buildState = ({ withSessionSnapshot }) => ({
    loggedUserProjects: [{ id: 'project-1' }],
    selectedProjectIndex: -1,
    laterTasksExpanded: false,
    somedayTasksExpanded: false,
    thereAreLaterOpenTasks: {},
    thereAreLaterEmptyGoals: {},
    thereAreSomedayOpenTasks: {},
    thereAreSomedayEmptyGoals: {},
    currentUser: { uid: 'user-1', workstreams: { 'project-1': [] } },
    loggedUser: { uid: 'user-1', apisConnected: {} },
    hashtagFilters: new Map(),
    taskPriorityFilters: [],
    taskVmStateFilters: [],
    taskVmStatesByTask: {},
    subtaskByTaskStore: {},
    taskListWatchersVars: {},
    laterTasksExpandedForNavigateFromAllProjects: false,
    somedayTasksExpandedForNavigateFromAllProjects: false,
    openTasksStore: withSessionSnapshot ? { 'project-1user-1': [emptyToday] } : {},
    globalDataByProject: withSessionSnapshot ? { 'project-1': { storedTasks: {} } } : {},
})

describe('OpenTasksByProjectHandler same-session cache lifecycle', () => {
    beforeEach(() => {
        mockDispatch.mockClear()
        mockWatchOpenTasks.mockClear()
        mockUnwatchOpenTasks.mockClear()
        mockFilterOpenTasks.mockClear()
    })

    it('retains rendered rows and watcher data while the Tasks page is unmounted', () => {
        mockState = buildState({ withSessionSnapshot: true })
        let tree

        act(() => {
            tree = renderer.create(
                <OpenTasksByProjectHandler
                    projectIndex={0}
                    firstProject={false}
                    setProjectsHaveTasksInFirstDay={jest.fn()}
                />
            )
        })

        expect(mockWatchOpenTasks).toHaveBeenCalledTimes(1)
        expect(mockWatchOpenTasks.mock.calls[0][4]).toBe(true)
        expect(mockUnwatchOpenTasks).toHaveBeenCalledWith('project-1', 'user-1', { preserveData: true })

        act(() => tree.unmount())

        expect(mockUnwatchOpenTasks).toHaveBeenLastCalledWith('project-1', 'user-1', { preserveData: true })
        const actions = mockDispatch.mock.calls.flatMap(([action]) => (Array.isArray(action) ? action : [action]))
        expect(actions.some(action => action.type === 'Clear open tasks map')).toBe(false)
        expect(actions.some(action => action.type === 'Clear open subtasks map')).toBe(false)
        expect(actions.some(action => action.type === 'Update open tasks' && action.openTasksStore === null)).toBe(
            false
        )
    })

    it('starts a cold project with empty listener state and clears project-level drag maps', () => {
        mockState = buildState({ withSessionSnapshot: false })
        let tree

        act(() => {
            tree = renderer.create(
                <OpenTasksByProjectHandler
                    projectIndex={0}
                    firstProject={false}
                    setProjectsHaveTasksInFirstDay={jest.fn()}
                />
            )
        })

        expect(mockWatchOpenTasks.mock.calls[0][4]).toBe(false)
        const actions = mockDispatch.mock.calls.flatMap(([action]) => (Array.isArray(action) ? action : [action]))
        expect(actions.some(action => action.type === 'Clear open tasks map')).toBe(true)
        expect(actions.some(action => action.type === 'Clear open subtasks map')).toBe(true)

        act(() => tree.unmount())
    })

    it('paints a retained projection without attaching Firestore until the mount queue admits it', () => {
        mockState = buildState({ withSessionSnapshot: true })
        let tree

        act(() => {
            tree = renderer.create(
                <OpenTasksByProjectHandler
                    projectIndex={0}
                    firstProject={false}
                    setProjectsHaveTasksInFirstDay={jest.fn()}
                    taskWatchersEnabled={false}
                />
            )
        })

        expect(mockWatchOpenTasks).not.toHaveBeenCalled()
        expect(mockUnwatchOpenTasks).not.toHaveBeenCalled()

        act(() => {
            tree.update(
                <OpenTasksByProjectHandler
                    projectIndex={0}
                    firstProject={false}
                    setProjectsHaveTasksInFirstDay={jest.fn()}
                    taskWatchersEnabled
                />
            )
        })

        expect(mockWatchOpenTasks).toHaveBeenCalledTimes(1)
        expect(mockUnwatchOpenTasks).toHaveBeenCalledWith('project-1', 'user-1', { preserveData: true })
        act(() => tree.unmount())
    })
})
