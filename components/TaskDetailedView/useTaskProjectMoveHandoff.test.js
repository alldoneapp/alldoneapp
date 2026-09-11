import React from 'react'
import renderer, { act } from 'react-test-renderer'

const mockWatchTask = jest.fn()
const mockUnwatch = jest.fn()
const mockGetTaskData = jest.fn()
const mockReplace = jest.fn()
const mockNavigate = jest.fn()

jest.mock('../../utils/backends/Tasks/tasksFirestore', () => ({
    watchTask: (...args) => mockWatchTask(...args),
}))
jest.mock('../../utils/backends/firestore', () => ({
    getTaskData: (...args) => mockGetTaskData(...args),
    unwatch: (...args) => mockUnwatch(...args),
}))
jest.mock('../../utils/NavigationService', () => ({
    navigate: (...args) => mockNavigate(...args),
}))
jest.mock('../../URLSystem/Tasks/URLsTasks', () => ({
    __esModule: true,
    default: { replace: (...args) => mockReplace(...args) },
    URL_TASK_DETAILS_BACKLINKS_NOTES: 'backlinks-notes',
    URL_TASK_DETAILS_BACKLINKS_TASKS: 'backlinks-tasks',
    URL_TASK_DETAILS_CHAT: 'chat',
    URL_TASK_DETAILS_ESTIMATION: 'estimation',
    URL_TASK_DETAILS_FEED: 'updates',
    URL_TASK_DETAILS_NOTE: 'note',
    URL_TASK_DETAILS_PROPERTIES: 'properties',
    URL_TASK_DETAILS_SUBTASKS: 'subtasks',
    REPLACE_NEXT_TASK_DETAIL_PUSH: '__replaceNextTaskDetailPush',
}))
jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    getTypeOfProject: () => 'active',
}))
jest.mock('../../redux/actions', () => ({
    resetFloatPopup: () => ({ type: 'RESET_FLOAT_POPUP' }),
    setSelectedSidebarTab: value => ({ type: 'SET_SELECTED_SIDEBAR_TAB', value }),
    setSelectedTypeOfProject: value => ({ type: 'SET_SELECTED_PROJECT_TYPE', value }),
    showConfirmPopup: showConfirmPopupData => ({ type: 'SHOW_CONFIRM_POPUP', showConfirmPopupData }),
    switchProject: value => ({ type: 'SWITCH_PROJECT', value }),
}))
jest.mock('../UIComponents/ConfirmPopup', () => ({
    CONFIRM_POPUP_TRIGGER_INFO: 'INFO',
}))

import useTaskProjectMoveHandoff, { TASK_PROJECT_MOVE_HANDOFF_TIMEOUT_MS } from './useTaskProjectMoveHandoff'
import { DV_TAB_TASK_CHAT, DV_TAB_TASK_PROPERTIES } from '../../utils/TabNavigationConstants'

