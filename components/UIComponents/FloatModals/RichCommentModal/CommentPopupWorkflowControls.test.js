import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { StyleSheet, Text } from 'react-native'

import CommentPopupWorkflowControls, {
    getCommentPopupSelectableSteps,
    getCommentPopupWorkflowTargets,
} from './CommentPopupWorkflowControls'
import {
    moveTasksFromDone,
    moveTasksFromMiddleOfWorkflow,
    moveTasksFromOpen,
} from '../../../../utils/backends/Tasks/tasksFirestore'
import { colors } from '../../../styles/global'

jest.mock('uuid/v4', () => () => 'popup-workflow-action')
jest.mock('../../../../redux/store', () => ({ dispatch: jest.fn() }))
jest.mock('../../../../redux/actions', () => ({
    startLoadingData: () => ({ type: 'START_LOADING' }),
}))
jest.mock('../../../../utils/HelperFunctions', () => ({
    getWorkflowStepsIdsSorted: workflow => Object.keys(workflow),
}))
jest.mock('../../../../utils/backends/Tasks/tasksFirestore', () => ({
    moveTasksFromDone: jest.fn().mockResolvedValue(undefined),
    moveTasksFromMiddleOfWorkflow: jest.fn().mockResolvedValue(undefined),
    moveTasksFromOpen: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../../../WorkflowModal/MainButtons', () => 'MainButtons')
jest.mock('../../../Icon', () => 'Icon')
jest.mock('../../../../i18n/TranslationService', () => ({
    translate: (text, interpolations = {}) =>
        Object.entries(interpolations).reduce(
            (translated, [key, value]) => translated.replace(`%{${key}}`, value),
            text
                .replace('Select workflow step with name', 'Select workflow step: %{step}')
                .replace('Current workflow step with name', 'Current workflow step: %{step}')
        ),
}))
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
        moveTasksFromDone.mockResolvedValue(undefined)
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
        expect(buttons.props.narrow).toBe(false)
        expect(buttons.props.backwardStepName).toBe('Open')
        expect(buttons.props.forwardStepName).toBe('Second review')
        expect(tree.root.findByProps({ testID: 'comment-popup-workflow-selector' })).toBeTruthy()
    })

    it('uses Done as the forward destination from the last workflow step', () => {
        const tree = renderer.create(
            <CommentPopupWorkflowControls
                projectId="project-1"
                task={{ ...task, stepHistory: [-1, 'step1', 'step2'] }}
                workflow={workflow}
            />
        )
        const buttons = tree.root.findByType('MainButtons')

        expect(buttons.props.backwardStepName).toBe('First review')
        expect(buttons.props.forwardStepName).toBe('Done')
    })

    it('keeps long step names usable in a narrow mobile layout', async () => {
        const longStepName = 'Legal, compliance and executive stakeholder approval before publication'
        const longWorkflow = {
            [longStepName]: { description: longStepName },
            step2: workflow.step2,
        }
        const longTask = { ...task, stepHistory: [-1, longStepName] }
        const tree = renderer.create(
            <CommentPopupWorkflowControls
                projectId="project-1"
                task={longTask}
                workflow={longWorkflow}
                appearance="chat"
                narrow
            />
        )
        const selector = tree.root.findByProps({ testID: 'comment-popup-workflow-selector' })

        expect(selector.props.accessibilityLabel).toBe(`Select workflow step: ${longStepName}`)
        expect(selector.findByType(Text).props.numberOfLines).toBe(2)
        expect(StyleSheet.flatten(selector.props.style)).toMatchObject({
            height: 'auto',
            minHeight: 44,
        })
        expect(tree.root.findByType('MainButtons').props.narrow).toBe(true)

        await act(async () => Promise.resolve())
        act(() => selector.props.onPress())

        const currentStep = tree.root.findByProps({ testID: 'comment-popup-current-workflow-step' })
        expect(currentStep.findAllByType(Text)[0].props.numberOfLines).toBe(3)
        expect(currentStep.props.accessibilityLabel).toBe(`Select workflow step: ${longStepName}`)
    })

    it('uses the full chat color system and hover state for the chat appearance', async () => {
        const tree = renderer.create(
            <CommentPopupWorkflowControls projectId="project-1" task={task} workflow={workflow} appearance="chat" />
        )
        await act(async () => Promise.resolve())
        const container = tree.root.findByProps({ testID: 'comment-popup-workflow-controls' })
        const selector = tree.root.findByProps({ testID: 'comment-popup-workflow-selector' })

        expect(StyleSheet.flatten(container.props.style)).toEqual(
            expect.objectContaining({
                backgroundColor: colors.Grey100,
                borderBottomColor: colors.Gray300,
            })
        )
        expect(StyleSheet.flatten(selector.props.style)).toEqual(
            expect.objectContaining({
                backgroundColor: 'transparent',
                borderColor: colors.Gray300,
            })
        )

        act(() => selector.props.onMouseEnter())

        const hoveredSelector = tree.root.findByProps({ testID: 'comment-popup-workflow-selector' })
        expect(StyleSheet.flatten(hoveredSelector.props.style).backgroundColor).toBe(colors.Grey200)
        expect(hoveredSelector.findAllByType('Icon').map(icon => icon.props.color)).toEqual([
            colors.Text02,
            colors.Text02,
        ])
        expect(hoveredSelector.findByType(Text).props.style).toEqual(
            expect.arrayContaining([expect.objectContaining({ color: colors.Text02 })])
        )
    })

    it('keeps the existing dark popup color system by default', () => {
        const tree = renderer.create(
            <CommentPopupWorkflowControls projectId="project-1" task={task} workflow={workflow} />
        )
        const container = tree.root.findByProps({ testID: 'comment-popup-workflow-controls' })
        const selector = tree.root.findByProps({ testID: 'comment-popup-workflow-selector' })

        expect(StyleSheet.flatten(container.props.style).backgroundColor).toBe(colors.Secondary400)
        expect(StyleSheet.flatten(selector.props.style).backgroundColor).toBe(colors.Secondary250)
        expect(selector.findByType(Text).props.style).toEqual(
            expect.arrayContaining([expect.objectContaining({ color: 'white' })])
        )
    })

    it('offers every workflow step and identifies the current step', () => {
        expect(getCommentPopupSelectableSteps(task, workflow)).toEqual([
            { id: -1, label: 'Open', current: false },
            { id: 'step1', label: 'First review', current: true },
            { id: 'step2', label: 'Second review', current: false },
            { id: -2, label: 'Done', current: false },
        ])
    })

    it('shows the current workflow step before and after opening the selector', async () => {
        const tree = renderer.create(
            <CommentPopupWorkflowControls projectId="project-1" task={task} workflow={workflow} />
        )
        const selector = tree.root.findByProps({ testID: 'comment-popup-workflow-selector' })

        expect(selector.props.accessibilityLabel).toBe('Select workflow step: First review')
        expect(selector.findByType(Text).props.children).toBe('Current workflow step: First review')

        await act(async () => Promise.resolve())
        act(() => selector.props.onPress())

        const currentStep = tree.root.findByProps({ testID: 'comment-popup-current-workflow-step' })
        expect(currentStep.props.accessibilityState).toEqual({ selected: true, disabled: true })
        expect(currentStep.findAllByType(Text).map(text => text.props.children)).toEqual(['First review', 'Current'])
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

        // AT-2495 — the move is now issued from behind the row's completion handoff, so it lands
        // one microtask after the press even when no row motion is attached. The double-click
        // guard itself is still synchronous, which is exactly what this asserts: two presses,
        // one write.
        await act(async () => Promise.resolve())

        expect(moveTasksFromMiddleOfWorkflow).toHaveBeenCalledTimes(1)

        await act(async () => {
            finishMove()
            await firstMove
        })
    })

    it('uses the full chat loading color while a transition is pending', async () => {
        let finishMove
        moveTasksFromMiddleOfWorkflow.mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    finishMove = resolve
                })
        )
        const tree = renderer.create(
            <CommentPopupWorkflowControls projectId="project-1" task={task} workflow={workflow} appearance="chat" />
        )
        await act(async () => Promise.resolve())
        const buttons = tree.root.findByType('MainButtons')

        let pendingMove
        act(() => {
            pendingMove = buttons.props.onDonePress('FORWARD')
        })
        await act(async () => Promise.resolve())

        expect(tree.root.findByProps({ testID: 'workflow-transition-loading' }).props.color).toBe(colors.Primary100)
        expect(tree.root.findByType('MainButtons').props.disabled).toBe(true)

        await act(async () => {
            finishMove()
            await pendingMove
        })
    })

    it('uses the standard workflow move action in both directions', async () => {
        const onDirectionalTransitionSuccess = jest.fn()
        const tree = renderer.create(
            <CommentPopupWorkflowControls
                projectId="project-1"
                task={task}
                workflow={workflow}
                onDirectionalTransitionSuccess={onDirectionalTransitionSuccess}
            />
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
        expect(onDirectionalTransitionSuccess).toHaveBeenCalledTimes(1)

        const backTree = renderer.create(
            <CommentPopupWorkflowControls
                projectId="project-1"
                task={task}
                workflow={workflow}
                onDirectionalTransitionSuccess={onDirectionalTransitionSuccess}
            />
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
        expect(onDirectionalTransitionSuccess).toHaveBeenCalledTimes(2)
    })

    it('keeps the popup open when a directional transition fails', async () => {
        const error = new Error('transition failed')
        const onDirectionalTransitionSuccess = jest.fn()
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
        moveTasksFromMiddleOfWorkflow.mockRejectedValueOnce(error)
        const tree = renderer.create(
            <CommentPopupWorkflowControls
                projectId="project-1"
                task={task}
                workflow={workflow}
                onDirectionalTransitionSuccess={onDirectionalTransitionSuccess}
            />
        )

        await act(async () => tree.root.findByType('MainButtons').props.onDonePress('FORWARD'))

        expect(onDirectionalTransitionSuccess).not.toHaveBeenCalled()
        expect(tree.root.findByType('MainButtons').props.disabled).toBe(false)
        expect(consoleError).toHaveBeenCalledWith(
            '[CommentPopupWorkflowControls] Could not move task',
            expect.objectContaining({ error, source: 'FORWARD' })
        )
        consoleError.mockRestore()
    })

    it('does not close the popup after a successful direct step selection', async () => {
        const onDirectionalTransitionSuccess = jest.fn()
        const tree = renderer.create(
            <CommentPopupWorkflowControls
                projectId="project-1"
                task={task}
                workflow={workflow}
                onDirectionalTransitionSuccess={onDirectionalTransitionSuccess}
            />
        )

        await act(async () => Promise.resolve())
        act(() => tree.root.findByProps({ testID: 'comment-popup-workflow-selector' }).props.onPress())
        const done = tree.root.findByProps({ accessibilityLabel: 'Select workflow step: Done' })
        await act(async () => done.props.onPress())

        expect(onDirectionalTransitionSuccess).not.toHaveBeenCalled()
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

        // AT-2495 — the move is now issued from behind the row's completion handoff, so it lands
        // one microtask after the press even when no row motion is attached. The double-click
        // guard itself is still synchronous, which is exactly what this asserts: two presses,
        // one write.
        await act(async () => Promise.resolve())

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

    it('shows the first forward target for an open task, whether or not it is an assistant workflow task', () => {
        const openTargets = {
            currentStep: -1,
            currentStepId: -1,
            stepIds: ['step1', 'step2'],
            backwardStepId: null,
            forwardStepId: 'step1',
        }

        expect(getCommentPopupWorkflowTargets({ ...task, workflowTask: true, stepHistory: [-1] }, workflow)).toEqual(
            openTargets
        )
        // AT-2501 — a plain open task used to get nothing at all here.
        expect(getCommentPopupWorkflowTargets({ ...task, workflowTask: false, stepHistory: [-1] }, workflow)).toEqual(
            openTargets
        )
    })

    it('does not show workflow controls for a workflow without steps or a task on a deleted step', () => {
        expect(getCommentPopupWorkflowTargets({ ...task, workflowTask: true, stepHistory: [-1] }, {})).toBeNull()
        expect(getCommentPopupWorkflowTargets({ ...task, done: true }, {})).toBeNull()
        // A step id that is no longer part of the workflow stays unrepresentable rather than
        // silently reading as "Open".
        expect(getCommentPopupWorkflowTargets({ ...task, stepHistory: [-1, 'deleted'] }, workflow)).toBeNull()
    })

    describe('AT-2501 — the open and done states', () => {
        it('reports Done as the current position and offers only the way back', () => {
            expect(getCommentPopupWorkflowTargets({ ...task, done: true }, workflow)).toEqual({
                currentStep: -2,
                currentStepId: -2,
                stepIds: ['step1', 'step2'],
                // The step it was last reviewed at, not the last entry of a history that also
                // contains Open.
                backwardStepId: 'step1',
                forwardStepId: null,
            })
        })

        it('sends a task completed straight from open back to open', () => {
            expect(
                getCommentPopupWorkflowTargets({ ...task, done: true, userIds: ['owner'], stepHistory: [-1] }, workflow)
            ).toMatchObject({ currentStepId: -2, backwardStepId: -1, forwardStepId: null })
        })

        it('marks Done as the current entry in the step list', () => {
            expect(getCommentPopupSelectableSteps({ ...task, done: true }, workflow)).toEqual([
                { id: -1, label: 'Open', current: false },
                { id: 'step1', label: 'First review', current: false },
                { id: 'step2', label: 'Second review', current: false },
                { id: -2, label: 'Done', current: true },
            ])
        })

        it('hides the forward button for a done task and keeps it everywhere else', () => {
            const doneTree = renderer.create(
                <CommentPopupWorkflowControls
                    projectId="project-1"
                    task={{ ...task, done: true }}
                    workflow={workflow}
                />
            )

            expect(doneTree.root.findByType('MainButtons').props.hideForwardButton).toBe(true)
            expect(doneTree.root.findByType('MainButtons').props.backwardStepName).toBe('First review')

            const openTree = renderer.create(
                <CommentPopupWorkflowControls
                    projectId="project-1"
                    task={{ ...task, userIds: ['owner'], stepHistory: [-1] }}
                    workflow={workflow}
                />
            )

            expect(openTree.root.findByType('MainButtons').props.hideForwardButton).toBe(false)
            expect(openTree.root.findByType('MainButtons').props.forwardStepName).toBe('First review')
        })

        it('reopens a done task through the done transition, not the open or middle one', async () => {
            const tree = renderer.create(
                <CommentPopupWorkflowControls
                    projectId="project-1"
                    task={{ ...task, done: true }}
                    workflow={workflow}
                />
            )

            await act(async () => tree.root.findByType('MainButtons').props.onDonePress('BACKWARD'))

            expect(moveTasksFromDone).toHaveBeenCalledWith('project-1', { ...task, done: true }, 'step1')
            expect(moveTasksFromOpen).not.toHaveBeenCalled()
            expect(moveTasksFromMiddleOfWorkflow).not.toHaveBeenCalled()
        })

        it('jumps a done task to any selected step through the done transition', async () => {
            const doneTask = { ...task, done: true }
            const tree = renderer.create(
                <CommentPopupWorkflowControls projectId="project-1" task={doneTask} workflow={workflow} />
            )

            await act(async () => Promise.resolve())
            act(() => tree.root.findByProps({ testID: 'comment-popup-workflow-selector' }).props.onPress())
            const open = tree.root.findByProps({ accessibilityLabel: 'Select workflow step: Open' })
            await act(async () => open.props.onPress())

            expect(moveTasksFromDone).toHaveBeenCalledWith('project-1', doneTask, -1)
        })

        it('enters the workflow from the open state through the open transition', async () => {
            const openTask = { ...task, userIds: ['owner'], stepHistory: [-1] }
            const tree = renderer.create(
                <CommentPopupWorkflowControls projectId="project-1" task={openTask} workflow={workflow} />
            )

            await act(async () => tree.root.findByType('MainButtons').props.onDonePress('FORWARD'))

            expect(moveTasksFromOpen).toHaveBeenCalledWith(
                'project-1',
                openTask,
                'step1',
                null,
                null,
                task.estimations,
                'popup-workflow-action'
            )
            expect(moveTasksFromDone).not.toHaveBeenCalled()
        })

        it('never offers the workflow to a task whose checkbox would bypass it', () => {
            const openTask = { ...task, userIds: ['owner'], stepHistory: [-1] }

            for (const bypassing of [
                { isSubtask: true },
                { parentId: 'parent-1' },
                { isPrivate: true },
                { genericData: { type: 'dayRate' } },
                { calendarData: { start: 1 } },
                { executionMode: 'direct' },
                { gmailData: { messageId: 'gmail-1' } },
            ]) {
                expect(getCommentPopupWorkflowTargets({ ...openTask, ...bypassing }, workflow)).toBeNull()
                expect(getCommentPopupWorkflowTargets({ ...task, done: true, ...bypassing }, workflow)).toBeNull()
            }
        })

        it('leaves a task that is standing on a step exactly as it was', () => {
            // The established middle-of-workflow controls are proof enough that the task travels
            // through the workflow, so none of the bypass flags may take them away.
            expect(getCommentPopupWorkflowTargets({ ...task, isSubtask: true }, workflow)).toMatchObject({
                currentStep: 0,
                currentStepId: 'step1',
                backwardStepId: -1,
                forwardStepId: 'step2',
            })
        })

        it('keeps a gmail follow-up task in the workflow', () => {
            const followUp = {
                ...task,
                userIds: ['owner'],
                stepHistory: [-1],
                gmailData: { messageId: 'gmail-1', origin: 'gmail_label_follow_up' },
            }

            expect(getCommentPopupWorkflowTargets(followUp, workflow)).toMatchObject({ forwardStepId: 'step1' })
        })
    })

    it('shows the polished forward action and uses the open-task transition path for workflow entry', async () => {
        const openOwnedTask = { ...task, workflowTask: true, userIds: ['owner'], stepHistory: [-1] }
        const tree = renderer.create(
            <CommentPopupWorkflowControls projectId="project-1" task={openOwnedTask} workflow={workflow} />
        )
        const buttons = tree.root.findByType('MainButtons')

        expect(buttons.props.currentStep).toBe(-1)
        expect(buttons.props.backwardStepName).toBeUndefined()
        expect(buttons.props.forwardStepName).toBe('First review')
        expect(tree.root.findByProps({ testID: 'comment-popup-workflow-selector' }).props.accessibilityLabel).toBe(
            'Select workflow step: Open'
        )

        await act(async () => buttons.props.onDonePress('FORWARD'))

        expect(moveTasksFromOpen).toHaveBeenCalledWith(
            'project-1',
            openOwnedTask,
            'step1',
            null,
            null,
            task.estimations,
            'popup-workflow-action'
        )
    })
    /**
     * AT-2495 — completing from the comment popup plays the same row animation the checkbox does.
     *
     * The header of that popup IS a real task row, so the motion is borrowed from it through the
     * `completionMotion` handoff. The two things that must not drift are which moves count as a
     * completion, and the fact that the write waits for the animation rather than racing it.
     */
    describe('row completion animation (AT-2495)', () => {
        const makeMotion = (holdMs = 0) => ({ begin: jest.fn(() => holdMs), cancel: jest.fn() })

        it('celebrates a move to Done', async () => {
            const completionMotion = makeMotion()
            const tree = renderer.create(
                <CommentPopupWorkflowControls
                    projectId="project-1"
                    task={task}
                    workflow={workflow}
                    completionMotion={completionMotion}
                />
            )
            await act(async () => Promise.resolve())
            act(() => tree.root.findByProps({ testID: 'comment-popup-workflow-selector' }).props.onPress())

            await act(async () =>
                tree.root.findByProps({ accessibilityLabel: 'Select workflow step: Done' }).props.onPress()
            )

            expect(completionMotion.begin).toHaveBeenCalledWith({ isCompletion: true })
        })

        /**
         * Handing a task to the next reviewer is not finishing it, so it must not be swept to
         * 100%, tinted green or celebrated at the checkbox — the same rule the checkbox applies.
         */
        it('does not celebrate a plain step advance', async () => {
            const completionMotion = makeMotion()
            const tree = renderer.create(
                <CommentPopupWorkflowControls
                    projectId="project-1"
                    task={task}
                    workflow={workflow}
                    completionMotion={completionMotion}
                />
            )

            await act(async () => tree.root.findByType('MainButtons').props.onDonePress('FORWARD'))

            expect(completionMotion.begin).toHaveBeenCalledWith({ isCompletion: false })
        })

        it('holds the write until the row has finished animating', async () => {
            jest.useFakeTimers()
            try {
                const completionMotion = makeMotion(1070)
                const tree = renderer.create(
                    <CommentPopupWorkflowControls
                        projectId="project-1"
                        task={task}
                        workflow={workflow}
                        completionMotion={completionMotion}
                    />
                )
                await act(async () => Promise.resolve())
                act(() => tree.root.findByProps({ testID: 'comment-popup-workflow-selector' }).props.onPress())

                let move
                act(() => {
                    move = tree.root.findByProps({ accessibilityLabel: 'Select workflow step: Done' }).props.onPress()
                })
                await act(async () => Promise.resolve())

                expect(moveTasksFromMiddleOfWorkflow).not.toHaveBeenCalled()

                await act(async () => {
                    jest.advanceTimersByTime(1070)
                    await move
                })

                expect(moveTasksFromMiddleOfWorkflow).toHaveBeenCalledTimes(1)
            } finally {
                jest.useRealTimers()
            }
        })

        /**
         * The row has already collapsed to zero height by the time the write is attempted, so a
         * failure that left it there would be an invisible row in the list.
         */
        it('puts the row back when the move fails', async () => {
            const completionMotion = makeMotion()
            moveTasksFromMiddleOfWorkflow.mockRejectedValueOnce(new Error('permission-denied'))
            const tree = renderer.create(
                <CommentPopupWorkflowControls
                    projectId="project-1"
                    task={task}
                    workflow={workflow}
                    completionMotion={completionMotion}
                />
            )

            await act(async () => tree.root.findByType('MainButtons').props.onDonePress('FORWARD'))

            expect(completionMotion.cancel).toHaveBeenCalledTimes(1)
        })

        it('leaves the row alone when the move succeeds', async () => {
            const completionMotion = makeMotion()
            const tree = renderer.create(
                <CommentPopupWorkflowControls
                    projectId="project-1"
                    task={task}
                    workflow={workflow}
                    completionMotion={completionMotion}
                />
            )

            await act(async () => tree.root.findByType('MainButtons').props.onDonePress('FORWARD'))

            expect(completionMotion.cancel).not.toHaveBeenCalled()
        })
    })
})
