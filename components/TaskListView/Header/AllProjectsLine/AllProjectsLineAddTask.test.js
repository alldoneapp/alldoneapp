import React from 'react'
import renderer from 'react-test-renderer'
import { useSelector } from 'react-redux'

import AllProjectsLine from './AllProjectsLine'
jest.mock('react-redux', () => ({ useSelector: jest.fn() }))
jest.mock('./AllProjectData', () => 'AllProjectData')
jest.mock('../../../Avatar', () => 'Avatar')
jest.mock('../../../UIComponents/FloatModals/MorePopupsOfMainViews/Tasks/TaskHeaderMoreButton', () => 'More')
jest.mock('../../ToggleByTime', () => 'ToggleByTime')
jest.mock('../../EmailLine/AllProjectsEmailLabelChips', () => 'AllProjectsEmailLabelChips')

describe('AllProjectsLine task actions', () => {
    beforeEach(() => {
        const state = {
            loggedUser: { uid: 'user-1', photoURL: '', defaultProjectId: 'project-default' },
            taskViewToggleSection: 'Open',
        }
        useSelector.mockImplementation(selector => selector(state))
    })

    it('leaves add-task creation to the board-level floating action', () => {
        const tree = renderer.create(<AllProjectsLine />)

        expect(tree.root.findAllByType('AddTaskTag')).toHaveLength(0)
        expect(tree.root.findAllByType('More')).toHaveLength(1)
    })

    it('keeps the existing more action limited to the Open tab', () => {
        const state = {
            loggedUser: { uid: 'user-1', photoURL: '', defaultProjectId: 'project-default' },
            taskViewToggleSection: 'Done',
        }
        useSelector.mockImplementation(selector => selector(state))

        expect(renderer.create(<AllProjectsLine />).root.findAllByType('More')).toHaveLength(0)
    })
})
