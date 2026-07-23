import React from 'react'
import renderer, { act } from 'react-test-renderer'

import CommentPopupWorkflowControls, {
    getCommentPopupSelectableSteps,
    getCommentPopupWorkflowTargets,
} from './CommentPopupWorkflowControls'
import { moveTasksFromMiddleOfWorkflow, moveTasksFromOpen } from '../../../../utils/backends/Tasks/tasksFirestore'

jest.mock('uuid/v4', () => () => 'popup-workflow-action')
jest.mock('../../../../redux/store', () => ({ dispatch: jest.fn() }))
jest.mock('../../../../redux/actions', () => ({
    showTaskCompletionAnimation: () => ({ type: 'SHOW_COMPLETION' }),
    startLoadingData: () => ({ type: 'START_LOADING' }),
}))
jest.mock('../../../../utils/HelperFunctions', () => ({
    getWorkflowStepsIdsSorted: workflow => Object.keys(workflow),
}))
jest.mock('../../../../utils/backends/Tasks/tasksFirestore', () => ({
    moveTasksFromMiddleOfWorkflow: jest.fn().mockResolvedValue(undefined),
    moveTasksFromOpen: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../../../WorkflowModal/MainButtons', () => 'MainButtons')
jest.mock('../../../Icon', () => 'Icon')
jest.mock('../../../../i18n/TranslationService', () => ({ translate: text => text }))
jest.mock('../../../WorkflowModal/workflowDirections', () => ({
    WORKFLOW_BACKWARD: 'BACKWARD',
    WORKFLOW_FORWARD: 'FORWARD',
}))
jest.mock('../../../TaskListView/Utils/TasksHelper', () => ({
    DONE_STEP: -2,
    OPEN_STEP: -1,
}))

const workflow = {
    step1: { description: 'First review' },
    step2: { description: 'Second review' },
}

const task = {
    id: 'task-1',
    userIds: ['owner', 'reviewer'],
    stepHistory: [-1, 'step1'],
    estimations: { [-1]: 15 },
    done: false,
}

describe('CommentPopupWorkflowControls', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        moveTasksFromMiddleOfWorkflow.mockResolvedValue(undefined)
        moveTasksFromOpen.mockResolvedValue(undefined)
    })

    it('shows the established forward/back controls for a task on a workflow step', () => {
        const tree = renderer.create(
            <CommentPopupWorkflowControls projectId="project-1" task={task} workflow={workflow} />
        )
        const buttons = tree.root.findByType('MainButtons')

        expect(buttons.props.currentStep).toBe(0)
        expect(buttons.props.selectedCustomStep).toBe(false)
        expect(buttons.props.disabled).toBe(false)
        expect(buttons.props.shortcutsEnabled).toBe(false)
        expect(buttons.props.compact).toBe(true)
        expect(tree.root.findByProps({ testID: 'comment-popup-workflow-selector' })).toBeTruthy()
    })

    it('offers every workflow destination except the current step', () => {
        expect(getCommentPopupSelectableSteps(task, workflow)).toEqual([
            { id: -1, label: 'Open' },
            { id: 'step2', label: 'Second review' },
            { id: -2, label: 'Done' },
        ])
    })

    it('moves directly to a selected non-adjacent workflow step', async () => {
        const workflowWithThirdStep = {
            ...workflow,
            step3: { description: 'Final review' },
        }
        const taskOnThirdStep = { ...task, stepHistory: [-1, 'step1', 'step2', 'step3'] }
        const tree = renderer.create(
            <CommentPopupWorkflowControls
                projectId="project-1"
                task={taskOnThirdStep}
                workflow={workflowWithThirdStep}
            />
        )

        await act(async () => Promise.resolve())
        act(() => tree.root.findByProps({ testID: 'comment-popup-workflow-selector' }).props.onPress())
        const firstReview = tree.root.findByProps({ accessibilityLabel: 'Select workflow step: First review' })
        await act(async () => firstReview.props.onPress())

        expect(moveTasksFromMiddleOfWorkflow).toHaveBeenCalledWith(
            'project-1',
            taskOnThirdStep,
            'step1',
            null,
            null,
            task.estimations,
            'popup-workflow-action'
        )
    })

    it('uses the same double-click protection for direct selections', async () => {
        let finishMove
        moveTasksFromMiddleOfWorkflow.mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    finishMove = resolve
                })
        )
        const tree = renderer.create(
            <CommentPopupWorkflowControls projectId="project-1" task={task} workflow={workflow} />
        )
        await act(async () => Promise.resolve())
        act(() => tree.root.findByProps({ testID: 'comment-popup-workflow-selector' }).props.onPress())
        const done = tree.root.findByProps({ accessibilityLabel: 'Select workflow step: Done' })

        let firstMove
        act(() => {
            firstMove = done.props.onPress()
            done.props.onPress()
        })

        expect(moveTasksFromMiddleOfWorkflow).toHaveBeenCalledTimes(1)

        await act(async () => {
            finishMove()
            await firstMove
        })
    })

    it('uses the standard workflow move action in both directions', async () => {
        const tree = renderer.create(
            <CommentPopupWorkflowControls projectId="project-1" task={task} workflow={workflow} />
        )
        const buttons = tree.root.findByType('MainButtons')

        await act(async () => buttons.props.onDonePress('FORWARD'))

        expect(moveTasksFromMiddleOfWorkflow).toHaveBeenCalledWith(
            'project-1',
            task,
            'step2',
            null,
            null,
            task.estimations,
            'popup-workflow-action'
        )

        const backTree = renderer.create(
            <CommentPopupWorkflowControls projectId="project-1" task={task} workflow={workflow} />
        )
        await act(async () => backTree.root.findByType('MainButtons').props.onDonePress('BACKWARD'))

        expect(moveTasksFromMiddleOfWorkflow).toHaveBeenLastCalledWith(
            'project-1',
            task,
            -1,
            null,
            null,
            task.estimations,
            'popup-workflow-action'
        )
    })

    it('blocks repeated clicks while the first transition is in flight', async () => {
        let finishMove
        moveTasksFromMiddleOfWorkflow.mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    finishMove = resolve
                })
        )
        const tree = renderer.create(
            <CommentPopupWorkflowControls projectId="project-1" task={task} workflow={workflow} />
        )
        const move = tree.root.findByType('MainButtons').props.onDonePress

        let firstMove
        act(() => {
            firstMove = move('FORWARD')
            move('FORWARD')
        })

        expect(moveTasksFromMiddleOfWorkflow).toHaveBeenCalledTimes(1)

        await act(async () => {
            finishMove()
            await firstMove
        })
    })

    it('allows another action after the watched task reaches its next step', async () => {
        const tree = renderer.create(
            <CommentPopupWorkflowControls projectId="project-1" task={task} workflow={workflow} />
        )
        await act(async () => tree.root.findByType('MainButtons').props.onDonePress('FORWARD'))

        await act(async () => {
            tree.update(
                <CommentPopupWorkflowControls
                    projectId="project-1"
                    task={{ ...task, stepHistory: [-1, 'step1', 'step2'] }}
                    workflow={workflow}
                />
            )
        })

        expect(tree.root.findByType('MainButtons').props.disabled).toBe(false)
    })

    it('does not show workflow controls for open or completed tasks', () => {
        expect(getCommentPopupWorkflowTargets({ ...task, stepHistory: [-1] }, workflow)).toBeNull()
        expect(getCommentPopupWorkflowTargets({ ...task, done: true }, workflow)).toBeNull()
    })

    it('uses the open-task transition path for a workflow entry edge case', async () => {
        const openOwnedTask = { ...task, userIds: ['owner'] }
        const tree = renderer.create(
            <CommentPopupWorkflowControls projectId="project-1" task={openOwnedTask} workflow={workflow} />
        )

        await act(async () => tree.root.findByType('MainButtons').props.onDonePress('FORWARD'))

        expect(moveTasksFromOpen).toHaveBeenCalledWith(
            'project-1',
            openOwnedTask,
            'step2',
            null,
            null,
            task.estimations,
            'popup-workflow-action'
        )
    })
})
