/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'

import EditForm from './EditForm'

jest.mock('../../../Feeds/CommentsTextInput/CustomTextInput3', () => {
    const React = require('react')
    const { TextInput } = require('react-native')
    return React.forwardRef((props, ref) => <TextInput ref={ref} testID="comment-input" {...props} />)
})
jest.mock('../../../UIControls/Button', () => 'Button')
jest.mock(
    'react-hot-keys',
    () =>
        ({ children }) =>
            children
)
jest.mock('../../../styles/global', () => ({
    __esModule: true,
    default: { body1: {} },
    colors: { Text03: '#000', Text04: '#fff', Secondary200: '#222' },
}))
jest.mock('../../../Feeds/CommentsTextInput/textInputHelper', () => ({
    COMMENT_MODAL_THEME: 'COMMENT_MODAL_THEME',
    updateKarmaInInput: jest.fn(),
    checkIfInputHaveKarma: jest.fn(() => false),
}))
jest.mock('../../../ModalsManager/modalsManager', () => ({ MENTION_MODAL_ID: 'mention-modal' }))
jest.mock('../../../../redux/store', () => ({
    getState: () => ({ isQuillTagEditorOpen: false, openModals: {} }),
}))
jest.mock('../../../../i18n/TranslationService', () => ({ translate: text => text }))
jest.mock('../../../ChatsView/ChatDV/EditorView/BotOption/BotButtonWrapper', () => 'BotButtonWrapper')
jest.mock('./SubmitButton', () => 'SubmitButton')

const renderForm = (autoFocus, props = {}) =>
    renderer.create(
        <EditForm
            projectId="project-1"
            objectType="goals"
            currentComment=""
            setInitialComment={jest.fn()}
            autoFocus={autoFocus}
            {...props}
        />
    )

describe('RichCommentModal EditForm focus', () => {
    it('passes disabled auto focus to the comment input for unread threads', () => {
        const tree = renderForm(false)

        expect(tree.root.findByProps({ testID: 'comment-input' }).props.autoFocus).toBe(false)
        tree.unmount()
    })

    it('keeps auto focus enabled by default', () => {
        const tree = renderForm(undefined)

        expect(tree.root.findByProps({ testID: 'comment-input' }).props.autoFocus).toBe(true)
        tree.unmount()
    })

    it.each([true, false])('shows the assistant control with enabled state: %s', isAssistantEnabled => {
        const tree = renderForm(undefined, {
            showBotButton: true,
            isAssistantEnabled,
            objectId: 'task-1',
            objectType: 'tasks',
            assistantId: 'assistant-1',
        })

        expect(tree.root.findByType('BotButtonWrapper').props.assistantEnabled).toBe(isAssistantEnabled)
        tree.unmount()
    })
})

/**
 * Push-to-talk in the comment popup (AT-2410).
 *
 * The popup is the comment surface for ~17 entry points — the feed interaction bar, the task and
 * goal comment buttons, Suggested, Follow-up, the workflow modals — and it owns its Enter handling
 * with a `document` keydown listener rather than through `forceTriggerEnterActionForBreakLines`.
 * That is exactly the shape `dictationSubmit.js` requires an explicit `onDictationSubmit` for, and
 * without it `resolveDictationSubmit` returns null: the transcript was inserted and then left
 * sitting in the field, so releasing the mic dictated a comment nobody sent.
 *
 * These drive the form the way a real dictation does — the transcript lands through `onChangeText`
 * first (that is the insertion), and only then does the input ask for its submit.
 */
