import { isEditingState, isEditableElementFocused, isUserEditing } from './editingGuard'

const idleState = { activeEditMode: false, showFloatPopup: 0, taskTitleInEditMode: false }

describe('editingGuard - isEditingState (reactive, render-safe)', () => {
    it('is false when nothing is open', () => {
        expect(isEditingState(idleState)).toBe(false)
    })

    it('is false for a missing state rather than throwing', () => {
        expect(isEditingState(undefined)).toBe(false)
        expect(isEditingState(null)).toBe(false)
    })

    it('detects a mounted inline / add-task editor', () => {
        expect(isEditingState({ ...idleState, activeEditMode: true })).toBe(true)
    })

    it('detects a stacked float popup (due date, estimation, parent goal, ...)', () => {
        expect(isEditingState({ ...idleState, showFloatPopup: 1 })).toBe(true)
    })

    it('detects in-place title editing', () => {
        expect(isEditingState({ ...idleState, taskTitleInEditMode: true })).toBe(true)
    })
})

describe('editingGuard - isEditableElementFocused (DOM half)', () => {
    afterEach(() => {
        document.body.innerHTML = ''
    })

    const mountAndFocus = html => {
        document.body.innerHTML = html
        const element = document.body.firstElementChild
        element.focus()
        return element
    }

    it('is false when focus is on the body', () => {
        expect(isEditableElementFocused()).toBe(false)
    })

    it('detects a focused text input', () => {
        mountAndFocus('<input type="text" />')
        expect(isEditableElementFocused()).toBe(true)
    })

    it('detects a focused textarea', () => {
        mountAndFocus('<textarea></textarea>')
        expect(isEditableElementFocused()).toBe(true)
    })

    it('detects a focused Quill surface (chat / comment composer)', () => {
        mountAndFocus('<div class="ql-editor" tabindex="0"></div>')
        expect(isEditableElementFocused()).toBe(true)
    })

    it('ignores a focused non-editable element', () => {
        mountAndFocus('<button>press me</button>')
        expect(isEditableElementFocused()).toBe(false)
    })
})

describe('editingGuard - isUserEditing (imperative, combines both halves)', () => {
    afterEach(() => {
        document.body.innerHTML = ''
    })

    it('is true from redux state alone', () => {
        expect(isUserEditing({ ...idleState, activeEditMode: true })).toBe(true)
    })

    it('falls back to DOM focus so chat / comment composers count as editing', () => {
        document.body.innerHTML = '<input type="text" />'
        document.body.firstElementChild.focus()

        expect(isUserEditing(idleState)).toBe(true)
    })

    it('is false when neither redux nor the DOM reports editing', () => {
        expect(isUserEditing(idleState)).toBe(false)
    })
})
