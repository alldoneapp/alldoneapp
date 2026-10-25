import React from 'react'
import renderer from 'react-test-renderer'
import { useSelector } from 'react-redux'

import TagList from './TagList'
import SharedHelper from '../../../utils/SharedHelper'

jest.mock('react-redux', () => ({ useSelector: jest.fn() }))
jest.mock('../../../utils/SharedHelper', () => ({ accessGranted: jest.fn() }))
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    getProjectById: jest.fn(() => ({ id: 'project-1' })),
    checkIfLoggedUserIsNormalUserInGuide: jest.fn(() => false),
}))
jest.mock('../../TaskListView/Utils/TasksHelper', () => ({
    OPEN_STEP: 'open',
    RECURRENCE_NEVER: 'never',
    TASK_ASSIGNEE_ASSISTANT_TYPE: 'assistant',
}))
jest.mock('../../Tags/TaskRecurrence', () => 'TaskRecurrence')
jest.mock('../../Tags/TaskEstimation', () => 'TaskEstimation')
jest.mock('../../Tags/PrivacyTag', () => 'PrivacyTag')
jest.mock('../../Tags/ProjectTag', () => 'ProjectTag')
jest.mock('../../Tags/TaskIdTag', () => 'TaskIdTag')
jest.mock('../../UIControls/CopyLinkButton', () => 'CopyLinkButton')
jest.mock('../../UIControls/OpenInNewWindowButton', () => 'OpenInNewWindowButton')
jest.mock('../../UIControls/DvBotButton', () => 'DvBotButton')
jest.mock('../../UIControls/DvSearchButton', () => 'DvSearchButton')

const task = {
    id: 'task-1',
    userId: 'owner-1',
    recurrence: 'never',
    estimations: { open: 0 },
}

const renderTagList = accessGranted => {
    useSelector.mockImplementation(selector =>
        selector({
            loggedUser: { uid: accessGranted ? 'owner-1' : 'anonymous', sidebarExpanded: false },
            isMiddleScreen: false,
            smallScreenNavigation: false,
        })
    )
    SharedHelper.accessGranted.mockReturnValue(accessGranted)
    return renderer.create(<TagList projectId="project-1" task={task} />)
}

describe('task detail header actions', () => {
    it('shows only link actions to shared viewers', () => {
        const tree = renderTagList(false)

        expect(tree.root.findAllByType('CopyLinkButton')).toHaveLength(1)
        expect(tree.root.findAllByType('OpenInNewWindowButton')).toHaveLength(1)
        expect(tree.root.findAllByType('DvSearchButton')).toHaveLength(0)
        expect(tree.root.findAllByType('DvBotButton')).toHaveLength(0)
    })

    it('keeps search and assistant actions for project members', () => {
        const tree = renderTagList(true)

        expect(tree.root.findAllByType('DvSearchButton')).toHaveLength(1)
        expect(tree.root.findAllByType('DvBotButton')).toHaveLength(1)
    })
})