describe('RichCommentModal EditForm push-to-talk submit', () => {
    // The two halves are deliberately separate `act` blocks, because that is the real ordering:
    // the transcript insertion calls `onChangeText` and only QUEUES this form's `setState`, and
    // `useDictationSubmit` then fires the submit from a POST-COMMIT effect — by which time the
    // form has re-rendered and `state.comment` holds draft + transcript. Firing both in one batch
    // would test a sequence that cannot happen and would read the pre-dictation state.
    const holdMicAndRelease = (tree, transcript) => {
        const input = () => tree.root.findByProps({ testID: 'comment-input' }).props
        act(() => {
            input().onChangeText(transcript)
        })
        act(() => {
            // CustomTextInput3 passes draft + transcript; this form deliberately ignores it and
            // posts its own state, which carries the mentions and karma alongside the text.
            input().onDictationSubmit(transcript)
        })
    }

    test('a held dictation posts the comment with no separate send step', () => {
        const onSuccess = jest.fn()
        const tree = renderForm(undefined, { onSuccess })

        holdMicAndRelease(tree, '  Ship the release notes  ')

        expect(onSuccess).toHaveBeenCalledTimes(1)
        expect(onSuccess).toHaveBeenCalledWith(
            expect.objectContaining({ comment: 'Ship the release notes', mentions: [] })
        )
        tree.unmount()
    })

    test('the input is actually handed a submit action (the bug was the missing prop)', () => {
        const tree = renderForm(undefined, { onSuccess: jest.fn() })

        expect(typeof tree.root.findByProps({ testID: 'comment-input' }).props.onDictationSubmit).toBe('function')
        tree.unmount()
    })

    test('a transcript that came out empty never posts the untouched draft', () => {
        const onSuccess = jest.fn()
        const tree = renderForm(undefined, { onSuccess })

        holdMicAndRelease(tree, '   \n  ')

        expect(onSuccess).not.toHaveBeenCalled()
        tree.unmount()
    })

    test('it stands down while a nested popup owns the send, exactly as Enter does', () => {
        const onSuccess = jest.fn()
        const tree = renderForm(undefined, { onSuccess, disableDoneButton: true })

        holdMicAndRelease(tree, 'not while the bot options are open')

        expect(onSuccess).not.toHaveBeenCalled()
        tree.unmount()
    })

    test('it stands down while the mention picker is open', () => {
        const onSuccess = jest.fn()
        const tree = renderForm(undefined, { onSuccess })

        act(() => {
            tree.root.findByProps({ testID: 'comment-input' }).props.setMentionsModalActive(true)
        })
        holdMicAndRelease(tree, 'pick a mention first')

        expect(onSuccess).not.toHaveBeenCalled()
        tree.unmount()
    })

    test('an anonymous reader cannot post by gesture either', () => {
        const onSuccess = jest.fn()
        const tree = renderForm(undefined, { onSuccess, userIsAnonymous: true })

        holdMicAndRelease(tree, 'read only')

        expect(onSuccess).not.toHaveBeenCalled()
        tree.unmount()
    })

    test('Enter still submits through the same guards after the refactor', () => {
        const onSuccess = jest.fn()
        const tree = renderForm(undefined, { onSuccess })

        act(() => {
            tree.root.findByProps({ testID: 'comment-input' }).props.onChangeText('typed by hand')
        })
        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
        })

        expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ comment: 'typed by hand' }))
        tree.unmount()
    })

    test('Shift+Enter still writes a newline instead of posting', () => {
        const onSuccess = jest.fn()
        const tree = renderForm(undefined, { onSuccess })

        act(() => {
            tree.root.findByProps({ testID: 'comment-input' }).props.onChangeText('first line')
        })
        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }))
        })
        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
        })

        expect(onSuccess).not.toHaveBeenCalled()
        tree.unmount()
    })

    test('a latched Shift does NOT swallow a held dictation', () => {
        // Shift means "newline instead of submit", which is a keyboard concept. A gesture that
        // happened to follow a Shift keydown (or one whose keyup was eaten by a focus change) must
        // still post — the user held the mic and let go, and there is nothing else it could mean.
        const onSuccess = jest.fn()
        const tree = renderForm(undefined, { onSuccess })

        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }))
        })
        holdMicAndRelease(tree, 'send me anyway')

        expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ comment: 'send me anyway' }))
        tree.unmount()
    })
})
