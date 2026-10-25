/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useDispatch, useSelector } from 'react-redux'
import { Text } from 'react-native'
import i18n from 'i18n-js'

import { ESTIMATIONS_MODAL_ID, removeModal, storeModal } from '../../../../ModalsManager/modalsManager'
import { setLanguage } from '../../../../../i18n/TranslationService'
import GenericModalItem from '../Common/GenericModalItem'
import TaskMoreButton from './TaskMoreButton'
import PrepareMeetingsItem from '../../PrepareMeetings/PrepareMeetingsItem'

jest.mock('../../PrepareMeetings/PrepareMeetingsItem', () => 'PrepareMeetingsItem')

jest.mock('react-redux', () => ({
    useDispatch: jest.fn(),
    useSelector: jest.fn(),
}))
jest.mock('../../../../../redux/actions', () => ({
    showFloatPopup: () => ({ type: 'Show float popup' }),
    hideFloatPopup: () => ({ type: 'Hide float popup' }),
}))
jest.mock('../Common/MoreButtonWrapper', () => {
    const React = require('react')
    return {
        __esModule: true,
        default: React.forwardRef((props, ref) => {
            React.useImperativeHandle(ref, () => ({ close: jest.fn() }))
            return React.createElement('MoreButtonWrapper', props, props.customModal, props.children)
        }),
    }
})
jest.mock('react-hot-keys', () => 'Hotkeys')
jest.mock('react-native-gesture-handler', () => ({ TouchableOpacity: 'TouchableOpacity' }))
jest.mock('../../../../Icon', () => 'Icon')
jest.mock('../../../../UIControls/Shortcut', () => ({
    __esModule: true,
    default: 'Shortcut',
    SHORTCUT_LIGHT: 'light',
}))
jest.mock('../Common/CopyLinkModalItem', () => 'CopyLinkModalItem')
jest.mock('../Common/FollowingModalItem', () => 'FollowingModalItem')
jest.mock('./DeleteModalItem', () => 'DeleteModalItem')
jest.mock('../../DescriptionModal/DescriptionModal', () => 'DescriptionModal')
jest.mock('../../PrivacyModal/PrivacyModal', () => 'PrivacyModal')
jest.mock('../../RecurrenceModal', () => 'RecurrenceModal')
jest.mock('../../SelectProjectModal/SelectProjectModal', () => 'SelectProjectModal')
jest.mock('../../TaskParentGoalModal/TaskParentGoalModal', () => 'TaskParentGoalModal')
jest.mock('../../EstimationModal/EstimationModal', () => 'EstimationModal')
jest.mock('../../HighlightColorModal/HighlightColorModal', () => 'HighlightColorModal')
jest.mock('../../TaskPriorityModal/TaskPriorityModal', () => 'TaskPriorityModal')
jest.mock('../../../../TaskDetailedView/Properties/StatusPicker', () => 'StatusPicker')
jest.mock('../../../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    getProjectById: () => ({ id: 'project-1', parentTemplateId: null }),
}))
jest.mock('../../../../../utils/useGetTaskWorkflow', () => () => ({ steps: [] }))
jest.mock('../../../../../utils/BackendBridge', () => ({
    watchGoal: jest.fn(),
    unwatch: jest.fn(),
}))
jest.mock('../../../../../utils/backends/Tasks/tasksFirestore', () => ({
    setTaskAutoEstimation: jest.fn(),
    setTaskHighlight: jest.fn(),
    setTaskParentGoal: jest.fn(),
    setTaskProjectWithGoal: jest.fn(),
}))
jest.mock('../../../../TaskListView/Utils/TasksHelper', () => ({
    getTaskAutoEstimation: () => null,
    objectIsPublicForLoggedUser: () => true,
}))
jest.mock('../../../../../utils/EstimationHelper', () => ({ getEstimationIconByValue: () => 0 }))
jest.mock('../../../../../utils/LinkingHelper', () => ({ getDvMainTabLink: () => '/task/task-1' }))
jest.mock('../../../../../utils/Gmail/gmailTaskUtils', () => ({ isInboxSummaryGmailTask: () => false }))
jest.mock('../../../../ModalsManager/modalsManager', () => ({
    ESTIMATIONS_MODAL_ID: 'estimations-modal',
    HIGHLIGHT_MODAL_ID: 'highlight-modal',
    PRIVACY_MODAL_ID: 'privacy-modal',
    PROJECT_MODAL_ID: 'project-modal',
    RECURRING_MODAL_ID: 'recurring-modal',
    TASK_DESCRIPTION_MODAL_ID: 'description-modal',
    TASK_PARENT_GOAL_MODAL_ID: 'parent-goal-modal',
    TASK_WORKFLOW_MODAL_ID: 'workflow-modal',
    removeModal: jest.fn(),
    storeModal: jest.fn(),
}))

