import Quill from 'quill'
import { installTaskTagSelectionCollapse } from './taskTagSelection'

const Embed = Quill.import('blots/embed')
class TaskFixture extends Embed {
    static blotName = 'taskTagFormat'
    static tagName = 'span'
    static className = 'test-task'
    static create() {
        const node = super.create()
        node.textContent = 'Task with date and avatar'
        return node
    }
    static value() {
        return { taskId: 'task-1' }
    }
}
Quill.register(TaskFixture, true)

let editor
let host
// jsdom has selection but no layout; geometry/paint is tested in the browser harness.
const rect = () => ({ left: 0, right: 0, top: 0, bottom: 20, width: 0, height: 20 })
beforeAll(() => {
    Range.prototype.getBoundingClientRect = rect
    Range.prototype.getClientRects = () => [rect()]
})
afterAll(() => {
    delete Range.prototype.getBoundingClientRect
    delete Range.prototype.getClientRects
})
beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    editor = new Quill(host)
    installTaskTagSelectionCollapse(editor)
    editor.setContents([{ insert: 'das' }, { insert: { taskTagFormat: { taskId: 'task-1' } } }, { insert: 'adada\n' }])
})
afterEach(() => host.remove())

const press = (key, options = {}) =>
    editor.root.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }))

it.each([
    ['ArrowLeft', 4, 5, 4],
    ['ArrowRight', 0, 3, 3],
    ['ArrowLeft', 3, 3, 3],
    ['ArrowRight', 1, 3, 4],
])('collapses %s to the selected edge beside the task', (key, index, length, expected) => {
    const original = editor.getContents()
    editor.setSelection(index, length)
    press(key)
    expect(editor.getSelection()).toEqual({ index: expected, length: 0 })
    expect(editor.getContents()).toEqual(original)
})

it('retains collapsed navigation across the task and Shift selection', () => {
    editor.setSelection(4, 0)
    press('ArrowLeft')
    expect(editor.getSelection()).toEqual({ index: 3, length: 0 })
    press('ArrowRight')
    expect(editor.getSelection()).toEqual({ index: 4, length: 0 })
    press('ArrowLeft', { shiftKey: true })
    expect(editor.getSelection()).toEqual({ index: 3, length: 1 })
})

it('collapses a selection between two tasks without crossing either task', () => {
    editor.setContents([
        { insert: { taskTagFormat: { taskId: 'task-1' } } },
        { insert: 'text' },
        { insert: { taskTagFormat: { taskId: 'task-2' } } },
        { insert: '\n' },
    ])
    const original = editor.getContents()
    editor.setSelection(1, 4)
    press('ArrowLeft')
    expect(editor.getSelection()).toEqual({ index: 1, length: 0 })
    editor.setSelection(1, 4)
    press('ArrowRight')
    expect(editor.getSelection()).toEqual({ index: 5, length: 0 })
    expect(editor.getContents()).toEqual(original)
})

it('leaves ordinary text, other embeds and modified arrows to existing handlers', () => {
    editor.setSelection(5, 3)
    expect(press('ArrowLeft')).toBe(true)
    editor.setSelection(4, 3)
    expect(press('ArrowLeft', { shiftKey: true })).toBe(false)
    expect(editor.getSelection()).toEqual({ index: 3, length: 4 })
    editor.setSelection(4, 3)
    expect(press('ArrowLeft', { ctrlKey: true })).toBe(true)
    expect(editor.getSelection()).toEqual({ index: 4, length: 3 })
    editor.setContents([{ insert: { image: 'https://example.invalid/image.png' } }, { insert: 'text\n' }])
    editor.setSelection(1, 3)
    // Quill's original embed handler still runs for a non-task image.
    press('ArrowLeft')
    expect(editor.getSelection()).toEqual({ index: 0, length: 0 })
})
