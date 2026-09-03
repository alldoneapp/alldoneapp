import React from 'react'
import renderer, { act } from 'react-test-renderer'

/**
 * AT-2495 — the workflow popup is what a press and hold on the checkbox opens for a task whose
 * owner has a workflow in the project, and its "Done" button is the reported case: the task
 * vanished from the list with no animation while ticking the very same checkbox played the full
 * AT-2404 completion.
 *
 * What is asserted here is the ORDER, because that is where this can go wrong invisibly: the popup
 * must close before the row animates (it is anchored to the checkbox and centred on mobile, so it
 * covers the row), the write must wait for the animation rather than race it, and a failed write
 * must put the collapsed row back.
 */

jest.mock('react-hot-keys', () => 'Hotkeys')
jest.mock('../../redux/store', () => ({
    getState: jest.fn(() => ({ smallScreenNavigation: false, currentUser: { uid: 'owner-1' } })),
    subscribe: jest.fn(() => jest.fn()),
    dispatch: jest.fn(),
}))
jest.mock('../../redux/actions', () => ({
    startLoadingData: () => ({ type: 'START_LOADING' }),
    stopLoadingData: () => ({ type: 'STOP_LOADING' }),
}))
jest.mock('../../i18n/TranslationService', () => ({ translate: text => text }))
jest.mock('../../utils/HelperFunctions', () => ({
    applyPopoverWidth: () => ({}),
    chronoEntriesOrder: entries => entries,
    getWorkflowStepsIdsSorted: workflow => Object.keys(workflow || {}),
    getCommentDirectionWhenMoveTaskInTheWorklfow: () => 'forward',
    // The modal asks for the id of the step it is moving to; -2 is DONE below.
    getWorkflowStepId: (index, stepIds) => (index === -2 ? -2 : stepIds[index]),
}))
jest.mock('../Feeds/Utils/HelperFunctions', () => ({
    STAYWARD_COMMENT: 'stayward',
    updateNewAttachmentsData: jest.fn((projectId, comment) => Promise.resolve(comment)),
}))
jest.mock('../../utils/backends/Tasks/tasksFirestore', () => ({
    moveTasksFromMiddleOfWorkflow: jest.fn().mockResolvedValue(undefined),
    moveTasksFromOpen: jest.fn().mockResolvedValue(undefined),
    setTaskAutoEstimation: jest.fn(),
}))
jest.mock('./workflowBypass', () => ({ moveTaskToDoneBypassingWorkflow: jest.fn().mockResolvedValue(undefined) }))
jest.mock('./workflowNavigation', () => ({
    // 'DONE' and 'STEP' below stand in for the direction the buttons report; the modal turns them
    // into a target index, which `getWorkflowStepId` above turns into a step id.
    getWorkflowTargetStepIndex: direction => (direction === 'DONE' ? -2 : 0),
    getWorkflowTargetStepNames: () => ({}),
}))
jest.mock('./workflowCompletionCopy', () => ({ getWorkflowCompletionCopy: () => ({}) }))
jest.mock('../UIComponents/FloatModals/RecurringTaskDateBasisModal/RecurringTaskDateBasisModal', () => ({
    __esModule: true,
    default: () => null,
    shouldShowRecurringTaskDateBasisModal: () => false,
}))
jest.mock('../UIComponents/FloatModals/RichCommentModal/taskCommentAssistant', () => ({
    getTaskCommentAssistantProps: () => ({}),
}))
jest.mock('../UIComponents/FloatModals/EstimationModal/EstimationModal', () => 'EstimationModal')
jest.mock('../UIComponents/FloatModals/RichCommentModal/RichCommentModal', () => 'RichCommentModal')
jest.mock('../ContactsView/Utils/ContactsHelper', () => ({ getUserPresentationData: () => ({}) }))
jest.mock('../TaskListView/Utils/TasksHelper', () => ({
    __esModule: true,
    DONE_STEP: -2,
    OPEN_STEP: -1,
    getTaskAutoEstimation: () => null,
    default: { getTaskOwner: () => ({ uid: 'owner-1' }) },
}))
jest.mock('../ModalsManager/modalsManager', () => ({
    MENTION_MODAL_ID: 'mention',
    WORKFLOW_MODAL_ID: 'workflow',
    removeModal: jest.fn(),
    storeModal: jest.fn(),
}))
jest.mock('../UIControls/Shortcut', () => ({ __esModule: true, default: 'Shortcut', SHORTCUT_LIGHT: 'light' }))
jest.mock('../Icon', () => 'Icon')
jest.mock('../FollowUp/CloseButton', () => 'CloseButton')
jest.mock('../FollowUp/AttachmentsTag', () => 'AttachmentsTag')
jest.mock('../Tags/FileTag', () => 'FileTag')
jest.mock('./WorkflowSelection', () => 'WorkflowSelection')
jest.mock('./NextStep', () => 'NextStep')
jest.mock('./ChangeReviewerEstimation', () => 'ChangeReviewerEstimation')
jest.mock('./ChangeAssigneeEstimation', () => 'ChangeAssigneeEstimation')
jest.mock('./BypassWorkflowButton', () => 'BypassWorkflowButton')
jest.mock('./MainButtons', () => 'MainButtons')

