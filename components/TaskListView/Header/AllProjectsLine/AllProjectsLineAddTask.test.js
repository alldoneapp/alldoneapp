import React from 'react'
import renderer from 'react-test-renderer'
import { useSelector } from 'react-redux'

import AllProjectsLine from './AllProjectsLine'
import { AUTOMATIC_PROJECT_OPTION } from '../../../UIComponents/FloatModals/SelectProjectModal/projectPickerConstants'

jest.mock('react-redux', () => ({ useSelector: jest.fn() }))
jest.mock('./AllProjectData', () => 'AllProjectData')
jest.mock('../../../Tags/AddTaskTag', () => 'AddTaskTag')
jest.mock('../../../Avatar', () => 'Avatar')
jest.mock('../../../UIComponents/FloatModals/MorePopupsOfMainViews/Tasks/TaskHeaderMoreButton', () => 'More')
jest.mock('../../ToggleByTime', () => 'ToggleByTime')
jest.mock('../../EmailLine/AllProjectsEmailLabelChips', () => 'AllProjectsEmailLabelChips')

describe('AllProjectsLine add-task button', () => {
    beforeEach(() => {
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
})
