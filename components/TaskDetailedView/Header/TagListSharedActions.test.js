import React from 'react'
import renderer from 'react-test-renderer'
import { useSelector } from 'react-redux'

import TagList, { isTaskProjectWide } from './TagList'
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
jest.mock('../../UIControls/DvBotButton', () => 'DvBotButton')
jest.mock('./TaskHeaderOverflowButton', () => 'TaskHeaderOverflowButton')

const task = {
    id: 'task-1',
    userId: 'owner-1',
    humanReadableId: 'AT-1',
    recurrence: 'never',
    estimations: { open: 0 },
    isPublicFor: [0],
}
const privateTask = { ...task, isPublicFor: ['owner-1'] }

const renderTagList = (accessGranted, renderedTask = task) => {
    useSelector.mockImplementation(selector =>
        selector({
            loggedUser: { uid: accessGranted ? 'owner-1' : 'anonymous', sidebarExpanded: false },
            isMiddleScreen: false,
            smallScreenNavigation: false,
        })
    )
    SharedHelper.accessGranted.mockReturnValue(accessGranted)
    return renderer.create(<TagList projectId="project-1" task={renderedTask} />)
}

describe('task detail header actions', () => {
    it('shows only the link action and the overflow menu to shared viewers', () => {
        const tree = renderTagList(false)

        expect(tree.root.findAllByType('CopyLinkButton')).toHaveLength(1)
        expect(tree.root.findAllByType('DvBotButton')).toHaveLength(0)
        const overflow = tree.root.findByType('TaskHeaderOverflowButton')
        // No search in the menu for someone without project access, same as the old button.
        expect(overflow.props.canSearch).toBe(false)
        expect(overflow.props.visibilityDisabled).toBe(true)
    })

    it('keeps the assistant visible and search in the overflow menu for project members', () => {
        const tree = renderTagList(true)

        expect(tree.root.findAllByType('CopyLinkButton')).toHaveLength(1)
        expect(tree.root.findAllByType('DvBotButton')).toHaveLength(1)
        expect(tree.root.findByType('TaskHeaderOverflowButton').props).toMatchObject({
            projectId: 'project-1',
            task,
            canSearch: true,
            visibilityDisabled: false,
        })
    })

    it('keeps the primary metadata in the header row', () => {
        const tree = renderTagList(true)

        expect(tree.root.findAllByType('ProjectTag')).toHaveLength(1)
        expect(tree.root.findByType('TaskIdTag').props.humanReadableId).toBe('AT-1')
    })
})

describe('visibility in the compact header (AT-3081)', () => {
    it('moves the default "Project-wide" visibility into the overflow menu', () => {
        const tree = renderTagList(true)

        expect(tree.root.findAllByType('PrivacyTag')).toHaveLength(0)
        expect(tree.root.findByType('TaskHeaderOverflowButton').props.showVisibility).toBe(true)
    })

    it('keeps the chip of a private task visible in the header', () => {
        const tree = renderTagList(true, privateTask)

        expect(tree.root.findByType('PrivacyTag').props).toMatchObject({ object: privateTask, disabled: false })
        expect(tree.root.findByType('TaskHeaderOverflowButton').props.showVisibility).toBe(false)
    })

    it('locks visibility for an assistant task exactly as the header chip did', () => {
        const tree = renderTagList(true, { ...task, assigneeType: 'assistant' })

        expect(tree.root.findByType('TaskHeaderOverflowButton').props.visibilityDisabled).toBe(true)
    })

    it.each([
        [[0], true],
        [[0, 'user-1'], true],
        [['user-1'], false],
        [undefined, false],
    ])('treats isPublicFor %p as project-wide: %p', (isPublicFor, expected) => {
        expect(isTaskProjectWide({ isPublicFor })).toBe(expected)
    })
})
