/**
 * @jest-environment jsdom
 *
 * AT-3028 — the assistant line's text field takes a click anywhere in it, and the toolbar keeps
 * its own clicks.
 *
 * Driven through react-dom with REAL `mousedown` events on the REAL `AssistantOptions` (on
 * react-native-web), because the interesting failure is a routing one: the + and the mic are
 * rendered by the text field and portalled into the toolbar, and React bubbles a press on them
 * through the field's handler. A hand-called prop could not show that.
 *
 * Real Quill cannot run on this jsdom (no Range / getSelection — see browser-tests/README.md), so
 * the text field is a stub that renders Quill's DOM shape and records focus calls.
 */
jest.mock('react-native', () => jest.requireActual('react-native-web'))

const mockState = {
    selectedProjectIndex: 0,
    loggedUserProjects: [{ id: 'selected-project', index: 0, name: 'Selected project' }],
    defaultAssistant: { uid: 'assistant-1' },
    loggedUser: { uid: 'user-1', defaultProjectId: 'default-project', gold: 100 },
    smallScreenNavigation: false,
    isMiddleScreen: false,
}

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector => selector(mockState),
}))

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: key => key,
    getDeviceLanguage: () => 'en',
}))

jest.mock('../../../Feeds/CommentsTextInput/AttachmentDropZone', () => {
    const React = require('react')
    const { View } = require('react-native')
    return ({ children, testID, style }) => (
        <View testID={testID} style={style}>
            {children}
        </View>
    )
})

jest.mock('../../../Feeds/CommentsTextInput/textInputHelper', () => ({ TASK_THEME: 'TASK_THEME' }))
jest.mock('../../../Feeds/Utils/HelperFunctions', () => ({
    updateNewAttachmentsData: jest.fn(async (projectId, text) => text),
}))
jest.mock('../../../../utils/assistantHelper', () => ({ createBotQuickTopic: jest.fn() }))
jest.mock('../../../../redux/actions', () => ({ stopLoadingData: () => ({ type: 'stop' }) }))

jest.mock('./helper', () => ({
    getAssistantLineData: () => ({
        assistant: { uid: 'assistant-1', displayName: 'Assistant' },
        assistantProject: { id: 'default-project', index: 1, name: 'Default project' },
        assistantProjectId: 'default-project',
    }),
}))

jest.mock('../../../UIComponents/ModalShell/AppPopover', () => {
    const React = require('react')
    return ({ children }) => <>{children}</>
})

jest.mock('./Search/AssistantTaskSearchButtonWrapper', () => {
    const React = require('react')
    return () => (
        <button data-testid="templates-button" onClick={() => global.mockToolbarPress('templates')}>
            Templates
        </button>
    )
})
jest.mock('../AssistantSwitchControl', () => () => null)
jest.mock('../../../ChatsView/ChatDV/EditorView/BotOption/RunOutOfGoldAssistantModal', () => () => null)
jest.mock('./AssistantAvatarButton', () => () => null)
jest.mock('../../../UIComponents/AssistantVoiceCallButton', () => {
    const React = require('react')
    return () => (
        <button data-testid="call-button" onClick={() => global.mockToolbarPress('call')}>
            Call
        </button>
    )
})
jest.mock('../../../UIControls/Button', () => {
    const React = require('react')
    return ({ onPress, accessibilityLabel }) => (
        <button data-testid="send-button" onClick={onPress}>
            {accessibilityLabel}
        </button>
    )
})

var mockEditor
var mockFocused

// Quill's DOM shape (frame > .ql-container > contenteditable .ql-editor), with the + and mic
// portalled into the toolbar slots exactly as CustomTextInput3 does with `inlineControlTargets`.
jest.mock('../../../Feeds/CommentsTextInput/CustomTextInput3', () => {
    const React = require('react')
    const { createPortal } = require('react-dom')
    return React.forwardRef((props, ref) => {
        React.useImperativeHandle(ref, () => ({
            getEditor: () => mockEditor,
            focus: () => mockEditor.focus(),
            isFocused: () => mockFocused,
            blur: jest.fn(),
            clear: jest.fn(),
        }))
        const { attachment, dictation } = props.inlineControlTargets || {}
        return (
            <div data-testid="input-frame" style={{ padding: '4px 8px', height: props.fixedHeight }}>
                <div className="ql-container">
                    <div className="ql-editor ql-blank" contentEditable suppressContentEditableWarning>
                        <p data-testid="editor-paragraph" />
                    </div>
                </div>
                {attachment &&
                    createPortal(
                        <button data-testid="attach-button" onClick={() => global.mockToolbarPress('attach')}>
                            +
                        </button>,
                        attachment
                    )}
                {dictation &&
                    createPortal(
                        <button data-testid="mic-button" onClick={() => global.mockToolbarPress('mic')}>
                            mic
                        </button>,
                        dictation
                    )}
            </div>
        )
    })
})

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

