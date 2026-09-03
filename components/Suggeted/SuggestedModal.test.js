import React from 'react'
import renderer from 'react-test-renderer'

jest.mock('../../i18n/TranslationService', () => ({ translate: text => text }))
jest.mock('../../redux/store', () => ({
    getState: jest.fn(),
    subscribe: jest.fn(() => jest.fn()),
    dispatch: jest.fn(),
}))
jest.mock('./suggestedTaskBypass', () => ({
    canBypassSuggestedTaskWorkflow: jest.fn(),
    getSuggestedTaskBypassLabel: jest.fn(() => 'Bypass workflow and mark done'),
    moveSuggestedTaskToDoneBypassingWorkflow: jest.fn(),
}))
jest.mock('../Feeds/Utils/HelperFunctions', () => ({
    FORDWARD_COMMENT: 'forward',
    updateNewAttachmentsData: jest.fn((projectId, comment) => Promise.resolve(comment)),
}))
jest.mock('../../utils/backends/Tasks/tasksFirestore', () => ({
    nextStepSuggestedTask: jest.fn(),
    setTaskAutoEstimation: jest.fn(),
    updateSuggestedTask: jest.fn(),
}))
jest.mock('../../utils/backends/Chats/chatsComments', () => ({ createObjectMessage: jest.fn() }))
jest.mock('../UIComponents/FloatModals/EstimationModal/EstimationModal', () => 'EstimationModal')
jest.mock('../UIComponents/FloatModals/RichCommentModal/RichCommentModal', () => 'RichCommentModal')
jest.mock('../UIComponents/FloatModals/RichCommentModal/taskCommentAssistant', () => ({
    getTaskCommentAssistantProps: () => ({}),
}))
jest.mock('../UIComponents/FloatModals/AssigneeAndObserversModal/AssigneeAndObserversModal', () => 'AssigneeModal')
jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({ getProjectIndexById: () => 0 }))
jest.mock('../AdminPanel/Assistants/assistantsHelper', () => ({ getAssistant: () => null }))
jest.mock('../../utils/EstimationHelper', () => ({ getEstimationIconByValue: () => 1 }))
jest.mock('../UIControls/Button', () => 'Button')
jest.mock('../Tags/FileTag', () => 'FileTag')
jest.mock('../FollowUp/AttachmentsTag', () => 'AttachmentsTag')
// Both reach the Firebase layer at import time, which is not available in the test env.
jest.mock('../../utils/HelperFunctions', () => ({
    applyPopoverWidth: () => ({}),
    getWorkflowStepsIdsSorted: workflow => Object.keys(workflow || {}),
}))
jest.mock('../Workstreams/WorkstreamHelper', () => ({ WORKSTREAM_ID_PREFIX: 'workstream_' }))
jest.mock('../TaskListView/Utils/TasksHelper', () => ({
    __esModule: true,
    DONE_STEP: -2,
    OPEN_STEP: -1,
    getTaskAutoEstimation: () => null,
    default: {
        getUserInProject: () => null,
        getContactInProject: () => null,
        mergeDueDateAndEstimationsByObserversIds: () => ({ dueDateByObserversIds: {}, estimationsByObserverIds: {} }),
    },
}))

const store = require('../../redux/store')
const {
    canBypassSuggestedTaskWorkflow,
    getSuggestedTaskBypassLabel,
    moveSuggestedTaskToDoneBypassingWorkflow,
} = require('./suggestedTaskBypass')
const SuggestedModal = require('./SuggestedModal').default

const PROJECT_ID = 'project-1'
const task = {
    id: 'task-1',
    name: 'Prepare the demo',
    userId: 'owner-1',
    userIds: ['owner-1'],
    creatorId: 'suggester-1',
    suggestedBy: 'suggester-1',
    subtaskIds: [],
    estimations: { '-1': 30 },
    observersIds: [],
    dueDateByObserversIds: {},
    estimationsByObserverIds: {},
}

