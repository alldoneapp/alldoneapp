import React from 'react'
import renderer, { act } from 'react-test-renderer'

/**
 * AT-2495 — the default long-press popup.
 *
 * Press and hold a task's checkbox and, unless the owner has a workflow in the project, this is
 * what opens. "I am all done" writes the completion straight to Firestore, so before this change
 * the task simply blinked out of the list while ticking the very same checkbox played the full
 * AT-2404 animation.
 *
 * The subtle one here is the attachment upload: it is started while the row is animating rather
 * than in front of it, so a completion comment carrying a file costs no extra wall clock unless
 * the upload outlasts the whole run.
 */

jest.mock('react-hot-keys', () => 'Hotkeys')
jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector => selector({ smallScreenNavigation: false }),
}))
jest.mock('../../redux/store', () => ({
    getState: jest.fn(() => ({ isQuillTagEditorOpen: false, openModals: {} })),
    dispatch: jest.fn(),
}))
jest.mock('../../redux/actions', () => ({ setLastSelectedDueDate: jest.fn() }))
jest.mock('../../i18n/TranslationService', () => ({ translate: text => text }))
jest.mock('../../utils/HelperFunctions', () => ({ applyPopoverWidth: () => ({}) }))
jest.mock('../../utils/EstimationHelper', () => ({ getEstimationIconByValue: () => 1 }))
jest.mock('../Feeds/Utils/HelperFunctions', () => ({
    STAYWARD_COMMENT: 'stayward',
    updateNewAttachmentsData: jest.fn((projectId, comment) => Promise.resolve(comment)),
}))
jest.mock('../../utils/backends/Tasks/tasksFirestore', () => ({
    createFollowUpTask: jest.fn(),
    moveTasksFromOpen: jest.fn().mockResolvedValue(undefined),
    setTaskAutoEstimation: jest.fn(),
}))
jest.mock('../TaskListView/Utils/TasksHelper', () => ({
    __esModule: true,
    OPEN_STEP: '-1',
    DONE_STEP: -2,
    BACKLOG_DATE_NUMERIC: 8640000000000000,
    getTaskAutoEstimation: () => null,
}))
jest.mock('../ModalsManager/modalsManager', () => ({
    FOLLOW_UP_MODAL_ID: 'follow-up',
    MENTION_MODAL_ID: 'mention',
    removeModal: jest.fn(),
    storeModal: jest.fn(),
}))
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
jest.mock('../UIControls/Button', () => 'Button')
jest.mock('../UIControls/Shortcut', () => ({ __esModule: true, default: 'Shortcut', SHORTCUT_LIGHT: 'light' }))
jest.mock('../Icon', () => 'Icon')
jest.mock('./CloseButton', () => 'CloseButton')
jest.mock('./AttachmentsTag', () => 'AttachmentsTag')
jest.mock('./FollowUpDueDate', () => 'FollowUpDueDate')
jest.mock('./CustomFollowUpDateModal', () => 'CustomFollowUpDateModal')

import FollowUpModal from './FollowUpModal'
import { moveTasksFromOpen } from '../../utils/backends/Tasks/tasksFirestore'
import { updateNewAttachmentsData } from '../Feeds/Utils/HelperFunctions'

const PROJECT_ID = 'project-1'
const task = { id: 'task-1', name: 'Buy milk', estimations: { '-1': 15 } }

const makeMotion = (holdMs = 0) => ({ begin: jest.fn(() => holdMs), cancel: jest.fn() })

const renderModal = completionMotion => {
    const hidePopover = jest.fn()
    let tree
    act(() => {
        tree = renderer.create(
            <FollowUpModal
                task={task}
                projectId={PROJECT_ID}
                checkBoxId="checkbox-1"
                hidePopover={hidePopover}
                cancelPopover={jest.fn()}
                completionMotion={completionMotion}
            />
        )
    })
    return { tree, hidePopover }
}

// The button defers by 100ms of its own before it even calls the completion.
const pressDone = async tree => {
    act(() => tree.root.findByProps({ title: 'I am all done' }).props.onPress())
    await act(async () => {
        jest.advanceTimersByTime(100)
        await Promise.resolve()
        await Promise.resolve()
    })
}

describe('FollowUpModal completion animation (AT-2495)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        jest.useFakeTimers()
        updateNewAttachmentsData.mockImplementation((projectId, comment) => Promise.resolve(comment))
        moveTasksFromOpen.mockResolvedValue(undefined)
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('plays the row completion and then writes', async () => {
        const completionMotion = makeMotion()
        const { tree } = renderModal(completionMotion)

        await pressDone(tree)

        expect(completionMotion.begin).toHaveBeenCalledWith({ isCompletion: true })
        expect(moveTasksFromOpen).toHaveBeenCalledTimes(1)
        expect(moveTasksFromOpen.mock.calls[0][2]).toBe(-2)
    })

    it('closes the popup before the row animates', async () => {
        const order = []
        const completionMotion = { begin: jest.fn(() => (order.push('animate'), 0)), cancel: jest.fn() }
        const { tree, hidePopover } = renderModal(completionMotion)
        hidePopover.mockImplementation(() => order.push('hide'))
        moveTasksFromOpen.mockImplementationOnce(() => {
            order.push('write')
            return Promise.resolve()
        })

        await pressDone(tree)

        expect(order).toEqual(['hide', 'animate', 'write'])
    })

    it('holds the write until the row has finished animating', async () => {
        const completionMotion = makeMotion(1070)
        const { tree } = renderModal(completionMotion)

        act(() => tree.root.findByProps({ title: 'I am all done' }).props.onPress())
        await act(async () => {
            jest.advanceTimersByTime(100)
            await Promise.resolve()
            await Promise.resolve()
        })

        expect(completionMotion.begin).toHaveBeenCalled()
        expect(moveTasksFromOpen).not.toHaveBeenCalled()

        await act(async () => {
            jest.advanceTimersByTime(1070)
            await Promise.resolve()
            await Promise.resolve()
        })

        expect(moveTasksFromOpen).toHaveBeenCalledTimes(1)
    })

    /**
     * The whole reason the hold is measured from the moment the motion started: an upload that has
     * already outlasted the animation must not make the user wait for it a second time.
     */
    it('runs the attachment upload inside the animation rather than in front of it', async () => {
        const completionMotion = makeMotion(1000)
        let finishUpload
        updateNewAttachmentsData.mockImplementationOnce(
            () => new Promise(resolve => (finishUpload = () => resolve('')))
        )
        const { tree } = renderModal(completionMotion)

        act(() => tree.root.findByProps({ title: 'I am all done' }).props.onPress())
        await act(async () => {
            jest.advanceTimersByTime(100)
            await Promise.resolve()
        })

        // The animation is already running while the upload is still in flight.
        expect(completionMotion.begin).toHaveBeenCalled()
        expect(updateNewAttachmentsData).toHaveBeenCalled()

        // The upload takes longer than the whole animation, so no further wait is owed.
        await act(async () => {
            jest.advanceTimersByTime(1500)
            finishUpload()
            await Promise.resolve()
            await Promise.resolve()
        })

        expect(moveTasksFromOpen).toHaveBeenCalledTimes(1)
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

    it('still writes with no row motion attached', async () => {
        const { tree } = renderModal(undefined)

        await pressDone(tree)

        expect(moveTasksFromOpen).toHaveBeenCalledTimes(1)
    })
})