import AssistantOptions from './AssistantOptions'

let container
let root

const byTestId = id => container.querySelector(`[data-testid="${id}"]`)

// Like a real press: mousedown, and the click only if nothing prevented the mousedown's default
// for a control (a prevented mousedown does not cancel a click, so it is always dispatched).
const press = node => {
    const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })
    node.dispatchEvent(mouseDown)
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    return mouseDown
}

beforeEach(async () => {
    global.IS_REACT_ACT_ENVIRONMENT = true
    global.mockToolbarPress = jest.fn()
    mockFocused = false
    mockEditor = { focus: jest.fn(), setSelection: jest.fn(), getLength: jest.fn(() => 1) }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
        root.render(<AssistantOptions />)
    })
})

afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    delete global.mockToolbarPress
})

describe('AT-3028: clicking the assistant line text field starts typing', () => {
    it('focuses the composer from the field frame around the editor (its padding)', () => {
        const mouseDown = press(byTestId('input-frame'))
        expect(mouseDown.defaultPrevented).toBe(true)
        expect(mockEditor.focus).toHaveBeenCalledTimes(1)
        expect(mockEditor.setSelection).toHaveBeenCalledWith(0, 0)
    })

    it('focuses from the field wrapper itself', () => {
        press(byTestId('assistant-composer-field'))
        expect(mockEditor.focus).toHaveBeenCalledTimes(1)
    })

    it('leaves a click inside the editor to the browser (no hijack of the native caret)', () => {
        const editor = container.querySelector('.ql-editor')
        const mouseDown = press(byTestId('editor-paragraph'))
        expect(mouseDown.defaultPrevented).toBe(false)
        press(editor)
        expect(mockEditor.focus).not.toHaveBeenCalled()
    })

    it('keeps the caret of a composer that already has focus', () => {
        mockFocused = true
        mockEditor.getLength.mockReturnValue(12)
        press(byTestId('input-frame'))
        expect(mockEditor.focus).not.toHaveBeenCalled()
        expect(mockEditor.setSelection).not.toHaveBeenCalled()
    })

    it('places the caret after existing text', () => {
        mockEditor.getLength.mockReturnValue(12)
        press(byTestId('input-frame'))
        expect(mockEditor.setSelection).toHaveBeenCalledWith(11, 0)
    })

    it('renders the toolbar outside the field wrapper', () => {
        const field = byTestId('assistant-composer-field')
        const toolbar = byTestId('assistant-composer-toolbar')
        expect(field).not.toBeNull()
        expect(toolbar).not.toBeNull()
        expect(field.contains(toolbar)).toBe(false)
        expect(byTestId('assistant-composer-row').contains(field)).toBe(true)
    })

    it.each([
        ['attach-button', 'attach'],
        ['mic-button', 'mic'],
    ])('does not hijack the portalled %s (React bubbles it through the field)', (testId, name) => {
        const button = byTestId(testId)
        // Really portalled: in the toolbar in the DOM, outside the field.
        expect(byTestId('assistant-composer-field').contains(button)).toBe(false)
        expect(byTestId('assistant-composer-toolbar').contains(button)).toBe(true)

        const mouseDown = press(button)
        expect(mouseDown.defaultPrevented).toBe(false)
        expect(mockEditor.focus).not.toHaveBeenCalled()
        expect(global.mockToolbarPress).toHaveBeenCalledWith(name)
    })

    it.each([
        ['templates-button', 'templates'],
        ['call-button', 'call'],
    ])('leaves the %s alone', (testId, name) => {
        const mouseDown = press(byTestId(testId))
        expect(mouseDown.defaultPrevented).toBe(false)
        expect(mockEditor.focus).not.toHaveBeenCalled()
        expect(global.mockToolbarPress).toHaveBeenCalledWith(name)
    })

    it('leaves the send button and the toolbar background alone', () => {
        expect(press(byTestId('send-button')).defaultPrevented).toBe(false)
        expect(press(byTestId('assistant-composer-toolbar')).defaultPrevented).toBe(false)
        expect(press(byTestId('assistant-composer-row')).defaultPrevented).toBe(false)
        expect(mockEditor.focus).not.toHaveBeenCalled()
    })
})
