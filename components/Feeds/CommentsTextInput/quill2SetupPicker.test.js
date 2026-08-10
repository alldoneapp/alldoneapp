/**
 * @jest-environment jsdom
 *
 * Pins the header-picker decoration in quill2Setup against the REAL quill 2 Picker.
 * Regression: quill 2's Picker.selectItem copies the selected item's data-label onto
 * the label element, and the vendored toolbar CSS renders that attribute as literal
 * text (`content: attr(data-label)`) — on staging the label showed the icon plus a
 * raw "Normal text" string. selectItem also early-returns when the selection is
 * unchanged, which silently skipped the initial icon-mirroring.
 */
import Picker from 'quill/ui/picker'

import { decoratePicker } from './quill2Setup'

jest.mock('./textInputHelper', () => ({
    getPlaceholderData: jest.fn(() => ({})),
    QUILL_EDITOR_TEXT_INPUT_TYPE: '0',
}))

const HEADING_OPTIONS = [
    { value: '', text: 'Normal text' },
    { value: '3', text: 'Small heading' },
    { value: '1', text: 'Heading' },
]

const buildHeaderSelect = () => {
    const select = document.createElement('select')
    select.classList.add('ql-header')
    HEADING_OPTIONS.forEach(({ value, text }, index) => {
        const option = document.createElement('option')
        option.setAttribute('value', value)
        option.setAttribute(
            'data-html',
            `<div><i class="ql-header-item-icon"><svg data-icon="${value || 'normal'}"></svg></i>` +
                `<i class="ql-header-item-shortcut">${index + 1}</i></div>`
        )
        option.textContent = text
        if (index === 0) option.setAttribute('selected', 'selected')
        select.appendChild(option)
    })
    document.body.appendChild(select)
    return select
}

afterEach(() => {
    document.body.innerHTML = ''
})

describe('decoratePicker on the quill 2 header picker', () => {
    it('injects data-html into the picker items', () => {
        const picker = new Picker(buildHeaderSelect())
        decoratePicker(picker)
        const items = picker.container.querySelectorAll('.ql-picker-item')
        expect(items).toHaveLength(3)
        expect(items[1].querySelector('.ql-header-item-icon svg').getAttribute('data-icon')).toBe('3')
        // Items keep their data-label — the dropdown renders the name through CSS.
        expect(items[1].getAttribute('data-label')).toBe('Small heading')
    })

    it('restores the empty data-value quill 1 kept on items (the app CSS keys off it)', () => {
        const picker = new Picker(buildHeaderSelect())
        decoratePicker(picker)
        const items = picker.container.querySelectorAll('.ql-picker-item')
        // quill 2 skips falsy values, but the "Normal text" item must carry
        // data-value="" for the app's [data-value=''] layout/hiding rules.
        expect(items[0].getAttribute('data-value')).toBe('')
        expect(items[1].getAttribute('data-value')).toBe('3')
    })

    it('mirrors the initially selected item icon into the label, stamps data-value and strips data-label', () => {
        const picker = new Picker(buildHeaderSelect())
        decoratePicker(picker)
        // quill 2 copied data-label onto the label during construction (before the
        // decoration ran) and selectItem early-returns for the unchanged selection —
        // the decoration must fix the label anyway.
        expect(picker.label.hasAttribute('data-label')).toBe(false)
        expect(picker.label.getAttribute('data-value')).toBe('')
        expect(picker.label.querySelector('.ql-header-item-icon svg').getAttribute('data-icon')).toBe('normal')
    })

    it('keeps the label in sync (icon, data-value, no data-label) when the selection changes', () => {
        const picker = new Picker(buildHeaderSelect())
        decoratePicker(picker)
        const items = picker.container.querySelectorAll('.ql-picker-item')
        picker.selectItem(items[2], true)
        expect(picker.label.hasAttribute('data-label')).toBe(false)
        expect(picker.label.getAttribute('data-value')).toBe('1')
        expect(picker.label.querySelector('.ql-header-item-icon svg').getAttribute('data-icon')).toBe('1')
        expect(picker.label.textContent).not.toContain('Heading')
    })
})
