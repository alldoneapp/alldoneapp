/**
 * @jest-environment jsdom
 */

// AT-2084 regression coverage.
//
// `CommentButton` renders in the inline task editor, OUTSIDE any Chat DV, and used to read the raw
// global `state.assistantEnabled` to decide between posting the comment immediately and deferring it
// until the task edit is saved. That global flag can be armed for a completely different chat by
// `createBotQuickTopic` / `generateTaskFromPreConfig` (`skipNavigation: true`), so a leak silently
// changed the button's behavior for an unrelated task.
//
// The tests below pin BOTH directions: a foreign scope must be ignored, and the two legitimate
// shapes (scope matching this task, and an unscoped in-modal flag) must keep behaving exactly as
// before.

import React from 'react'
import renderer, { act } from 'react-test-renderer'

import CommentButton from './CommentButton'
import { createObjectMessage } from '../../utils/backends/Chats/chatsComments'
import { buildAssistantEnabledScope } from '../ChatsView/Utils/assistantEnabledScope'

const PROJECT_ID = 'project-1'
const TASK_ID = 'task-1'

const mockState = {
    smallScreen: false,
    isQuillTagEditorOpen: false,
    openModals: {},
    assistantEnabled: false,
    assistantEnabledScope: null,
}

const mockDispatch = jest.fn()

jest.mock('../../redux/store', () => ({
    __esModule: true,
    default: {
        getState: () => mockState,
        dispatch: (...args) => mockDispatch(...args),
        subscribe: jest.fn(() => jest.fn()),
    },
}))

jest.mock('react-tiny-popover', () => {
    const React = require('react')
    return ({ children, content, isOpen }) => (
        <React.Fragment>
            {children}
            {isOpen ? content : null}
        </React.Fragment>
    )
})
jest.mock('react-hot-keys', () => ({ children }) => children)
jest.mock('./GhostButton', () => 'GhostButton')
jest.mock('../UIComponents/FloatModals/RichCommentModal/RichCommentModal', () => 'RichCommentModal')
jest.mock('../../utils/HelperFunctions', () => ({
    execShortcutFn: jest.fn(),
    popoverToTop: jest.fn(),
}))
jest.mock('../Feeds/CommentsTextInput/textInputHelper', () => ({
    RECORD_VIDEO_MODAL_ID: 'RECORD_VIDEO_MODAL_ID',
    RECORD_SCREEN_MODAL_ID: 'RECORD_SCREEN_MODAL_ID',
}))
jest.mock('../ModalsManager/modalsManager', () => ({
    BOT_OPTION_MODAL_ID: 'BOT_OPTION_MODAL_ID',
    BOT_WARNING_MODAL_ID: 'BOT_WARNING_MODAL_ID',
    MENTION_MODAL_ID: 'MENTION_MODAL_ID',
    RUN_OUT_OF_GOLD_MODAL_ID: 'RUN_OUT_OF_GOLD_MODAL_ID',
}))
jest.mock('../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../Feeds/Utils/HelperFunctions', () => ({ STAYWARD_COMMENT: 'STAYWARD_COMMENT' }))
jest.mock('../../utils/backends/Chats/chatsComments', () => ({ createObjectMessage: jest.fn() }))
jest.mock('../../hooks/useFloatPopupLock', () => ({
    createFloatPopupLock: () => ({ acquire: jest.fn(), release: jest.fn(), isAcquired: () => false }),
}))

const submitComment = (task = { id: TASK_ID, name: 'Task', userId: 'user-1' }) => {
    const saveCommentBeforeSaveTask = jest.fn()
    const tree = renderer.create(
        <CommentButton
            projectId={PROJECT_ID}
            task={task}
            saveCommentBeforeSaveTask={saveCommentBeforeSaveTask}
            shortcutText={'C'}
        />
    )

    // Open the popover so the real RichCommentModal slot is mounted, then invoke the exact callback
    // the modal calls on submit.
    act(() => {
        tree.root.instance.showPopover()
    })

    const { processDone } = tree.root.findByType('RichCommentModal').props
    act(() => {
        processDone('a comment', [], false, false, /* explicitAssistantEnabled */ true)
    })

    return { tree, saveCommentBeforeSaveTask }
}

