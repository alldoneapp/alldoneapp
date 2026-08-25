/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text, TouchableOpacity } from 'react-native'
import { useSelector } from 'react-redux'

import TagsArea from './TagsArea'
import SharedHelper from '../../../utils/SharedHelper'

jest.mock('react-redux', () => ({
    useSelector: jest.fn(),
}))
jest.mock('../../Icon', () => 'Icon')
jest.mock('../../styles/global', () => ({
    __esModule: true,
    default: { subtitle2: {} },
    colors: { Text03: '#8C8C8C', Grey300: '#F2F2F2' },
    windowTagStyle: () => ({}),
}))
jest.mock('../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../../../utils/SharedHelper', () => ({ accessGranted: jest.fn(() => true) }))
jest.mock('../../Tags/AddTaskTag', () => 'AddTaskTag')
jest.mock('../../Tags/AddGoalTag', () => 'AddGoalTag')
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { checkIfLoggedUserIsNormalUserInGuide: () => false },
    checkIfSelectedProject: () => true,
}))
jest.mock('../../Feeds/Utils/FeedsConstants', () => ({ FEED_TASK_OBJECT_TYPE: 'tasks' }))
jest.mock(
    '../../UIComponents/FloatModals/MorePopupsOfMainViews/Tasks/TaskHeaderMoreButton',
    () => 'TaskHeaderMoreButton'
)
jest.mock('../../UIComponents/FloatModals/MorePopupsOfMainViews/Goals/GoalMoreButton', () => 'GoalMoreButton')

const state = {
    loggedUser: { uid: 'user-1' },
    currentUser: { uid: 'user-1' },
    selectedProjectIndex: 0,
    taskViewToggleSection: 'Open',
}

const renderTagsArea = (props = {}) => {
    useSelector.mockImplementation(selector => selector(state))

    return renderer.create(
        <TagsArea
            projectId="project-1"
            showWorkflow={true}
            mobile={false}
            onClickWorkflowIndicator={() => {}}
            {...props}
        />
    )
}

const getIconNames = tree => tree.root.findAllByType('Icon').map(icon => icon.props.name)

const getTexts = tree =>
    tree.root
        .findAllByType(Text)
        .map(text => text.props.children)
        .filter(child => typeof child === 'string')

describe('TagsArea workflow indicator', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        SharedHelper.accessGranted.mockReturnValue(true)
    })

    it('shows only that a workflow exists on desktop, never the workflow itself', () => {
        const tree = renderTagsArea({ mobile: false })

        expect(getTexts(tree)).toEqual(['Workflow'])
        // the step avatars, the connecting lines and the closing checkmark are gone
        expect(getIconNames(tree)).toEqual(['next-workflow'])
        expect(tree.root.findAllByType('Avatar')).toHaveLength(0)
        expect(tree.root.findAllByType('Line')).toHaveLength(0)
    })

    it('falls back to an icon-only tag on mobile', () => {
        const tree = renderTagsArea({ mobile: true })

        expect(getTexts(tree)).toEqual([])
        expect(getIconNames(tree)).toEqual(['next-workflow'])
        expect(tree.root.findByType(TouchableOpacity).props.title).toBe('Workflow')
    })

    it('keeps the tag clickable so it still opens the workflow', () => {
        const onClickWorkflowIndicator = jest.fn()
        const tree = renderTagsArea({ onClickWorkflowIndicator })
        const button = tree.root.findByType(TouchableOpacity)

        expect(button.props.disabled).toBe(false)
        expect(button.props.accessibilityLabel).toBe('Workflow')

        act(() => {
            button.props.onPress()
        })

        expect(onClickWorkflowIndicator).toHaveBeenCalledTimes(1)
    })

    it('disables the tag when the user has no access', () => {
        SharedHelper.accessGranted.mockReturnValue(false)
        const tree = renderTagsArea()

        expect(tree.root.findByType(TouchableOpacity).props.disabled).toBe(true)
    })

    it('renders nothing for a user without a workflow', () => {
        const tree = renderTagsArea({ showWorkflow: false })

        expect(getIconNames(tree)).toEqual([])
        expect(tree.root.findAllByType(TouchableOpacity)).toHaveLength(0)
    })
})

describe('TagsArea add-task button (PT-4745)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        SharedHelper.accessGranted.mockReturnValue(true)
    })

    // The "but of course" half of PT-4745: the switcher is on this popup too, and
    // it opens on THIS project. The popup reads its pre-selection from
    // `initialProjectId` alone, so handing it the header's own project id is the
    // whole of the pre-selection contract from this side.
    it('opens the popup on the project whose line it sits on', () => {
        const addTask = renderTagsArea({ showAddTask: true }).root.findByType('AddTaskTag')

        expect(addTask.props.projectId).toBe('project-1')
    })

    // It must NOT opt out. `showProjectSelector` defaults to on, so passing
    // nothing is correct — passing `false` would be the regression, and it is
    // invisible on screen (the row is simply absent).
    it('does not switch the project switcher off', () => {
        const addTask = renderTagsArea({ showAddTask: true }).root.findByType('AddTaskTag')

        expect(addTask.props.showProjectSelector).not.toBe(false)
    })
})