import WorkflowModal from './WorkflowModal'
import { moveTasksFromOpen } from '../../utils/backends/Tasks/tasksFirestore'
import { moveTaskToDoneBypassingWorkflow } from './workflowBypass'

const PROJECT_ID = 'project-1'
const WORKFLOW = { 'step-1': { description: 'Review', index: 0 } }
const task = {
    id: 'task-1',
    name: 'Prepare the demo',
    userId: 'owner-1',
    userIds: ['owner-1'],
    estimations: { '-1': 30 },
    stepHistory: [-1],
}

const makeMotion = (holdMs = 0) => ({ begin: jest.fn(() => holdMs), cancel: jest.fn() })

const renderModal = (completionMotion, props = {}) => {
    const hidePopover = jest.fn()
    let tree
    act(() => {
        tree = renderer.create(
            <WorkflowModal
                task={task}
                projectId={PROJECT_ID}
                workflow={WORKFLOW}
                hidePopover={hidePopover}
                cancelPopover={jest.fn()}
                checkBoxId="checkbox-1"
                completionMotion={completionMotion}
                {...props}
            />
        )
    })
    return { tree, hidePopover }
}

const pressDone = async (tree, direction = 'DONE') => {
    await act(async () => {
        await tree.root.findByType('MainButtons').props.onDonePress(direction)
    })
}

describe('WorkflowModal completion animation (AT-2495)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('plays the row completion when the popup marks the task done', async () => {
        const completionMotion = makeMotion()
        const { tree } = renderModal(completionMotion)

        await pressDone(tree)

        expect(completionMotion.begin).toHaveBeenCalledWith({ isCompletion: true })
        expect(moveTasksFromOpen).toHaveBeenCalledTimes(1)
    })

    /**
     * Handing the task to the next reviewer is not finishing it. The row still leaves this list —
     * so it still exits — but it must not be swept to 100%, tinted green or celebrated.
     */
    it('exits without celebrating a plain step advance', async () => {
        const completionMotion = makeMotion()
        const { tree } = renderModal(completionMotion)

        await pressDone(tree, 'STEP')

        expect(completionMotion.begin).toHaveBeenCalledWith({ isCompletion: false })
    })

    it('closes the popup before the row animates, not after the write', async () => {
        const order = []
        const completionMotion = { begin: jest.fn(() => (order.push('animate'), 0)), cancel: jest.fn() }
        const { tree, hidePopover } = renderModal(completionMotion)
        hidePopover.mockImplementation(() => order.push('hide'))
        moveTasksFromOpen.mockImplementationOnce(() => {
            order.push('write')
            return Promise.resolve()
        })

        await pressDone(tree)

        // The popup covers the row it is animating, so this order is the whole point.
        expect(order).toEqual(['hide', 'animate', 'write'])
    })

    it('holds the write until the row has finished animating', async () => {
        jest.useFakeTimers()
        try {
            const completionMotion = makeMotion(1070)
            const { tree } = renderModal(completionMotion)

            let pending
            await act(async () => {
                pending = tree.root.findByType('MainButtons').props.onDonePress('DONE')
                await Promise.resolve()
                await Promise.resolve()
            })
            expect(moveTasksFromOpen).not.toHaveBeenCalled()

            await act(async () => {
                jest.advanceTimersByTime(1070)
                await pending
            })
            expect(moveTasksFromOpen).toHaveBeenCalledTimes(1)
        } finally {
            jest.useRealTimers()
        }
    })

    it('puts the collapsed row back when the write fails', async () => {
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
        moveTasksFromOpen.mockRejectedValueOnce(new Error('permission-denied'))
        const completionMotion = makeMotion()
        const { tree } = renderModal(completionMotion)

        await pressDone(tree)

        expect(completionMotion.cancel).toHaveBeenCalledTimes(1)
        expect(consoleError).toHaveBeenCalled()
        consoleError.mockRestore()
    })

    it('celebrates the bypass-workflow route to Done', async () => {
        const completionMotion = makeMotion()
        const { tree } = renderModal(completionMotion)

        await act(async () => {
            await tree.root.findByType('BypassWorkflowButton').props.onPress()
        })

        expect(completionMotion.begin).toHaveBeenCalledWith({ isCompletion: true })
        expect(moveTaskToDoneBypassingWorkflow).toHaveBeenCalledTimes(1)
    })

    it('still writes with no row motion attached', async () => {
        const { tree } = renderModal(undefined)

        await pressDone(tree)

        expect(moveTasksFromOpen).toHaveBeenCalledTimes(1)
    })
})
