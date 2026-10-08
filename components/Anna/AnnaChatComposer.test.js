import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import Delta from 'quill-delta'
import AnnaChatComposer from './AnnaChatComposer'

let mockInputProps, mockEditor
const mockInput = { clear: jest.fn(), focus: jest.fn(), clearAndSetContent: jest.fn() }
jest.mock('react-quill-new', () => ({ Quill: { import: () => require('quill-delta').default } }))
jest.mock('../Feeds/CommentsTextInput/textInputHelper', () => ({ TASK_THEME: 'task' }))
jest.mock('../../utils/assistantHelper', () => ({ CHAT_INPUT_LIMIT_IN_CHARACTERS: 10000 }))
jest.mock('../Feeds/CommentsTextInput/CustomTextInput3', () => {
    const React = require('react')
    return React.forwardRef((props, ref) => {
        mockInputProps = props
        React.useImperativeHandle(ref, () => mockInput)
        React.useLayoutEffect(() => props.setEditor(mockEditor), [])
        return <div contentEditable={!props.disabledEdition} suppressContentEditableWarning />
    })
})

let root, container, composer
const onSubmit = jest.fn()
const render = (props = {}) =>
    act(() =>
        root.render(
            <form>
                <AnnaChatComposer ref={composer} projectId="p1" label="Message Anna" onSubmit={onSubmit} {...props} />
                <button type="button">Dictate</button>
            </form>
        )
    )
const key = (options = {}) =>
    act(() =>
        container
            .querySelector('[contenteditable]')
            .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...options }))
    )

beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
    jest.clearAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
    composer = React.createRef()
    mockEditor = {
        root: document.createElement('div'),
        getSelection: jest.fn(() => null),
        getText: jest.fn(() => ''),
        getLength: jest.fn(() => 100),
        updateContents: jest.fn(),
        setSelection: jest.fn(),
    }
    root = createRoot(container)
})
afterEach(() => {
    act(() => root.unmount())
    container.remove()
    delete global.IS_REACT_ACT_ENVIRONMENT
})

it('uses the shared mention editor and preserves assistant mentions as references', () => {
    render()
    expect(mockInputProps.projectId).toBe('p1')
    expect(mockInputProps.disabledMentions).toBeUndefined()
    expect(mockInputProps.insertAssistantAsMention).toBe(true)
    expect(mockInputProps.chatAssistantData).toBeUndefined()
    expect(mockInputProps.keepBreakLines).toBe(true)
    expect(mockInputProps.hideDictation).toBe(true)
    expect(mockInputProps.characterLimit).toBe(10000)
    expect(mockEditor.root.getAttribute('aria-label')).toBe('Message Anna')
    render({ label: 'Message Carl' })
    expect(mockEditor.root.getAttribute('aria-label')).toBe('Message Carl')
})

it('leaves Enter to the mention picker, then sends when it is closed', () => {
    render()
    mockInputProps.setMentionsModalActive(true)
    key()
    expect(onSubmit).not.toHaveBeenCalled()
    mockInputProps.setMentionsModalActive(false)
    key()
    expect(onSubmit).toHaveBeenCalledTimes(1)
})

it('inserts a single newline at the live selection on Shift+Enter without sending', () => {
    render()
    mockEditor.getSelection.mockReturnValue({ index: 8, length: 3 })
    key({ shiftKey: true })
    expect(mockEditor.updateContents).toHaveBeenCalledWith(new Delta().retain(8).delete(3).insert('\n'), 'user')
    expect(mockEditor.setSelection).toHaveBeenCalledWith(9, 0, 'silent')
    expect(onSubmit).not.toHaveBeenCalled()
})

it('allows IME composition without sending', () => {
    render()
    key({ isComposing: true })
    expect(mockEditor.updateContents).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
})

it('prevents sends and dictation during a voice call', () => {
    render({ disabled: true })
    expect(mockInputProps.disabledEdition).toBe(true)
    key()
    composer.current.insertDictation('Transcript', true)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(mockEditor.updateContents).not.toHaveBeenCalled()
})

it('inserts dictation at the saved selection without rewriting existing embeds', () => {
    render()
    mockInputProps.onCustomSelectionChange({ index: 7, length: 12 })
    mockEditor.getText.mockImplementation(index => (index === 6 ? ' ' : ' '))
    act(() => {
        container.querySelector('button').focus()
        composer.current.insertDictation('create a task', true)
    })
    expect(mockEditor.updateContents).toHaveBeenCalledWith(
        new Delta().retain(7).delete(12).insert('create a task'),
        'user'
    )
    expect(mockEditor.setSelection).toHaveBeenCalledWith(20, 0, 'silent')
})

it('uses the live selection and adds spaces around dictated text', () => {
    render()
    mockEditor.getSelection.mockReturnValue({ index: 4, length: 0 })
    mockEditor.getText.mockReturnValue('x')
    composer.current.insertDictation('hello', true)
    expect(mockEditor.updateContents).toHaveBeenCalledWith(new Delta().retain(4).insert(' hello '), 'user')
    expect(mockEditor.setSelection).not.toHaveBeenCalled()
})

it('keeps workspace focus when the chat is hidden', () => {
    render()
    act(() => container.querySelector('button').focus())
    composer.current.insertDictation('hello', false)
    expect(mockEditor.updateContents).toHaveBeenCalled()
    expect(mockEditor.setSelection).not.toHaveBeenCalled()
})

it('clears both the editor and mention state after send', () => {
    render()
    mockInputProps.setMentionsModalActive(true)
    composer.current.clear()
    expect(mockInput.clear).toHaveBeenCalledTimes(1)
    key()
    expect(onSubmit).toHaveBeenCalledTimes(1)
})