describe('CommentButton assistant-enabled scoping (AT-2084)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockState.assistantEnabled = false
        mockState.assistantEnabledScope = null
        mockState.openModals = {}
        mockState.isQuillTagEditorOpen = false
    })

    it('defers the comment when the flag is armed for another task', () => {
        mockState.assistantEnabled = true
        mockState.assistantEnabledScope = buildAssistantEnabledScope(PROJECT_ID, 'task-created-from-my-day')

        const { tree, saveCommentBeforeSaveTask } = submitComment()

        expect(createObjectMessage).not.toHaveBeenCalled()
        expect(saveCommentBeforeSaveTask).toHaveBeenCalledWith('a comment')

        tree.unmount()
    })

    it('defers the comment when the flag is armed for the same object id in another project', () => {
        mockState.assistantEnabled = true
        mockState.assistantEnabledScope = buildAssistantEnabledScope('other-project', TASK_ID)

        const { tree, saveCommentBeforeSaveTask } = submitComment()

        expect(createObjectMessage).not.toHaveBeenCalled()
        expect(saveCommentBeforeSaveTask).toHaveBeenCalledWith('a comment')

        tree.unmount()
    })

    // Preserved behavior: the assistant was switched on for THIS task, so the comment is posted
    // right away instead of waiting for the task edit to be saved.
    it('posts immediately when the flag is armed for this exact task', () => {
        mockState.assistantEnabled = true
        mockState.assistantEnabledScope = buildAssistantEnabledScope(PROJECT_ID, TASK_ID)

        const { tree, saveCommentBeforeSaveTask } = submitComment()

        expect(saveCommentBeforeSaveTask).not.toHaveBeenCalled()
        expect(createObjectMessage).toHaveBeenCalledTimes(1)
        const call = createObjectMessage.mock.calls[0]
        expect(call[0]).toBe(PROJECT_ID)
        expect(call[1]).toBe(TASK_ID)
        expect(call[2]).toBe('a comment')
        expect(call[3]).toBe('tasks')
        // The explicit value the modal computed from the PERSISTED thread state must be forwarded
        // untouched — the scoping fix only gates send-now vs. deferred.
        expect(call[8]).toBe(true)

        tree.unmount()
    })

    // Preserved behavior: RichCommentModal itself dispatches an UNSCOPED `setAssistantEnabled` for
    // the object being commented on, and every in-chat writer does the same. That must keep working.
    it('posts immediately when the flag is unscoped', () => {
        mockState.assistantEnabled = true
        mockState.assistantEnabledScope = null

        const { tree, saveCommentBeforeSaveTask } = submitComment()

        expect(saveCommentBeforeSaveTask).not.toHaveBeenCalled()
        expect(createObjectMessage).toHaveBeenCalledTimes(1)

        tree.unmount()
    })

    // Negative control: the fix must not turn "assistant off" into "post now".
    it('defers the comment when the assistant is off', () => {
        mockState.assistantEnabled = false
        mockState.assistantEnabledScope = null

        const { tree, saveCommentBeforeSaveTask } = submitComment()

        expect(createObjectMessage).not.toHaveBeenCalled()
        expect(saveCommentBeforeSaveTask).toHaveBeenCalledWith('a comment')

        tree.unmount()
    })

    // Defensive: without an object identity a scoped flag cannot be proven to belong here, so the
    // safe (deferred) branch is taken.
    it('defers the comment when the task has no id yet and the flag is scoped elsewhere', () => {
        mockState.assistantEnabled = true
        mockState.assistantEnabledScope = buildAssistantEnabledScope(PROJECT_ID, 'some-other-topic')

        const { tree, saveCommentBeforeSaveTask } = submitComment({ id: undefined, name: 'Task', userId: 'user-1' })

        expect(createObjectMessage).not.toHaveBeenCalled()
        expect(saveCommentBeforeSaveTask).toHaveBeenCalledWith('a comment')

        tree.unmount()
    })

    // Negative control for the modal guard: an open blocking modal still swallows the submit, in
    // every scope shape.
    it('does nothing while a blocking modal is open, even for a matching scope', () => {
        mockState.assistantEnabled = true
        mockState.assistantEnabledScope = buildAssistantEnabledScope(PROJECT_ID, TASK_ID)
        mockState.openModals = { MENTION_MODAL_ID: true }

        const { tree, saveCommentBeforeSaveTask } = submitComment()

        expect(createObjectMessage).not.toHaveBeenCalled()
        expect(saveCommentBeforeSaveTask).not.toHaveBeenCalled()

        tree.unmount()
    })
})
