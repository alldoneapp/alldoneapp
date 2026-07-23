import React from 'react'
import renderer from 'react-test-renderer'
import { useSelector } from 'react-redux'

import TaskChatWorkflowControls from './TaskChatWorkflowControls'
import useGetTaskWorkflow from '../../utils/useGetTaskWorkflow'
import SharedHelper from '../../utils/SharedHelper'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { objectIsLockedForUser } from '../Guides/guidesHelper'

jest.mock('react-redux', () => ({
    useSelector: jest.fn(),
}))
jest.mock('../../utils/useGetTaskWorkflow', () => jest.fn())
jest.mock('../../utils/SharedHelper', () => ({
    checkIfUserHasAccessToProject: jest.fn(),
}))
jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    checkIfLoggedUserIsNormalUserInGuide: jest.fn(),
}))
jest.mock('../Guides/guidesHelper', () => ({
    objectIsLockedForUser: jest.fn(),
}))
jest.mock(
    '../UIComponents/FloatModals/RichCommentModal/CommentPopupWorkflowControls',
    () => 'CommentPopupWorkflowControls'
)

const task = {
    id: 'task-1',
    userId: 'owner-1',
    lockKey: 'lock-1',
}
const loggedUser = {
    uid: 'owner-1',
    isAnonymous: false,
    projectIds: ['project-1'],
    unlockedKeysByGuides: {},
}
const workflow = {
    'step-1': { description: 'Review' },
}

describe('TaskChatWorkflowControls', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        useSelector.mockImplementation(selector => selector({ loggedUser }))
        useGetTaskWorkflow.mockReturnValue(workflow)
        SharedHelper.checkIfUserHasAccessToProject.mockReturnValue(true)
        ProjectHelper.checkIfLoggedUserIsNormalUserInGuide.mockReturnValue(false)
        objectIsLockedForUser.mockReturnValue(false)
    })

    it('reuses the comment popup workflow controls with the task owner workflow', () => {
        const tree = renderer.create(<TaskChatWorkflowControls projectId="project-1" task={task} />)
        const controls = tree.root.findByType('CommentPopupWorkflowControls')

        expect(useGetTaskWorkflow).toHaveBeenCalledWith('project-1', task)
        expect(controls.props).toEqual({
            projectId: 'project-1',
            task,
            workflow,
            disabled: false,
        })
    })

    it.each([
        ['the member cannot update guide tasks', false, true, false],
        ['the member has no project access', true, false, false],
        ['the task is locked', true, true, true],
    ])('disables transitions when %s', (description, canUpdateGuideTasks, hasAccess, isLocked) => {
        ProjectHelper.checkIfLoggedUserIsNormalUserInGuide.mockReturnValue(!canUpdateGuideTasks)
        SharedHelper.checkIfUserHasAccessToProject.mockReturnValue(hasAccess)
        objectIsLockedForUser.mockReturnValue(isLocked)
        useSelector.mockImplementation(selector =>
            selector({
                loggedUser: {
                    ...loggedUser,
                    uid: 'member-1',
                },
            })
        )

        const tree = renderer.create(<TaskChatWorkflowControls projectId="project-1" task={task} />)

        expect(tree.root.findByType('CommentPopupWorkflowControls').props.disabled).toBe(true)
    })
})
