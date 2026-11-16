/**
 * @jest-environment jsdom
 *
 * AT-3028 — clicking the blank line under "Start a new chat" starts typing.
 */
import fs from 'fs'
import path from 'path'

import {
    focusComposerAtEnd,
    handleComposerFieldMouseDown,
    shouldFocusComposerFromPointer,
} from './assistantComposerFocus'
import { ASSISTANT_INPUT_MIN_HEIGHT, ASSISTANT_INPUT_VERTICAL_PADDING } from './assistantInputLayout'

const buildField = () => {
    const field = document.createElement('div')
    field.innerHTML = `
        <div data-testid="frame">
            <div class="ql-container">
                <div class="ql-editor ql-blank" contenteditable="true"><p data-testid="paragraph"></p></div>
            </div>
            <div data-testid="indicator"></div>
        </div>`
    document.body.appendChild(field)
    return field
}

const pointerEvent = (field, target, overrides = {}) => ({
    currentTarget: field,
    target,
    button: 0,
    defaultPrevented: false,
    preventDefault: jest.fn(),
    ...overrides,
})

const makeInput = ({ focused = false, length = 1 } = {}) => {
    const editor = { focus: jest.fn(), setSelection: jest.fn(), getLength: jest.fn(() => length) }
    return { editor, input: { isFocused: jest.fn(() => focused), getEditor: () => editor, focus: jest.fn() } }
}

afterEach(() => {
    document.body.innerHTML = ''
})

describe('the editor fills the field at rest (assistantInput.css)', () => {
    it('gives the composer editor a min-height of the two resting lines', () => {
        const css = fs.readFileSync(path.join(__dirname, 'assistantInput.css'), 'utf8')
        const rule = css.match(/\[data-testid='assistant-composer-row'\] \.ql-editor \{([^}]*)\}/)
        expect(rule).not.toBeNull()
        const minHeight = rule[1].match(/min-height:\s*(\d+)px/)
        expect(minHeight).not.toBeNull()
        // Anything less leaves dead frame under the placeholder; anything more would make the
        // resting field taller than the skeleton reserves.
        expect(Number(minHeight[1])).toBe(ASSISTANT_INPUT_MIN_HEIGHT - ASSISTANT_INPUT_VERTICAL_PADDING)
    })
})

describe('shouldFocusComposerFromPointer', () => {
    it('accepts a press on the field frame around the editor', () => {
        const field = buildField()
        const frame = field.querySelector('[data-testid="frame"]')
        expect(shouldFocusComposerFromPointer(pointerEvent(field, frame))).toBe(true)
        expect(shouldFocusComposerFromPointer(pointerEvent(field, field))).toBe(true)
        expect(shouldFocusComposerFromPointer(pointerEvent(field, field.querySelector('.ql-container')))).toBe(true)
        expect(
            shouldFocusComposerFromPointer(pointerEvent(field, field.querySelector('[data-testid="indicator"]')))
        ).toBe(true)
    })

    it('leaves a press inside the editor to the browser', () => {
        const field = buildField()
        expect(shouldFocusComposerFromPointer(pointerEvent(field, field.querySelector('.ql-editor')))).toBe(false)
        expect(
            shouldFocusComposerFromPointer(pointerEvent(field, field.querySelector('[data-testid="paragraph"]')))
        ).toBe(false)
    })

    it('ignores controls inside the field', () => {
        const field = buildField()
        const button = document.createElement('button')
        const icon = document.createElement('span')
        button.appendChild(icon)
        const roleButton = document.createElement('div')
        roleButton.setAttribute('role', 'button')
        const focusable = document.createElement('div')
        focusable.setAttribute('tabindex', '0')
        const link = document.createElement('a')
        link.setAttribute('href', 'https://example.com')
        field.append(button, roleButton, focusable, link)

        for (const target of [button, icon, roleButton, focusable, link]) {
            expect(shouldFocusComposerFromPointer(pointerEvent(field, target))).toBe(false)
        }
    })

    it('ignores an event that only reaches the field through a React portal', () => {
        const field = buildField()
        const toolbarSlot = document.createElement('div')
        document.body.appendChild(toolbarSlot)
        expect(shouldFocusComposerFromPointer(pointerEvent(field, toolbarSlot))).toBe(false)
    })

    it('ignores secondary buttons, modified clicks and already handled events', () => {
        const field = buildField()
        const frame = field.querySelector('[data-testid="frame"]')
        expect(shouldFocusComposerFromPointer(pointerEvent(field, frame, { button: 2 }))).toBe(false)
        expect(shouldFocusComposerFromPointer(pointerEvent(field, frame, { shiftKey: true }))).toBe(false)
        expect(shouldFocusComposerFromPointer(pointerEvent(field, frame, { metaKey: true }))).toBe(false)
        expect(shouldFocusComposerFromPointer(pointerEvent(field, frame, { defaultPrevented: true }))).toBe(false)
        expect(shouldFocusComposerFromPointer(null)).toBe(false)
    })
})

describe('focusComposerAtEnd', () => {
    it('focuses an unfocused composer with the caret after the existing text', () => {
        const { input, editor } = makeInput({ length: 6 })
        focusComposerAtEnd(input)
        expect(editor.focus).toHaveBeenCalled()
        expect(editor.setSelection).toHaveBeenCalledWith(5, 0)
    })

    it('puts the caret at 0 in an empty composer', () => {
        const { input, editor } = makeInput({ length: 1 })
        focusComposerAtEnd(input)
        expect(editor.setSelection).toHaveBeenCalledWith(0, 0)
    })

    it('keeps the caret of a composer that already has focus', () => {
        const { input, editor } = makeInput({ focused: true, length: 6 })
        focusComposerAtEnd(input)
        expect(editor.focus).not.toHaveBeenCalled()
        expect(editor.setSelection).not.toHaveBeenCalled()
    })

    it('falls back to the input focus without an editor', () => {
        const input = { isFocused: () => false, getEditor: () => null, focus: jest.fn() }
        focusComposerAtEnd(input)
        expect(input.focus).toHaveBeenCalled()
    })
})

describe('handleComposerFieldMouseDown', () => {
    it('prevents the default only when it takes the press', () => {
        const field = buildField()
        const { input, editor } = makeInput()

        const onFrame = pointerEvent(field, field.querySelector('[data-testid="frame"]'))
        expect(handleComposerFieldMouseDown(onFrame, input)).toBe(true)
        expect(onFrame.preventDefault).toHaveBeenCalled()
        expect(editor.focus).toHaveBeenCalledTimes(1)

        const onEditor = pointerEvent(field, field.querySelector('.ql-editor'))
        expect(handleComposerFieldMouseDown(onEditor, input)).toBe(false)
        expect(onEditor.preventDefault).not.toHaveBeenCalled()
        expect(editor.focus).toHaveBeenCalledTimes(1)
    })

    it('does nothing before the input exists', () => {
        const field = buildField()
        const event = pointerEvent(field, field)
        expect(handleComposerFieldMouseDown(event, null)).toBe(false)
        expect(event.preventDefault).not.toHaveBeenCalled()
    })
})