describe('useTaskProjectMoveHandoff', () => {
    let latest
    let targetListener
    let tree
    let dispatch

    const projects = {
        'project-a': { id: 'project-a', index: 0, name: 'Inbox' },
        'project-b': { id: 'project-b', index: 1, name: 'Product' },
    }
    const baseProps = {
        sourceProjectId: 'project-a',
        taskId: 'task-1',
        selectedTab: DV_TAB_TASK_CHAT,
        loggedUser: { uid: 'user-1' },
        loggedUserProjectsMap: projects,
    }

    function Harness(props) {
        latest = useTaskProjectMoveHandoff(props)
        return null
    }

    const render = (props = {}) => {
        dispatch = jest.fn()
        act(() => {
            tree = renderer.create(<Harness {...baseProps} {...props} dispatch={dispatch} />)
        })
    }

    beforeEach(() => {
        jest.clearAllMocks()
        latest = null
        targetListener = null
        tree = null
        mockGetTaskData.mockResolvedValue(null)
        mockWatchTask.mockImplementation((_projectId, _taskId, _watcherKey, callback) => {
            targetListener = callback
        })
        window.history.replaceState({}, '', '/projects/project-a/tasks/task-1/chat')
    })

    afterEach(() => {
        if (tree) act(() => tree.unmount())
        jest.useRealTimers()
    })

    it('guards a missing source and waits for the completed destination before migrating', () => {
        render()

        act(() => latest.startTaskProjectMove(projects['project-b']))
        expect(latest.isMovePending).toBe(true)
        expect(latest.handleSourceTaskChange(null)).toBe(true)
        expect(mockWatchTask).toHaveBeenCalledWith(
            'project-b',
            'task-1',
            expect.stringMatching(/^task-project-move-/),
            expect.any(Function),
            expect.any(Function)
        )

        act(() => {
            targetListener({
                id: 'task-1',
                projectMove: {
                    sourceProjectId: 'project-a',
                    targetProjectId: 'project-b',
                    requestId: 'request-1',
                    status: 'moving',
                },
            })
        })
        expect(mockNavigate).not.toHaveBeenCalled()

        act(() => latest.taskProjectMoveEnqueued({ targetProjectId: 'project-b', requestId: 'request-1' }))
        const calendarData = { eventId: 'event-1', pinnedToProjectId: 'project-b' }
        act(() => {
            targetListener({
                id: 'task-1',
                calendarData,
                projectMove: {
                    sourceProjectId: 'project-a',
                    targetProjectId: 'project-b',
                    requestId: 'request-1',
                    status: 'completed',
                },
            })
        })

        expect(mockReplace).toHaveBeenCalledWith(
            'chat',
            {
                noHistory: true,
                projectId: 'project-b',
                task: 'task-1',
                __replaceNextTaskDetailPush: true,
            },
            'project-b',
            'task-1'
        )
        expect(mockNavigate).toHaveBeenCalledWith(
            'TaskDetailedView',
            expect.objectContaining({
                projectId: 'project-b',
                task: expect.objectContaining({ projectId: 'project-b', calendarData }),
            })
        )
        expect(latest.isHandoffActive).toBe(false)
    })

    it('restores the field after an enqueue failure', () => {
        render()
        act(() => latest.startTaskProjectMove(projects['project-b']))
        act(() => latest.taskProjectMoveEnqueueFailed())

        expect(latest.isMovePending).toBe(false)
        expect(latest.isHandoffActive).toBe(false)
        expect(mockNavigate).not.toHaveBeenCalled()
    })

    it('restores the project label on timeout while retaining the late-completion guard', () => {
        jest.useFakeTimers()
        render({ selectedTab: DV_TAB_TASK_PROPERTIES })
        act(() => latest.startTaskProjectMove(projects['project-b']))

        act(() => jest.advanceTimersByTime(TASK_PROJECT_MOVE_HANDOFF_TIMEOUT_MS))

        expect(latest.isMovePending).toBe(false)
        expect(latest.isHandoffActive).toBe(true)
        expect(latest.handleSourceTaskChange(null)).toBe(true)
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                showConfirmPopupData: expect.objectContaining({
                    object: expect.objectContaining({ headerText: 'Task move is taking longer than expected' }),
                }),
            })
        )
    })

    it('ends the guard and reports a terminal background failure from the source', () => {
        render()
        act(() => latest.startTaskProjectMove(projects['project-b']))

        act(() => {
            expect(
                latest.handleSourceTaskChange({
                    id: 'task-1',
                    projectMove: {
                        sourceProjectId: 'project-a',
                        targetProjectId: 'project-b',
                        status: 'failed',
                    },
                })
            ).toBe(true)
        })

        expect(latest.isHandoffActive).toBe(false)
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                showConfirmPopupData: expect.objectContaining({
                    object: expect.objectContaining({ headerText: 'Task move failed' }),
                }),
            })
        )
    })

    it('discovers an externally-started move marker instead of treating its deletion as private', () => {
        render()
        act(() => {
            latest.handleSourceTaskChange({ id: 'task-1', movingToOtherProjectId: 'project-b' })
        })

        expect(latest.isHandoffActive).toBe(true)
        expect(mockWatchTask).toHaveBeenCalled()
        expect(latest.handleSourceTaskChange(null)).toBe(true)

        act(() => targetListener({ id: 'task-1', name: 'Automatically routed task' }))
        expect(mockNavigate).toHaveBeenCalledWith(
            'TaskDetailedView',
            expect.objectContaining({ projectId: 'project-b' })
        )
    })

    it('waits for completion when a move discovered from the source has current manual metadata', () => {
        render()
        act(() => latest.handleSourceTaskChange({ id: 'task-1', movingToOtherProjectId: 'project-b' }))

        act(() =>
            targetListener({
                id: 'task-1',
                projectMove: {
                    sourceProjectId: 'project-a',
                    targetProjectId: 'project-b',
                    status: 'moving',
                },
            })
        )
        expect(mockNavigate).not.toHaveBeenCalled()

        act(() =>
            targetListener({
                id: 'task-1',
                projectMove: {
                    sourceProjectId: 'project-a',
                    targetProjectId: 'project-b',
                    status: 'completed',
                },
            })
        )
        expect(mockNavigate).toHaveBeenCalled()
    })

    it('polls the destination after the realtime listener fails', async () => {
        jest.useFakeTimers()
        render()
        act(() => latest.startTaskProjectMove(projects['project-b']))
        const listenerError = mockWatchTask.mock.calls[0][4]
        mockGetTaskData.mockResolvedValue({
            id: 'task-1',
            projectMove: {
                sourceProjectId: 'project-a',
                targetProjectId: 'project-b',
                status: 'completed',
            },
        })

        await act(async () => {
            listenerError({ code: 'permission-denied' })
            await Promise.resolve()
        })

        expect(mockGetTaskData).toHaveBeenCalledWith('project-b', 'task-1')
        expect(mockNavigate).toHaveBeenCalledWith(
            'TaskDetailedView',
            expect.objectContaining({ projectId: 'project-b' })
        )
    })
})
