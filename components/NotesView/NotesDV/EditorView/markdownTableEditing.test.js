import Quill from 'quill'
import * as Y from 'yjs'
import { QuillBinding } from 'y-quill'
import MarkdownTableFormat from './MarkdownTableFormat'
import { markdownToDelta } from './markdownToDelta'
import './markdownTableEditing'

Quill.register('formats/markdownTable', MarkdownTableFormat, true)

const TABLE = {
    rows: [
        ['Name', 'Status'],
        ['**Alice**', 'Open'],
        ['Bob', 'Done'],
    ],
    alignments: ['left', 'right'],
}
const editors = []
// JSDOM has selection but no layout measurement; keep real history/selection.
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
const buildEditor = (readOnly = false) => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const quill = new Quill(container, {
        readOnly,
        modules: { toolbar: false, markdownTableEditing: true, history: { userOnly: true } },
    })
    quill.setContents([{ insert: 'Before\n' }, { insert: { markdownTable: TABLE } }, { insert: 'After\n' }])
    quill.history.clear()
    editors.push(quill)
    return quill
}
const tableNode = quill => quill.root.querySelector('.ql-markdownTable')
const cell = (quill, row = 1, column = 0) =>
    tableNode(quill).querySelector(`[data-row="${row}"][data-column="${column}"]`)
const value = quill => quill.getContents().ops.find(op => op.insert?.markdownTable).insert.markdownTable
const open = (quill, row = 1, column = 0) => {
    cell(quill, row, column).click()
    return quill.root.querySelector('.ql-table-cell-input')
}
const key = (input, name, options = {}) => {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options })
    input.dispatchEvent(event)
    return event
}
const action = (quill, name) => tableNode(quill).querySelector(`[data-table-action="${name}"]`).click()
// JSDOM has no PointerEvent constructor. Dispatch real DOM mouse events with
// pointer metadata through the module's capture listeners instead of calling it.
const pointer = (target, type, options = {}) => {
    const { pointerType = 'touch', pointerId = 1, isPrimary = true, ...coordinates } = options
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 100, clientY: 100, ...coordinates })
    Object.assign(event, { pointerType, pointerId, isPrimary })
    target.dispatchEvent(event)
    return event
}
const touchClick = target => target.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
const tap = target => {
    pointer(target, 'pointerdown')
    pointer(target, 'pointerup')
    touchClick(target)
}

afterEach(() => {
    editors.forEach(quill => quill.getModule('markdownTableEditing').destroy())
    editors.length = 0
    document.body.innerHTML = ''
})

