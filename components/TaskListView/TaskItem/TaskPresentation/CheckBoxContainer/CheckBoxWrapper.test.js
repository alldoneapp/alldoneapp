import React from 'react'
import renderer, { act } from 'react-test-renderer'

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector => selector({ smallScreenNavigation: false }),
}))
jest.mock('react-tiny-popover', () => {
    const React = require('react')
    return ({ children, content, isOpen }) =>
        React.createElement(React.Fragment, null, children, isOpen ? content : null)
})
jest.mock('uuid/v4', () => () => 'checkbox-1')
jest.mock('../../../../../redux/store', () => ({
    getState: () => ({ loggedUser: { uid: 'logged-user' }, openModals: {}, isQuillTagEditorOpen: false }),
}))
jest.mock('../../../../../utils/BackendBridge', () => ({ getTaskData: jest.fn() }))
jest.mock('../../../../../redux/actions', () => ({ setAssignee: jest.fn() }))
jest.mock('../../../Utils/TasksHelper', () => ({
    __esModule: true,
    default: { getTaskOwner: jest.fn() },
    DONE_STEP: 'done',
    OPEN_STEP: 'open',
    TASK_ASSIGNEE_ASSISTANT_TYPE: 'assistant',
}))
jest.mock('../../../../../utils/HelperFunctions', () => ({
    getWorkflowStepsIdsSorted: require('../../../../../utils/workflowOrder').getWorkflowStepsIdsSorted,
    popoverToSafePosition: jest.fn(),
}))
jest.mock('../../../../Feeds/CommentsTextInput/textInputHelper', () => ({
    RECORD_SCREEN_MODAL_ID: 'record-screen',
    RECORD_VIDEO_MODAL_ID: 'record-video',
}))
jest.mock('../../../../ModalsManager/modalsManager', () => ({ MENTION_MODAL_ID: 'mention' }))
jest.mock('../../../../Workstreams/WorkstreamHelper', () => ({ WORKSTREAM_ID_PREFIX: 'ws_' }))
jest.mock('../../../../ContactsView/Utils/ContactsHelper', () => ({ getUserWorkflow: jest.fn() }))
jest.mock('../../../../Premium/PremiumHelper', () => ({ checkIsLimitedByXp: () => false }))
jest.mock('./TaskFlowModal', () => 'TaskFlowModal')
jest.mock('./CheckBoxContainer', () => 'CheckBoxContainer')
jest.mock('../../../../../utils/backends/Tasks/tasksFirestore', () => ({
    moveTasksFromDone: jest.fn(),
    moveTasksFromOpen: jest.fn().mockResolvedValue(undefined),
    setTaskStatus: jest.fn(),
}))
jest.mock('../../../../../utils/backends/EmailLine/emailLineBackend', () => ({
    performEmailLineAction: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../../../../UIComponents/FloatModals/RecurringTaskDateBasisModal/RecurringTaskDateBasisModal', () => ({
    __esModule: true,
    default: () => null,
    shouldShowRecurringTaskDateBasisModal: () => false,
}))
jest.mock('./EmailTaskCompletionModal', () => 'EmailTaskCompletionModal')
jest.mock('../../../../../i18n/TranslationService', () => ({ translate: text => text }))

import { moveTasksFromOpen, setTaskStatus } from '../../../../../utils/backends/Tasks/tasksFirestore'
import { COMPLETION_HOLD_MS, RETAINED_HOLD_MS } from '../taskCompletionMotion'
import { performEmailLineAction } from '../../../../../utils/backends/EmailLine/emailLineBackend'
import { getUserWorkflow } from '../../../../ContactsView/Utils/ContactsHelper'
import CheckBoxWrapper from './CheckBoxWrapper'

const baseTask = {
    id: 'task-1',
    userId: 'user-1',
    userIds: ['user-1'],
    isSubtask: false,
    done: false,
    estimations: { open: 15 },
    genericData: true,
    isPrivate: false,
    calendarData: null,
    gmailData: null,
}

const renderWrapper = (task, extraProps) =>
    renderer.create(
        <CheckBoxWrapper
            task={task}
            projectId={'project-1'}
            accessGranted={true}
            loggedUserCanUpdateObject={true}
            {...extraProps}
        />
    )

