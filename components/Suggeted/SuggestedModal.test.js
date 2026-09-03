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

const renderModal = (props = {}) => {
    const hidePopover = jest.fn()
    const tree = renderer.create(
        <SuggestedModal
            task={task}
            projectId={PROJECT_ID}
            hidePopover={hidePopover}
            cancelPopover={jest.fn()}
            checkBoxId="checkbox-1"
            {...props}
        />
    )
    return { tree, hidePopover }
}

// AT-2495 — the suggested-task actions now issue their write from behind the row's completion
// handoff, so it lands a couple of microtasks after the press instead of on the first one. Flushing
// the task queue is stable across that, where counting `Promise.resolve()`s is not.
const flushAsync = () => new Promise(resolve => setTimeout(resolve, 0))

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
        await flushAsync()

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
        await flushAsync()

        expect(moveSuggestedTaskToDoneBypassingWorkflow).toHaveBeenCalledTimes(1)
    })

    it('leaves the regular next step action untouched', async () => {
        canBypassSuggestedTaskWorkflow.mockReturnValue(true)
        const { nextStepSuggestedTask } = require('../../utils/backends/Tasks/tasksFirestore')
        const { tree } = renderModal()

        tree.root.findByProps({ title: 'Go to next step' }).props.onPress()
        await flushAsync()

        expect(nextStepSuggestedTask).toHaveBeenCalledWith(PROJECT_ID, 'step-1', task, { '-1': 30 }, '', 'checkbox-1')
        expect(moveSuggestedTaskToDoneBypassingWorkflow).not.toHaveBeenCalled()
    })
})
/**
 * AT-2495 — the suggested-task popup opens from a press and hold on the checkbox, so the actions
 * that take the task out of the list play the same row animation ticking the checkbox does.
 *
 * The distinction that matters here is between "the task moved on" and "the task is finished":
 * only the latter is celebrated, and accepting a suggestion is neither.
 */
describe('SuggestedModal row completion animation (AT-2495)', () => {
    const withWorkflow = { 'step-1': { description: 'Review' } }
    const makeMotion = () => ({ begin: jest.fn(() => 0), cancel: jest.fn() })
    const flush = () => flushAsync()

    const setUser = (workflow = withWorkflow) => {
        store.getState.mockReturnValue({
            smallScreenNavigation: false,
            loggedUser: { uid: 'owner-1' },
            currentUser: { uid: 'owner-1', workflow: { [PROJECT_ID]: workflow } },
        })
    }

    beforeEach(() => {
        jest.clearAllMocks()
        getSuggestedTaskBypassLabel.mockReturnValue('Bypass workflow and mark done')
        canBypassSuggestedTaskWorkflow.mockReturnValue(true)
        setUser()
    })

    it('celebrates the bypass, which completes the task outright', async () => {
        const completionMotion = makeMotion()
        const { tree } = renderModal({ completionMotion })

        tree.root.findByProps({ testID: 'bypass-workflow-button' }).props.onPress()
        await flush()

        expect(completionMotion.begin).toHaveBeenCalledWith({ isCompletion: true })
        expect(moveSuggestedTaskToDoneBypassingWorkflow).toHaveBeenCalledTimes(1)
    })

    it('celebrates the next step when there is no workflow to enter, so it lands on Done', async () => {
        const { nextStepSuggestedTask } = require('../../utils/backends/Tasks/tasksFirestore')
        setUser({})
        const completionMotion = makeMotion()
        const { tree } = renderModal({ completionMotion })

        tree.root.findByProps({ title: 'Go to next step' }).props.onPress()
        await flush()

        expect(completionMotion.begin).toHaveBeenCalledWith({ isCompletion: true })
        expect(nextStepSuggestedTask).toHaveBeenCalledWith(PROJECT_ID, -2, task, { '-1': 30 }, '', 'checkbox-1')
    })

    it('exits without celebrating when the next step enters the workflow', async () => {
        const completionMotion = makeMotion()
        const { tree } = renderModal({ completionMotion })

        tree.root.findByProps({ title: 'Go to next step' }).props.onPress()
        await flush()

        expect(completionMotion.begin).toHaveBeenCalledWith({ isCompletion: false })
    })

    /**
     * Accepting hands the task to its new owner and leaves it OPEN. Nothing is completed and
     * nothing has to be swept off the list, so the row must be left entirely alone.
     */
    it('does not touch the row when the suggestion is merely accepted', async () => {
        const completionMotion = makeMotion()
        const { tree } = renderModal({ completionMotion })

        tree.root.findByProps({ title: 'Accept' }).props.onPress()
        await flush()

        expect(completionMotion.begin).not.toHaveBeenCalled()
        expect(completionMotion.cancel).not.toHaveBeenCalled()
    })

    it('puts the row back when the write fails', async () => {
        moveSuggestedTaskToDoneBypassingWorkflow.mockRejectedValueOnce(new Error('permission-denied'))
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
        const completionMotion = makeMotion()
        const { tree } = renderModal({ completionMotion })

        tree.root.findByProps({ testID: 'bypass-workflow-button' }).props.onPress()
        await flush()

        expect(completionMotion.cancel).toHaveBeenCalledTimes(1)
        expect(consoleError).toHaveBeenCalled()
        consoleError.mockRestore()
    })

    it('still writes when no row motion is available', async () => {
        const { tree } = renderModal()

        tree.root.findByProps({ testID: 'bypass-workflow-button' }).props.onPress()
        await flush()

        expect(moveSuggestedTaskToDoneBypassingWorkflow).toHaveBeenCalledTimes(1)
    })
})