describe('inline Markdown table editing with real Quill', () => {
    it.each(['touch', 'pen'])('opens a %s tap only after release and click, allowing finger jitter', pointerType => {
        const quill = buildEditor()
        const target = cell(quill).querySelector('span')
        expect(pointer(target, 'pointerdown', { pointerType }).defaultPrevented).toBe(false)
        expect(quill.root.querySelector('.ql-table-cell-input')).toBeNull()
        expect(quill.root.querySelector('.ql-table-controls')).toBeNull()
        expect(pointer(target, 'pointermove', { pointerType, clientX: 104, clientY: 105 }).defaultPrevented).toBe(false)
        pointer(target, 'pointerup', { pointerType, clientX: 104, clientY: 105 })
        expect(quill.root.querySelector('.ql-table-cell-input')).toBeNull()
        touchClick(target)
        expect(document.activeElement).toBe(quill.root.querySelector('.ql-table-cell-input'))
        expect(document.activeElement.value).toBe('**Alice**')
    })

    it.each([
        ['horizontal', 140, 100],
        ['vertical', 100, 140],
        ['diagonal', 108, 108],
    ])('rejects a %s swipe and its delayed click, then accepts the next tap', (_direction, clientX, clientY) => {
        const quill = buildEditor()
        const target = cell(quill)
        const changes = jest.fn()
        quill.on('text-change', changes)
        pointer(target, 'pointerdown')
        expect(pointer(target, 'pointermove', { clientX, clientY }).defaultPrevented).toBe(false)
        // Returning to the start must not turn a scroll back into a tap.
        pointer(target, 'pointerup')
        touchClick(target)
        expect(quill.root.querySelector('.ql-table-cell-input')).toBeNull()
        expect(quill.root.querySelector('.ql-table-controls')).toBeNull()
        expect(value(quill)).toEqual(TABLE)
        expect(changes).not.toHaveBeenCalled()
        tap(target)
        expect(document.activeElement.value).toBe('**Alice**')
    })

    it('checks release coordinates when no pointermove was delivered', () => {
        const quill = buildEditor()
        const target = cell(quill)
        pointer(target, 'pointerdown')
        pointer(document.body, 'pointerup', { clientY: 160 })
        touchClick(target)
        expect(quill.root.querySelector('.ql-table-cell-input')).toBeNull()
    })

    it.each(['pointercancel', 'table scroll', 'page scroll', 'second finger'])(
        'rejects a click after %s even without pointer movement',
        reason => {
            const quill = buildEditor()
            const target = cell(quill)
            pointer(target, 'pointerdown')
            if (reason === 'pointercancel') pointer(target, 'pointercancel')
            else if (reason === 'second finger') {
                pointer(document.body, 'pointerdown', { pointerId: 2, isPrimary: false })
                pointer(document.body, 'pointerup', { pointerId: 2, isPrimary: false })
            } else {
                const scroller = reason === 'table scroll' ? target.closest('.ql-markdown-table-scroll') : document
                scroller.dispatchEvent(new Event('scroll'))
            }
            pointer(target, 'pointerup')
            touchClick(target)
            expect(quill.root.querySelector('.ql-table-cell-input')).toBeNull()
            expect(quill.root.querySelector('.ql-table-controls')).toBeNull()
        }
    )

    it('prevents compatibility mousedown from replacing a draft before a touch click switches cells', () => {
        const quill = buildEditor()
        const input = open(quill)
        input.value = 'Updated by touch'
        const target = cell(quill, 2, 1)
        pointer(target, 'pointerdown')
        pointer(target, 'pointerup')
        const mouse = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
        target.dispatchEvent(mouse)
        expect(mouse.defaultPrevented).toBe(true)
        expect(document.activeElement).toBe(input)
        touchClick(target)
        expect(value(quill).rows[1][0]).toBe('Updated by touch')
        const next = quill.root.querySelector('.ql-table-cell-input')
        expect(next.value).toBe('Done')
        expect(pointer(next, 'pointerdown').defaultPrevented).toBe(false)
        expect(quill.root.querySelector('.ql-table-cell-input')).toBe(next)
    })

    it('retains immediate mouse editing and keyboard activation after a cancelled touch', () => {
        const quill = buildEditor()
        const target = cell(quill)
        pointer(target, 'pointerdown')
        pointer(target, 'pointercancel')
        expect(pointer(target, 'pointerdown', { pointerType: 'mouse' }).defaultPrevented).toBe(true)
        expect(document.activeElement.value).toBe('**Alice**')
        key(document.activeElement, 'Escape')
        pointer(target, 'pointerdown')
        pointer(target, 'pointercancel')
        key(target, 'Enter')
        expect(document.activeElement.value).toBe('**Alice**')
        key(document.activeElement, 'Escape')
        target.click()
        expect(document.activeElement.value).toBe('**Alice**')
    })

    it('releases document gesture listeners when destroyed during a touch', () => {
        const quill = buildEditor()
        const target = cell(quill)
        pointer(target, 'pointerdown')
        const remove = jest.spyOn(document, 'removeEventListener')
        quill.getModule('markdownTableEditing').destroy()
        for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'scroll']) {
            expect(remove).toHaveBeenCalledWith(type, expect.any(Function), true)
        }
        remove.mockRestore()
        pointer(target, 'pointerup')
        touchClick(target)
        expect(quill.root.querySelector('.ql-table-cell-input')).toBeNull()
    })

    it('keeps manual cell breaks through commit, Yjs persistence and Markdown paste', () => {
        const quill = buildEditor()
        const doc = new Y.Doc()
        doc.getText('quill').applyDelta(quill.getContents().ops)
        const binding = new QuillBinding(doc.getText('quill'), quill)
        const input = open(quill)
        expect(input.tagName).toBe('TEXTAREA')
        expect(key(input, 'Enter', { shiftKey: true }).defaultPrevented).toBe(false)
        expect(value(quill).rows).toEqual(TABLE.rows)
        input.value = '**First line**\nSecond | line\nThird line'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        key(input, 'Enter')
        expect(value(quill).rows[1][0]).toBe('**First line**\nSecond | line\nThird line')
        const restored = new Y.Doc()
        Y.applyUpdate(restored, Y.encodeStateAsUpdate(doc))
        expect(
            restored
                .getText('quill')
                .toDelta()
                .find(op => op.insert?.markdownTable).insert.markdownTable
        ).toEqual(value(quill))
        const { markdownTableToMarkdown } = require('../../../../functions/Assistant/deltaToMarkdown')
        const markdown = markdownTableToMarkdown(value(quill))
        expect(markdown).toContain('**First line**<br>Second \\| line<br>Third line')
        const pasted = markdownToDelta(markdown, Quill.import('delta'))
        expect(pasted.ops.find(op => op.insert?.markdownTable).insert.markdownTable.rows).toEqual(value(quill).rows)
        binding.destroy()
        doc.destroy()
        restored.destroy()
    })

    it('opens legacy HTML breaks without rewriting untouched cell content', () => {
        const quill = buildEditor()
        quill.setContents([
            { insert: { markdownTable: { rows: [['Heading'], ['First<br />Second']], alignments: [] } } },
        ])
        quill.history.clear()
        const input = open(quill)
        expect(input.value).toBe('First\nSecond')
        input.blur()
        expect(value(quill).rows[1][0]).toBe('First<br />Second')
        expect(quill.history.stack.undo).toHaveLength(0)
    })

    it('commits on Enter as a local delta, preserves formatting and surrounding text, and reloads', () => {
        const quill = buildEditor()
        const changes = []
        quill.on('text-change', (_delta, _old, source) => changes.push(source))
        const input = open(quill)
        expect(input.value).toBe('**Alice**')
        input.value = '**Alicia**'
        expect(value(quill).rows[1][0]).toBe('**Alice**') // A draft is not note content.
        key(input, 'Enter')
        expect(changes).toEqual(['user'])
        expect(value(quill).rows[1][0]).toBe('**Alicia**')
        expect(value(quill).alignments).toEqual(TABLE.alignments)
        expect(value(quill).id).toBeTruthy()
        expect(quill.getText()).toBe('Before\nAfter\n')
        expect(cell(quill).textContent).toBe('Alicia')
        expect(cell(quill).querySelector('span').style.fontWeight).toBe('700')
        const saved = quill.getContents()
        const reloaded = buildEditor()
        reloaded.setContents(saved)
        expect(value(reloaded)).toEqual(value(quill))
    })

    it('isolates cell changes from nearby typing in undo and redo', () => {
        const quill = buildEditor()
        quill.insertText(0, 'Typed ', 'user')
        const input = open(quill)
        input.value = 'Updated'
        key(input, 'Enter')
        quill.history.undo()
        expect(value(quill).rows).toEqual(TABLE.rows)
        expect(quill.getText()).toContain('Typed Before')
        quill.history.redo()
        expect(value(quill).rows[1][0]).toBe('Updated')
        expect(quill.getText()).toContain('Typed Before')
    })

    it('discards multiline edits on Escape, closes controls and does not save on subsequent blur', () => {
        const quill = buildEditor()
        const changes = jest.fn()
        quill.on('text-change', changes)
        const input = open(quill)
        input.value = 'Discard\nThis second line too'
        expect(key(input, 'Escape').defaultPrevented).toBe(true)
        expect(quill.root.querySelector('.ql-table-cell-input')).toBeNull()
        expect(quill.root.querySelector('.ql-table-controls')).toBeNull()
        expect(cell(quill).textContent).toBe('Alice')
        expect(cell(quill).querySelector('span').style.fontWeight).toBe('700')
        expect(document.activeElement).toBe(cell(quill))
        input.dispatchEvent(new FocusEvent('blur'))
        expect(value(quill)).toEqual(TABLE)
        expect(changes).not.toHaveBeenCalled()
        expect(quill.history.stack.undo).toHaveLength(0)
        const next = open(quill)
        expect(next.value).toBe('**Alice**')
        next.value = 'Keep'
        next.blur()
        expect(value(quill).rows[1][0]).toBe('Keep')
    })

    it('exits table controls with Escape from a saved cell or a focused control', () => {
        const quill = buildEditor()
        key(open(quill), 'Enter')
        expect(key(cell(quill), 'Escape').defaultPrevented).toBe(true)
        expect(quill.root.querySelector('.ql-table-controls')).toBeNull()
        key(open(quill), 'Enter')
        const button = tableNode(quill).querySelector('[data-table-action="add-row"]')
        button.focus()
        expect(key(button, 'Escape').defaultPrevented).toBe(true)
        expect(quill.root.querySelector('.ql-table-controls')).toBeNull()
        expect(document.activeElement).toBe(cell(quill))
        expect(value(quill)).toEqual(TABLE)
        expect(quill.history.stack.undo).toHaveLength(0)
    })

    it('moves forward/backward with Tab and survives switching cells after replacement', () => {
        const quill = buildEditor()
        let input = open(quill)
        input.value = 'Updated'
        key(input, 'Tab')
        input = quill.root.querySelector('.ql-table-cell-input')
        expect(input.value).toBe('Open')
        key(input, 'Tab', { shiftKey: true })
        expect(quill.root.querySelector('.ql-table-cell-input').value).toBe('Updated')
        quill.root.querySelector('.ql-table-cell-input').value = 'Again'
        const target = cell(quill, 2, 1)
        target.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }))
        expect(value(quill).rows[1][0]).toBe('Again')
        expect(quill.root.querySelector('.ql-table-cell-input').value).toBe('Done')
    })

    it('keeps input clipboard, undo and IME events away from document handlers', () => {
        const quill = buildEditor()
        const input = open(quill)
        const handler = jest.fn()
        ;['copy', 'cut', 'paste', 'beforeinput', 'compositionstart', 'compositionend'].forEach(type => {
            quill.root.addEventListener(type, handler)
            const event = new Event(type, { bubbles: true, cancelable: true })
            input.dispatchEvent(event)
            expect(event.defaultPrevented).toBe(false)
        })
        expect(handler).not.toHaveBeenCalled()
        expect(key(input, 'z', { ctrlKey: true }).defaultPrevented).toBe(false)
        input.value = 'Composing'
        key(input, 'Enter', { isComposing: true })
        expect(value(quill)).toEqual(TABLE)
        expect(quill.root.querySelector('.ql-table-cell-input')).toBe(input)
    })

    it('adds/removes rows and columns, preserves headers and changes alignment', () => {
        const quill = buildEditor()
        open(quill)
        action(quill, 'add-row')
        expect(value(quill).rows).toEqual([TABLE.rows[0], TABLE.rows[1], ['', ''], TABLE.rows[2]])
        action(quill, 'remove-row')
        expect(value(quill).rows).toEqual(TABLE.rows)
        action(quill, 'add-column')
        expect(value(quill).rows[0]).toEqual(['Name', '', 'Status'])
        expect(value(quill).alignments).toEqual(['left', null, 'right'])
        action(quill, 'align-center')
        expect(value(quill).alignments).toEqual(['left', 'center', 'right'])
        action(quill, 'remove-column')
        expect(value(quill).rows).toEqual(TABLE.rows)
        expect(value(quill).alignments).toEqual(TABLE.alignments)
        open(quill, 0, 0)
        expect(tableNode(quill).querySelector('[data-table-action="remove-row"]').disabled).toBe(true)
    })

    it('does not edit a read-only note or commit after permission is revoked', async () => {
        const readOnly = buildEditor(true)
        expect(open(readOnly)).toBeNull()
        expect(cell(readOnly).hasAttribute('tabindex')).toBe(false)
        const quill = buildEditor()
        const input = open(quill)
        input.value = 'Private draft'
        quill.disable()
        await Promise.resolve()
        expect(value(quill)).toEqual(TABLE)
        expect(quill.root.querySelector('.ql-table-cell-input')).toBeNull()
        expect(quill.container.querySelector('.ql-table-draft-recovery textarea').value).toBe('Private draft')
    })

    it('finds the current table index after surrounding text changes', () => {
        const quill = buildEditor()
        const input = open(quill)
        input.value = 'Shifted'
        quill.insertText(0, 'Remote prefix ', 'api')
        key(input, 'Enter')
        expect(value(quill).rows[1][0]).toBe('Shifted')
        expect(quill.getText()).toBe('Remote prefix Before\nAfter\n')
    })

    it('syncs to another client, persists in Yjs and preserves a conflicting cell draft', () => {
        const a = buildEditor()
        const b = buildEditor()
        const docA = new Y.Doc()
        const docB = new Y.Doc()
        docA.getText('quill').applyDelta(a.getContents().ops)
        Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA))
        const bindingA = new QuillBinding(docA.getText('quill'), a)
        const bindingB = new QuillBinding(docB.getText('quill'), b)
        docA.on('update', update => Y.applyUpdate(docB, update))
        const draft = open(b, 1, 1)
        draft.value = 'Unsaved local status'
        // Separate browser clients have independent focus. Apply A's committed
        // cell delta without focusing A's input in this shared JSDOM document.
        const index = a.getIndex(Quill.find(tableNode(a)))
        a.updateContents(
            new (Quill.import('delta'))()
                .retain(index)
                .delete(1)
                .insert({
                    markdownTable: { ...TABLE, rows: [TABLE.rows[0], ['Collaborator', 'Open'], TABLE.rows[2]] },
                }),
            'user'
        )
        expect(value(b).rows[1][0]).toBe('Collaborator')
        expect(value(b).rows[1][1]).toBe('Open')
        const recovery = b.container.querySelector('.ql-table-draft-recovery textarea')
        expect(recovery.value).toBe('Unsaved local status')
        expect(b.getText()).not.toContain('Unsaved')
        const restored = new Y.Doc()
        Y.applyUpdate(restored, Y.encodeStateAsUpdate(docA))
        expect(
            restored
                .getText('quill')
                .toDelta()
                .find(op => op.insert?.markdownTable).insert.markdownTable
        ).toEqual(value(a))
        bindingA.destroy()
        bindingB.destroy()
        docA.destroy()
        docB.destroy()
        restored.destroy()
    })

    it('flushes a focused draft before the note cleanup saves', () => {
        const quill = buildEditor()
        open(quill).value = 'Leaving note'
        quill.getModule('markdownTableEditing').finish(true)
        expect(value(quill).rows[1][0]).toBe('Leaving note')
    })
})
