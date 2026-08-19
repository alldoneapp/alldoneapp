import React from 'react'
import renderer, { act } from 'react-test-renderer'

import TopShowMoreButton from './TopShowMoreButton'
import {
    pressShowLaterTasksInAllProjects,
    setLaterTasksExpanded,
    setTaskListSingleLoading,
} from '../../../redux/actions'
import { updateOpTasks, watchOpenTasks } from '../../../utils/backends/openTasks'

const mockDispatch = jest.fn()
const mockCheckIfSelectedProject = jest.fn()
const mockGetTypeOfProject = jest.fn()
let mockState
let mockStoreState

jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
    useSelector: selector => selector(mockState),
}))
jest.mock('../../UIControls/ShowMoreButton', () => 'ShowMoreButton')
jest.mock('../../../utils/backends/openTasks', () => ({
    contractOpenTasks: jest.fn(),
    updateOpTasks: jest.fn(),
    watchOpenTasks: jest.fn(),
}))
jest.mock('../../../redux/store', () => ({
    getState: () => mockStoreState,
}))
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { getTypeOfProject: (...args) => mockGetTypeOfProject(...args) },
    checkIfSelectedProject: (...args) => mockCheckIfSelectedProject(...args),
}))
jest.mock('../../../utils/HelperFunctions', () => ({ dismissAllPopups: jest.fn() }))

describe('TopShowMoreButton loading ghost state', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockState = {
            loggedUserProjects: [{ id: 'project-1' }],
            smallScreenNavigation: false,
            laterTasksExpanded: false,
        }
        mockStoreState = {
            selectedProjectIndex: 0,
            loggedUser: { uid: 'user-1' },
            thereAreLaterOpenTasks: { 'project-1': true },
            thereAreLaterEmptyGoals: { 'project-1': false },
        }
        mockCheckIfSelectedProject.mockReturnValue(true)
        mockGetTypeOfProject.mockReturnValue('active')
    })

    it('marks the list as incrementally loading before fetching later tasks', () => {
        let tree
        act(() => {
            tree = renderer.create(
                <TopShowMoreButton
                    instanceKey="project-1user-1"
                    projectIndex={0}
                    setProjectsHaveTasksInFirstDay={jest.fn()}
                />
            )
        })

        act(() => {
            tree.root.findByType('ShowMoreButton').props.expand()
        })

        expect(mockDispatch).toHaveBeenCalledWith([
            setTaskListSingleLoading('project-1user-1', true),
            setLaterTasksExpanded(true),
        ])
        expect(watchOpenTasks).toHaveBeenCalledWith(
            'project-1',
            expect.any(Function),
            true,
            false,
            true,
            'project-1user-1'
        )

        const updateTasks = watchOpenTasks.mock.calls[0][1]
        updateTasks([['0']], true)
        expect(updateOpTasks).toHaveBeenCalled()
    })

    it('keeps the one-row state across navigation from all projects', () => {
        mockCheckIfSelectedProject.mockReturnValue(false)

        let tree
        act(() => {
            tree = renderer.create(
                <TopShowMoreButton
                    instanceKey="project-1user-1"
                    projectIndex={0}
                    setProjectsHaveTasksInFirstDay={jest.fn()}
                />
            )
        })

        act(() => {
            tree.root.findByType('ShowMoreButton').props.expand()
        })

        expect(mockDispatch.mock.calls[0][0]).toEqual(
            expect.arrayContaining([setTaskListSingleLoading('project-1user-1', true)])
        )
        expect(mockDispatch).toHaveBeenCalledWith(pressShowLaterTasksInAllProjects(0, 'active', 'project-1', true))
        expect(watchOpenTasks).not.toHaveBeenCalled()
    })
})