describe('CheckBoxWrapper task completion', () => {
    let consoleErrorSpy

    beforeEach(() => {
        jest.useFakeTimers()
        moveTasksFromOpen.mockClear()
        setTaskStatus.mockClear()
        setTaskStatus.mockResolvedValue(undefined)
        performEmailLineAction.mockClear()
        performEmailLineAction.mockResolvedValue(undefined)
        getUserWorkflow.mockReset()
        global.alert = jest.fn()
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        consoleErrorSpy.mockRestore()
        jest.useRealTimers()
    })

    test('regular tasks keep their direct completion behavior', async () => {
        const tree = renderWrapper(baseTask)

        act(() => {
            tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(false)
            tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(false)
        })
        expect(tree.root.findAllByType('EmailTaskCompletionModal')).toHaveLength(0)

        await act(async () => {
            jest.runAllTimers()
            await Promise.resolve()
        })
        expect(moveTasksFromOpen).toHaveBeenCalledTimes(1)
    })

    test.each([
        ['assistant without persisted assistant metadata', 'assistant-1'],
        ['human', 'user-2'],
    ])('opens the acceptance flow for an unresolved %s suggestion', (_description, suggestedBy) => {
        const task = { ...baseTask, suggestedBy }
        let tree
        act(() => {
            tree = renderWrapper(task)
        })

        act(() => tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(false))

        expect(tree.root.findByType('TaskFlowModal').props).toEqual(
            expect.objectContaining({ task, isSuggested: true })
        )
        expect(tree.root.findByType('CheckBoxContainer').props.checked).toBe(true)
        expect(moveTasksFromOpen).not.toHaveBeenCalled()
    })

    test.each([
        ['subtask', { isSubtask: true }],
        ['private task', { genericData: false, isPrivate: true }],
        ['calendar task', { genericData: false, calendarData: { eventId: 'event-1' } }],
        ['direct task', { genericData: false, executionMode: 'direct' }],
        ['workflow task', { genericData: false, workflowTask: true, userIds: ['user-1', 'reviewer-1'] }],
    ])('protects an unresolved human suggestion for a specialized %s', (_description, taskData) => {
        const task = { ...baseTask, ...taskData, suggestedBy: 'user-2' }
        const tree = renderWrapper(task)

        act(() => tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(false))

        expect(tree.root.findByType('TaskFlowModal').props.isSuggested).toBe(true)
        expect(moveTasksFromOpen).not.toHaveBeenCalled()
    })

    test('accepting a suggestion leaves it open and the next checkbox press completes it', async () => {
        const suggestedTask = { ...baseTask, suggestedBy: 'user-2' }
        const tree = renderWrapper(suggestedTask)

        act(() => tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(false))
        act(() => tree.root.findByType('TaskFlowModal').props.setVisiblePopover(false))
        expect(moveTasksFromOpen).not.toHaveBeenCalled()

        const acceptedTask = { ...suggestedTask, suggestedBy: null }
        act(() => {
            tree.update(
                <CheckBoxWrapper
                    task={acceptedTask}
                    projectId={'project-1'}
                    accessGranted={true}
                    loggedUserCanUpdateObject={true}
                />
            )
        })
        expect(tree.root.findByType('CheckBoxContainer').props.checked).toBe(false)

        act(() => tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(false))
        await act(async () => {
            jest.runAllTimers()
            await Promise.resolve()
        })

        expect(moveTasksFromOpen).toHaveBeenCalledTimes(1)
    })

    test.each([
        ['absent', undefined],
        ['null', null],
    ])('completes directly when workflow data is %s', async (_description, workflow) => {
        getUserWorkflow.mockReturnValue(workflow)
        const task = { ...baseTask, genericData: false }
        const tree = renderWrapper(task)

        expect(() => {
            act(() => tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(false))
        }).not.toThrow()

        await act(async () => {
            jest.runAllTimers()
            await Promise.resolve()
        })
        expect(moveTasksFromOpen).toHaveBeenCalledWith(
            'project-1',
            task,
            'done',
            null,
            null,
            task.estimations,
            'checkbox-1',
            undefined
        )
    })

    test('uses the first explicitly ordered step when workflow order is incomplete', async () => {
        getUserWorkflow.mockReturnValue({
            'legacy-step': null,
            'ordered-step': { sortIndex: 0 },
            'unordered-step': {},
        })
        const task = { ...baseTask, genericData: false }
        const tree = renderWrapper(task)

        act(() => tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(false))

        await act(async () => {
            jest.runAllTimers()
            await Promise.resolve()
        })
        expect(moveTasksFromOpen.mock.calls[0][2]).toBe('ordered-step')
    })

    test('bypasses an available workflow when the task is direct', async () => {
        getUserWorkflow.mockReturnValue({ 'workflow-step': { sortIndex: 0 } })
        const task = { ...baseTask, genericData: false, executionMode: 'direct' }
        const tree = renderWrapper(task)

        act(() => tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(false))

        await act(async () => {
            jest.runAllTimers()
            await Promise.resolve()
        })
        expect(moveTasksFromOpen.mock.calls[0][2]).toBe('done')
    })

    test('opens the workflow actions immediately when a workflow task checkbox is pressed', () => {
        const task = {
            ...baseTask,
            genericData: false,
            workflowTask: true,
            userIds: ['user-1', 'reviewer-1'],
            stepHistory: ['open', 'step-1'],
        }
        let tree
        act(() => {
            tree = renderWrapper(task)
        })

        act(() => tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(false))

        expect(tree.root.findByType('TaskFlowModal').props.task).toBe(task)
        expect(tree.root.findByType('CheckBoxContainer').props.checked).toBe(true)
        expect(moveTasksFromOpen).not.toHaveBeenCalled()
    })

    test('clears optimistic state when the mounted row advances between steps assigned to the same user', () => {
        const taskAtFirstStep = {
            ...baseTask,
            genericData: false,
            userIds: ['user-1', 'user-1'],
            currentReviewerId: 'user-1',
            stepHistory: ['open', 'step-1'],
        }
        let tree
        act(() => {
            tree = renderWrapper(taskAtFirstStep)
        })

        act(() => tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(true))
        expect(tree.root.findByType('CheckBoxContainer').props.checked).toBe(true)

        const taskAtSecondStep = {
            ...taskAtFirstStep,
            userIds: ['user-1', 'user-1', 'user-1'],
            stepHistory: ['open', 'step-1', 'step-2'],
        }
        act(() => {
            tree.update(
                <CheckBoxWrapper
                    task={taskAtSecondStep}
                    projectId={'project-1'}
                    accessGranted={true}
                    loggedUserCanUpdateObject={true}
                />
            )
        })

        expect(tree.root.findByType('CheckBoxContainer').props.checked).toBe(false)
    })

    test('keeps optimistic state during unrelated rerenders at the same workflow step', () => {
        const task = {
            ...baseTask,
            genericData: false,
            userIds: ['user-1', 'user-1'],
            currentReviewerId: 'user-1',
            stepHistory: ['open', 'step-1'],
        }
        let tree
        act(() => {
            tree = renderWrapper(task)
        })

        act(() => tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(true))
        act(() => {
            tree.update(
                <CheckBoxWrapper
                    task={{ ...task, name: 'Updated while transition is pending' }}
                    projectId={'project-1'}
                    accessGranted={true}
                    loggedUserCanUpdateObject={true}
                />
            )
        })

        expect(tree.root.findByType('CheckBoxContainer').props.checked).toBe(true)
    })

    test('email-linked tasks open the choice popup before completion', async () => {
        const task = {
            ...baseTask,
            gmailData: { connectionId: 'email_google_12345678', messageId: 'message-1' },
        }
        const tree = renderWrapper(task)

        act(() => tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(true))

        expect(moveTasksFromOpen).not.toHaveBeenCalled()
        const modal = tree.root.findByType('EmailTaskCompletionModal')
        await act(async () => {
            modal.props.onComplete(false)
            await Promise.resolve()
            jest.runAllTimers()
            await Promise.resolve()
        })

        expect(moveTasksFromOpen).toHaveBeenCalledTimes(1)
    })

    test('email-linked suggestions require acceptance before showing the archive choice', async () => {
        const suggestedTask = {
            ...baseTask,
            suggestedBy: 'user-2',
            gmailData: { connectionId: 'email_google_12345678', messageId: 'message-1' },
        }
        const tree = renderWrapper(suggestedTask)

        act(() => tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(false))

        expect(tree.root.findByType('TaskFlowModal').props.isSuggested).toBe(true)
        expect(tree.root.findAllByType('EmailTaskCompletionModal')).toHaveLength(0)
        expect(moveTasksFromOpen).not.toHaveBeenCalled()

        act(() => tree.root.findByType('TaskFlowModal').props.setVisiblePopover(false))
        const acceptedTask = { ...suggestedTask, suggestedBy: null }
        act(() => {
            tree.update(
                <CheckBoxWrapper
                    task={acceptedTask}
                    projectId={'project-1'}
                    accessGranted={true}
                    loggedUserCanUpdateObject={true}
                />
            )
        })
        act(() => tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(false))

        const emailCompletionModal = tree.root.findByType('EmailTaskCompletionModal')
        await act(async () => {
            emailCompletionModal.props.onComplete(false)
            await Promise.resolve()
            jest.runAllTimers()
            await Promise.resolve()
        })
        expect(moveTasksFromOpen).toHaveBeenCalledTimes(1)
    })

    test('closes the popup and starts task completion before background archiving finishes', async () => {
        let finishArchive
        performEmailLineAction.mockImplementation(
            () =>
                new Promise(resolve => {
                    finishArchive = resolve
                })
        )
        const task = {
            ...baseTask,
            gmailData: { connectionId: 'email_google_12345678', messageId: 'message-1' },
        }
        const tree = renderWrapper(task)

        act(() => tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(false))
        const modal = tree.root.findByType('EmailTaskCompletionModal')
        act(() => modal.props.onComplete(true))

        expect(tree.root.findAllByType('EmailTaskCompletionModal')).toHaveLength(0)
        expect(performEmailLineAction).toHaveBeenCalledWith('email_google_12345678', {
            action: 'archive',
            messageIds: ['message-1'],
        })

        await act(async () => {
            jest.runAllTimers()
            await Promise.resolve()
        })
        expect(moveTasksFromOpen).toHaveBeenCalledTimes(1)

        await act(async () => {
            finishArchive()
            await Promise.resolve()
        })
    })

    test('keeps the task completed and reports a background archive failure', async () => {
        const archiveError = Object.assign(new Error('authentication expired'), {
            code: 'functions/permission-denied',
        })
        performEmailLineAction.mockRejectedValue(archiveError)
        const task = {
            ...baseTask,
            gmailData: { connectionId: 'email_google_12345678', messageId: 'message-2' },
        }
        const tree = renderWrapper(task)

        act(() => tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(false))
        await act(async () => {
            tree.root.findByType('EmailTaskCompletionModal').props.onComplete(true)
            await Promise.resolve()
            jest.runAllTimers()
            await Promise.resolve()
        })

        expect(tree.root.findAllByType('EmailTaskCompletionModal')).toHaveLength(0)
        expect(tree.root.findByType('CheckBoxContainer').props.checked).toBe(true)
        expect(moveTasksFromOpen).toHaveBeenCalledTimes(1)
        expect(global.alert).toHaveBeenCalledWith("Email couldn't be archived: authentication expired")
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            '[email task completion] Could not archive linked email in background',
            archiveError
        )
    })

    /**
     * AT-2404. The row owns the animation; the checkbox only starts it and is TOLD how long to wait
     * before writing. That handshake is the whole contract between the two, and getting it wrong is
     * invisible in the UI — the task still completes, it just completes over the wrong animation,
     * or writes while the row is still visibly mid-collapse.
     */
    describe('completion motion handshake', () => {
        test('starts the row animation and holds the write for exactly the returned duration', async () => {
            const beginCompletionMotion = jest.fn(() => 120)
            const tree = renderWrapper(baseTask, { beginCompletionMotion })

            act(() => tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(false))

            expect(beginCompletionMotion).toHaveBeenCalledWith({ strikeThrough: true })

            await act(async () => {
                jest.advanceTimersByTime(119)
                await Promise.resolve()
            })
            // Writing early would let the snapshot pull the row out from under its own animation.
            expect(moveTasksFromOpen).not.toHaveBeenCalled()

            await act(async () => {
                jest.advanceTimersByTime(1)
                await Promise.resolve()
            })
            expect(moveTasksFromOpen).toHaveBeenCalledTimes(1)
        })

        test('does not cross out a workflow task that is only advancing to its next step', async () => {
            getUserWorkflow.mockReturnValue({ 'ordered-step': { sortIndex: 0 } })
            const beginCompletionMotion = jest.fn(() => 1)
            const tree = renderWrapper({ ...baseTask, genericData: false }, { beginCompletionMotion })

            act(() => tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(false))

            // The row still animates out — it is leaving this list — but the task is NOT done, so
            // it must not be shown struck through or tinted with the success colour.
            expect(beginCompletionMotion).toHaveBeenCalledWith({ strikeThrough: false })

            await act(async () => {
                jest.runAllTimers()
                await Promise.resolve()
            })
            expect(moveTasksFromOpen.mock.calls[0][2]).toBe('ordered-step')
        })

        test('crosses out a subtask being completed', async () => {
            const beginCompletionMotion = jest.fn(() => 1)
            renderWrapper({ ...baseTask, isSubtask: true }, { beginCompletionMotion })
                .root.findByType('CheckBoxContainer')
                .props.onCheckboxPress(false)

            expect(beginCompletionMotion).toHaveBeenCalledWith({ strikeThrough: true })
        })

        test('restores the row when the write fails', async () => {
            const failure = new Error('offline')
            moveTasksFromOpen.mockRejectedValueOnce(failure)
            const cancelCompletionMotion = jest.fn()
            const tree = renderWrapper(baseTask, { beginCompletionMotion: () => 1, cancelCompletionMotion })

            act(() => tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(false))
            await act(async () => {
                jest.runAllTimers()
                await Promise.resolve()
                await Promise.resolve()
            })

            // Otherwise the failed completion leaves an invisible, zero-height row in the list.
            expect(cancelCompletionMotion).toHaveBeenCalled()
            expect(tree.root.findByType('CheckBoxContainer').props.checked).toBe(false)
        })

        test('holds a subtask for less time than a collapsing row, even with no row handler', async () => {
            // The buffer on a collapsing row exists purely to keep the write behind the collapse.
            // A subtask never collapses, so making the user wait for it would be dead time.
            const tree = renderWrapper({ ...baseTask, isSubtask: true })

            act(() => tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(false))
            await act(async () => {
                jest.advanceTimersByTime(RETAINED_HOLD_MS)
                await Promise.resolve()
            })

            expect(setTaskStatus).toHaveBeenCalledTimes(1)
            expect(RETAINED_HOLD_MS).toBeLessThan(COMPLETION_HOLD_MS)
        })

        test.each([
            ['an ordinary row', {}],
            // Four render branches in this component differ only in which popover wraps the
            // checkbox. Repeating twenty props four times is how a new one lands on three of them
            // and silently does nothing on the fourth, so they share one spread — pinned here on
            // the branch furthest from the default.
            [
                'a row showing the email completion modal',
                { gmailData: { connectionId: 'email_google_12345678', messageId: 'message-1' } },
            ],
        ])('forwards the checkbox celebration through %s', (_description, taskOverrides) => {
            const completionCelebration = { punch: 'punch', burst: 'burst', opacity: 'opacity', animated: true }
            const tree = renderWrapper({ ...baseTask, ...taskOverrides }, { completionCelebration })

            if (taskOverrides.gmailData) {
                act(() => tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(false))
                expect(tree.root.findAllByType('EmailTaskCompletionModal')).toHaveLength(1)
            }

            expect(tree.root.findByType('CheckBoxContainer').props.completionCelebration).toBe(completionCelebration)
        })

        test('completes normally when no row handler is supplied', async () => {
            // CheckBoxWrapper must stay usable on its own — the animation is the row's contribution,
            // not a prerequisite for completing a task.
            const tree = renderWrapper(baseTask)

            act(() => tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(false))
            await act(async () => {
                jest.runAllTimers()
                await Promise.resolve()
            })

            expect(moveTasksFromOpen).toHaveBeenCalledTimes(1)
        })
    })
})