const renderModal = () => {
    const hidePopover = jest.fn()
    const tree = renderer.create(
        <SuggestedModal
            task={task}
            projectId={PROJECT_ID}
            hidePopover={hidePopover}
            cancelPopover={jest.fn()}
            checkBoxId="checkbox-1"
        />
    )
    return { tree, hidePopover }
}

describe('SuggestedModal workflow bypass', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        getSuggestedTaskBypassLabel.mockReturnValue('Bypass workflow and mark done')
        store.getState.mockReturnValue({
            smallScreenNavigation: false,
            loggedUser: { uid: 'owner-1' },
            currentUser: { uid: 'owner-1', workflow: { [PROJECT_ID]: { 'step-1': { description: 'Review' } } } },
        })
    })

    it('offers the bypass when the accepting user has a workflow in the project', () => {
        canBypassSuggestedTaskWorkflow.mockReturnValue(true)
        const { tree } = renderModal()

        // The task has to be part of the decision: an assistant suggestion needs the bypass even
        // when the project has no workflow (AT-2164).
        expect(canBypassSuggestedTaskWorkflow).toHaveBeenCalledWith(
            expect.objectContaining({ uid: 'owner-1' }),
            PROJECT_ID,
            task
        )
        expect(tree.root.findAllByProps({ testID: 'bypass-workflow-button' }).length).toBeGreaterThan(0)
    })

    it('labels the bypass with what it actually does in this project', () => {
        canBypassSuggestedTaskWorkflow.mockReturnValue(true)
        getSuggestedTaskBypassLabel.mockReturnValue('Accept and mark done')
        const { tree } = renderModal()

        expect(getSuggestedTaskBypassLabel).toHaveBeenCalledWith(
            expect.objectContaining({ uid: 'owner-1' }),
            PROJECT_ID
        )
        expect(tree.root.findByProps({ testID: 'bypass-workflow-button' }).props.accessibilityLabel).toBe(
            'Accept and mark done'
        )
    })

    it('hides the bypass when there is no workflow to skip', () => {
        canBypassSuggestedTaskWorkflow.mockReturnValue(false)
        const { tree } = renderModal()

        expect(tree.root.findAllByProps({ testID: 'bypass-workflow-button' })).toHaveLength(0)
    })

    it('completes the suggested task directly instead of entering the workflow', async () => {
        canBypassSuggestedTaskWorkflow.mockReturnValue(true)
        const { tree, hidePopover } = renderModal()

        tree.root.findByProps({ testID: 'bypass-workflow-button' }).props.onPress()
        await Promise.resolve()

        expect(hidePopover).toHaveBeenCalledTimes(1)
        expect(moveSuggestedTaskToDoneBypassingWorkflow).toHaveBeenCalledWith({
            projectId: PROJECT_ID,
            task,
            estimations: { '-1': 30 },
            comment: '',
            checkBoxId: 'checkbox-1',
        })
    })

    it('ignores a second bypass press while the first one is still running', async () => {
        canBypassSuggestedTaskWorkflow.mockReturnValue(true)
        const { tree } = renderModal()
        const bypass = tree.root.findByProps({ testID: 'bypass-workflow-button' })

        bypass.props.onPress()
        bypass.props.onPress()
        await Promise.resolve()

        expect(moveSuggestedTaskToDoneBypassingWorkflow).toHaveBeenCalledTimes(1)
    })

    it('leaves the regular next step action untouched', async () => {
        canBypassSuggestedTaskWorkflow.mockReturnValue(true)
        const { nextStepSuggestedTask } = require('../../utils/backends/Tasks/tasksFirestore')
        const { tree } = renderModal()

        tree.root.findByProps({ title: 'Go to next step' }).props.onPress()
        await Promise.resolve()

        expect(nextStepSuggestedTask).toHaveBeenCalledWith(PROJECT_ID, 'step-1', task, { '-1': 30 }, '', 'checkbox-1')
        expect(moveSuggestedTaskToDoneBypassingWorkflow).not.toHaveBeenCalled()
    })
})
