import React from 'react'
import renderer from 'react-test-renderer'
import { useSelector } from 'react-redux'

import AllProjectsLine from './AllProjectsLine'
import useEmailLabelGroups from '../../EmailLine/useEmailLabelGroups'
jest.mock('react-redux', () => ({ useSelector: jest.fn() }))
jest.mock('./AllProjectData', () => 'AllProjectData')
jest.mock('../../../Avatar', () => 'Avatar')
jest.mock('../../../UIComponents/FloatModals/MorePopupsOfMainViews/Tasks/TaskHeaderMoreButton', () => 'More')
jest.mock('../../ToggleByTime', () => 'ToggleByTime')
jest.mock('../../EmailLine/EmailLabelChip', () => 'EmailLabelChip')
jest.mock('../../EmailLine/useEmailLabelGroups', () => jest.fn())
jest.mock('./AllProjectsMeetingTime', () => ({ __esModule: true, default: 'AllProjectsMeetingTime' }))

describe('AllProjectsLine task actions', () => {
    beforeEach(() => {
        const state = {
            loggedUser: {
                uid: 'user-1',
                photoURL: '',
                defaultProjectId: 'project-default',
                sidebarNavigationMode: 'simple',
            },
            taskViewToggleSection: 'Open',
        }
        useSelector.mockImplementation(selector => selector(state))
    })

    it('leaves add-task creation to the board-level floating action', () => {
        const tree = renderer.create(<AllProjectsLine />)

        expect(tree.root.findAllByType('AddTaskTag')).toHaveLength(0)
        expect(tree.root.findAllByType('More')).toHaveLength(1)
        expect(tree.root.findByType('More').props.projectIdOverride).toBeNull()
    })

    it('keeps the existing more action limited to the Open tab', () => {
        const state = {
            loggedUser: {
                uid: 'user-1',
                photoURL: '',
                defaultProjectId: 'project-default',
                sidebarNavigationMode: 'simple',
            },
            taskViewToggleSection: 'Done',
        }
        useSelector.mockImplementation(selector => selector(state))

        expect(renderer.create(<AllProjectsLine />).root.findAllByType('More')).toHaveLength(0)
    })

    it('does not show the email pill next to the more menu (AT-3110)', () => {
        const tree = renderer.create(<AllProjectsLine bottomSpacing={8} />)

        expect(tree.root.findAllByType('EmailLabelChip')).toHaveLength(0)
        expect(useEmailLabelGroups).not.toHaveBeenCalled()
        expect(tree.root.findAllByType('Avatar')).toHaveLength(1)
        expect(tree.root.findAllByType('AllProjectData')).toHaveLength(1)
        expect(tree.root.findAllByType('More')).toHaveLength(1)
    })

    it('shows the meeting time only where a view asks for it (AT-3136)', () => {
        expect(renderer.create(<AllProjectsLine />).root.findAllByType('AllProjectsMeetingTime')).toHaveLength(0)
        expect(
            renderer.create(<AllProjectsLine showMeetingTime />).root.findAllByType('AllProjectsMeetingTime')
        ).toHaveLength(1)
    })
})
