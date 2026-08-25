import React from 'react'
import renderer from 'react-test-renderer'
import { useSelector } from 'react-redux'

import AllProjectsLine from './AllProjectsLine'
import { AUTOMATIC_PROJECT_OPTION } from '../../../UIComponents/FloatModals/SelectProjectModal/projectPickerConstants'

const mockDispatch = jest.fn()
const mockClearStoredWebShareTarget = jest.fn()

jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch, useSelector: jest.fn() }))
jest.mock('../../../../redux/actions', () => ({
    clearPendingWebShareTarget: () => ({ type: 'Clear pending web share target' }),
}))
jest.mock('../../../../utils/webShareTarget', () => ({
    clearStoredWebShareTarget: () => mockClearStoredWebShareTarget(),
}))
jest.mock('./AllProjectData', () => 'AllProjectData')
jest.mock('../../../Tags/AddTaskTag', () => 'AddTaskTag')
jest.mock('../../../Avatar', () => 'Avatar')
jest.mock('../../../UIComponents/FloatModals/MorePopupsOfMainViews/Tasks/TaskHeaderMoreButton', () => 'More')
jest.mock('../../ToggleByTime', () => 'ToggleByTime')
jest.mock('../../EmailLine/AllProjectsEmailLabelChips', () => 'AllProjectsEmailLabelChips')

describe('AllProjectsLine add-task button', () => {
    beforeEach(() => {
        mockDispatch.mockClear()
        mockClearStoredWebShareTarget.mockClear()
        const state = {
            loggedUser: { uid: 'user-1', photoURL: '', defaultProjectId: 'project-default' },
            taskViewToggleSection: 'Open',
        }
        useSelector.mockImplementation(selector => selector(state))
    })

    // AT-2306: in All Projects no project is in context, so the popup opens on
    // "Automatic" rather than silently filing everything in the default project.
    it('defaults to the Automatic project option', () => {
        const addTask = renderer.create(<AllProjectsLine />).root.findByType('AddTaskTag')

        expect(addTask.props.projectId).toBe(AUTOMATIC_PROJECT_OPTION)
        expect(addTask.props.showProjectSelector).toBe(true)
    })

    it('opens the same popup with an incoming shared link and consumes it once opened', () => {
        const state = {
            loggedUser: { uid: 'user-1', photoURL: '', defaultProjectId: 'project-default' },
            taskViewToggleSection: 'Open',
            pendingWebShareTarget: { id: 'share-1', taskName: 'https://example.com/article' },
        }
        useSelector.mockImplementation(selector => selector(state))

        const addTask = renderer.create(<AllProjectsLine />).root.findByType('AddTaskTag')

        expect(addTask.props.initialTaskName).toBe('https://example.com/article')
        expect(addTask.props.autoOpenKey).toBe('share-1')

        addTask.props.onAutoOpen()
        expect(mockClearStoredWebShareTarget).toHaveBeenCalledTimes(1)
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'Clear pending web share target' })
    })
})
