/**
 * AT-2164 regression, end to end through the real bypass helper.
 *
 * Reported case: a Gmail follow-up task the assistant suggested, in a project where the user
 * has no workflow steps configured. Its Accept/Reject popup showed no bypass option, so there
 * was no way to accept the task and mark it Done — "Reject" hands the task back to the
 * assistant instead of moving it forward.
 *
 * Unlike SuggestedModal.test.js this suite deliberately does NOT mock `suggestedTaskBypass`,
 * so it covers the modal, the visibility rule and the label together.
 */
import React from 'react'
import renderer from 'react-test-renderer'

jest.mock('../../i18n/TranslationService', () => ({ translate: text => text }))
jest.mock('../../redux/store', () => ({
    getState: jest.fn(),
    subscribe: jest.fn(() => jest.fn()),
    dispatch: jest.fn(),
}))
jest.mock('../Feeds/Utils/HelperFunctions', () => ({
    FORDWARD_COMMENT: 'forward',
    updateNewAttachmentsData: jest.fn((projectId, comment) => Promise.resolve(comment)),
}))
jest.mock('../../utils/backends/Tasks/tasksFirestore', () => ({
    moveTasksFromMiddleOfWorkflow: jest.fn(),
    moveTasksFromOpen: jest.fn(),
    nextStepSuggestedTask: jest.fn(),
    setTaskAutoEstimation: jest.fn(),
    updateSubtasksState: jest.fn(),
    updateSuggestedTask: jest.fn(),
    updateTaskData: jest.fn(),
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
const { moveTasksFromOpen, updateTaskData } = require('../../utils/backends/Tasks/tasksFirestore')
const SuggestedModal = require('./SuggestedModal').default

const USER_ID = 'user-1'
const ASSISTANT_ID = 'assistant-1'
// The project the Gmail label routed the follow-up task into. The user has no workflow here.
const EMAIL_PROJECT_ID = 'project-without-workflow'
const WORKFLOW_PROJECT_ID = 'project-with-workflow'

const emailTask = {
    id: 'task-1',
    name: 'Check Google Play Console and register all affected apps',
    userId: USER_ID,
    userIds: [USER_ID],
    creatorId: ASSISTANT_ID,
    suggestedBy: ASSISTANT_ID,
    taskMetadata: { assistantSuggestion: { assistantId: ASSISTANT_ID } },
    gmailData: { origin: 'gmail_label_follow_up', threadId: 'thread-1', archiveOnComplete: true },
    subtaskIds: [],
    estimations: { '-1': 30 },
    observersIds: [],
    dueDateByObserversIds: {},
    estimationsByObserverIds: {},
    executionMode: 'workflow',
}

const renderModal = (projectId = EMAIL_PROJECT_ID, task = emailTask) => {
    const hidePopover = jest.fn()
    const tree = renderer.create(
        <SuggestedModal
            task={task}
            projectId={projectId}
            hidePopover={hidePopover}
            cancelPopover={jest.fn()}
            checkBoxId="checkbox-1"
        />
    )
    return { tree, hidePopover }
}

describe('suggested email task Accept/Reject popup', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        store.getState.mockReturnValue({
            smallScreenNavigation: false,
            loggedUser: { uid: USER_ID },
            currentUser: {
                uid: USER_ID,
                // Exactly the reported shape: workflow steps in another project, an empty map
                // for the project the email task landed in.
                workflow: {
                    [WORKFLOW_PROJECT_ID]: { 'step-1': { description: 'Review' } },
                    [EMAIL_PROJECT_ID]: {},
                },
            },
        })
    })

    it('is the Accept/Reject variant of the popup', () => {
        const { tree } = renderModal()

        expect(tree.root.findByProps({ title: 'Accept' })).toBeTruthy()
        expect(tree.root.findByProps({ title: 'Reject' })).toBeTruthy()
        expect(tree.root.findAllByProps({ title: 'Go to next step' })).toHaveLength(0)
    })

    it('offers a direct route to Done even though the project has no workflow', () => {
        const { tree } = renderModal()
        const bypass = tree.root.findByProps({ testID: 'bypass-workflow-button' })

        expect(bypass.props.accessibilityLabel).toBe('Accept and mark done')
    })

    it('accepts the suggestion and completes the task directly', async () => {
        const { tree, hidePopover } = renderModal()

        tree.root.findByProps({ testID: 'bypass-workflow-button' }).props.onPress()
        await Promise.resolve()

        expect(hidePopover).toHaveBeenCalledTimes(1)
        expect(updateTaskData).toHaveBeenCalledWith(EMAIL_PROJECT_ID, 'task-1', { suggestedBy: null }, null)
        expect(moveTasksFromOpen).toHaveBeenCalledWith(
            EMAIL_PROJECT_ID,
            expect.objectContaining({ id: 'task-1', executionMode: 'direct' }),
            -2,
            '',
            'forward',
            { '-1': 30 },
            'checkbox-1'
        )
        // The task the caller handed in must not be mutated.
        expect(emailTask.executionMode).toBe('workflow')
        expect(emailTask.suggestedBy).toBe(ASSISTANT_ID)
    })

    it('still calls the link a workflow bypass when the project does have a workflow', () => {
        const { tree } = renderModal(WORKFLOW_PROJECT_ID)

        expect(tree.root.findByProps({ testID: 'bypass-workflow-button' }).props.accessibilityLabel).toBe(
            'Bypass workflow'
        )
    })

    it('keeps hiding the bypass on a human suggestion without a workflow', () => {
        // Unchanged behaviour: there "Go to next step" already moves the task to Done.
        const humanTask = { ...emailTask, creatorId: 'colleague-1', suggestedBy: 'colleague-1', taskMetadata: null }
        const { tree } = renderModal(EMAIL_PROJECT_ID, humanTask)

        expect(tree.root.findAllByProps({ testID: 'bypass-workflow-button' })).toHaveLength(0)
        expect(tree.root.findByProps({ title: 'Go to next step' })).toBeTruthy()
    })
})