describe('TaskMoreButton popup lock', () => {
    let dispatch
    let originalLocale

    beforeEach(() => {
        originalLocale = i18n.locale
        setLanguage('en')
        jest.clearAllMocks()
        dispatch = jest.fn()
        useDispatch.mockReturnValue(dispatch)
        useSelector.mockImplementation(selector => selector({ loggedUser: { uid: 'user-1' } }))
    })

    afterEach(() => {
        setLanguage(originalLocale)
    })

    it.each([true, false])('offers preparation only for a saved selected calendar task (calendar=%s)', calendar => {
        const task = {
            id: 'event-1',
            calendarData: calendar ? { email: 'work@example.com' } : null,
            userIds: ['user-1'],
            estimations: { open: 0 },
            stepHistory: ['open'],
        }
        let tree
        act(() => {
            tree = renderer.create(<TaskMoreButton projectId="project-1" task={task} editing={true} />)
        })
        const items = tree.root.findAllByType(PrepareMeetingsItem)
        expect(items).toHaveLength(calendar ? 1 : 0)
        if (calendar)
            expect(items[0].props).toMatchObject({ projectId: 'project-1', tasks: [task], specificTask: true })
        act(() => tree.unmount())
    })

    it('releases and unregisters the estimation popup when the main menu is dismissed outside', () => {
        const task = {
            id: 'task-1',
            userId: 'user-1',
            userIds: ['user-1'],
            isSubtask: false,
            done: false,
            calendarData: null,
            parentGoalId: null,
            estimations: { open: 0 },
            stepHistory: ['open'],
            autoEstimation: null,
            priority: 'none',
            hasStar: '#FFFFFF',
        }
        let tree

        act(() => {
            tree = renderer.create(
                <TaskMoreButton
                    formType="task"
                    projectId="project-1"
                    task={task}
                    editing={true}
                    isAssistant={false}
                    saveDescription={jest.fn()}
                    savePrivacyBeforeSaveObject={jest.fn()}
                    saveRecurrenceBeforeSaveTask={jest.fn()}
                    setEstimationBeforeSave={jest.fn()}
                    setTempAutoEstimation={jest.fn()}
                    setPriorityBeforeSave={jest.fn()}
                />
            )
        })

        const estimationItem = tree.root.findAllByType(GenericModalItem).find(item => item.props.text === 'Estimation')

        act(() => {
            estimationItem.props.visibilityData.openPopup(
                { preventDefault: jest.fn(), stopPropagation: jest.fn() },
                estimationItem.props.visibilityData.constant,
                estimationItem.props.visibilityData.visibilityFn
            )
        })

        expect(storeModal).toHaveBeenCalledWith(ESTIMATIONS_MODAL_ID)
        expect(dispatch).toHaveBeenCalledWith({ type: 'Show float popup' })
        expect(tree.root.findAllByType('EstimationModal')).toHaveLength(1)

        act(() => {
            tree.root.findByType('MoreButtonWrapper').props.onCloseModal()
        })

        expect(removeModal).toHaveBeenCalledWith(ESTIMATIONS_MODAL_ID)
        expect(dispatch).toHaveBeenCalledWith({ type: 'Hide float popup' })
        expect(tree.root.findAllByType('EstimationModal')).toHaveLength(0)
        act(() => tree.unmount())
    })

    it.each([
        ['de', 'Priorität'],
        ['en', 'Priority'],
        ['es', 'Prioridad'],
    ])('renders the priority menu label in %s and opens its selector (AT-2670)', (locale, label) => {
        setLanguage(locale)
        const task = {
            id: 'task-1',
            userId: 'user-1',
            userIds: ['user-1'],
            estimations: { open: 0 },
            stepHistory: ['open'],
            priority: 'none',
        }
        let tree

        act(() => {
            tree = renderer.create(
                <TaskMoreButton
                    formType="task"
                    projectId="project-1"
                    task={task}
                    editing={true}
                    setPriorityBeforeSave={jest.fn()}
                />
            )
        })

        try {
            // Keep GenericModalItem, ModalItem and TranslationService real: an identity
            // translate mock hides the double lookup that caused the German placeholder.
            const priorityItem = tree.root.findAllByType(GenericModalItem).find(item => item.props.icon === 'flag')
            const text = priorityItem.findAllByType(Text).map(node => node.props.children)
            expect(text).toContain(label)
            expect(text.join(' ')).not.toContain('[missing')

            act(() => {
                priorityItem.findByType('TouchableOpacity').props.onPress({
                    preventDefault: jest.fn(),
                    stopPropagation: jest.fn(),
                })
            })
            expect(tree.root.findAllByType('TaskPriorityModal')).toHaveLength(1)
        } finally {
            act(() => tree.unmount())
        }
    })
})
