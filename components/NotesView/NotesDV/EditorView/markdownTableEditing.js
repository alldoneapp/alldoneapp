import Quill from 'quill'
import { normalizeMarkdownTableCell } from '../../../../utils/markdownTableParser'

const Delta = Quill.import('delta')
const CELL_SELECTOR = '.ql-markdown-table [data-row][data-column]'
const INPUT_SELECTOR = '.ql-table-cell-input'
const TAP_SLOP = 10 // CSS pixels; allow small finger jitter in either direction.
const INPUT_EVENTS = ['copy', 'cut', 'paste', 'beforeinput', 'compositionstart', 'compositionupdate', 'compositionend']

// Cell inputs live inside an immutable BlockEmbed. Only a committed Quill delta
// changes the document: DOM edits alone would bypass Yjs, history and autosave.
export default class MarkdownTableEditing {
    constructor(quill, options = {}) {
        this.quill = quill
        this.translate = options.translate || (text => text)
        this.active = null
        this.selected = null
        this.listeners = []
        this.touchGesture = null
        this.touchListeners = []
        // Quill 2 restores the document selection after DOM mutations. A
        // textarea has its own native selection: interpreting it as a note
        // caret replaces its editing selection with a DOM Range on TEXTAREA,
        // which stops native typing after the textarea grows. Exclude only the
        // focused cell control; document caret handling otherwise stays intact.
        const selection = quill.selection
        this.originalNativeRange = selection.getNativeRange
        this.cellNativeRange = (...args) => {
            if (this.active?.input === document.activeElement) return null
            return this.originalNativeRange.apply(selection, args)
        }
        selection.getNativeRange = this.cellNativeRange
        this.listen('pointerdown', event => this.onPointerDown(event))
        this.listen('mousedown', event => {
            // Touch synthesizes mousedown before click. Do not let it blur a
            // draft and replace the tapped table before onClick can open it.
            if (this.touchGesture && event.target.closest?.(CELL_SELECTOR) && !event.target.closest(INPUT_SELECTOR)) {
                event.preventDefault()
                event.stopPropagation()
            }
        })
        this.listen('click', event => this.onClick(event))
        this.listen('keydown', event => {
            if (!event.target.closest?.(INPUT_SELECTOR)) this.onKeyDown(event)
        })
        this.onChange = delta => {
            if (this.active && !this.isCurrent(this.active)) this.preserveDraft()
            if (this.selected && !this.quill.root.contains(this.selected.node)) this.selected = null
            // Ordinary note typing must not walk every table cell on each key.
            if (delta.ops.some(op => op.insert?.markdownTable)) this.refreshCells()
        }
        quill.on('text-change', this.onChange)
        this.enabledObserver = new MutationObserver(() => {
            if (!quill.isEnabled()) {
                if (this.touchGesture) this.touchGesture.cancelled = true
                this.stopTouchTracking()
                this.preserveDraft()
                this.clearControls()
            }
            this.refreshCells()
        })
        this.enabledObserver.observe(quill.root, { attributes: true, attributeFilter: ['contenteditable'] })
        this.refreshCells()
    }

    listen(type, handler) {
        this.quill.root.addEventListener(type, handler, true)
        this.listeners.push([type, handler])
    }

    refreshCells() {
        this.quill.root.querySelectorAll(CELL_SELECTOR).forEach(cell => {
            if (this.quill.isEnabled()) {
                cell.tabIndex = 0
                cell.setAttribute('aria-label', this.translate('Edit table cell'))
            } else {
                cell.removeAttribute('tabindex')
                cell.removeAttribute('aria-label')
            }
        })
    }

    onPointerDown(event) {
        // A second finger must not replace the first finger's cancelled gesture.
        if (this.touchListeners.length && event.pointerId !== this.touchGesture.pointerId) return
        this.stopTouchTracking()
        this.touchGesture = null
        if (!this.quill.isEnabled()) return
        if (event.target.closest?.('.ql-table-controls')) {
            // A toolbar click must not blur/replace the table before click fires.
            if (event.target.closest('button')) event.preventDefault()
            event.stopPropagation()
            return
        }
        const cell = event.target.closest?.(CELL_SELECTOR)
        if (!cell) {
            this.finish(true)
            this.selected = null
            this.clearControls()
            return
        }
        if (event.target.closest(INPUT_SELECTOR)) return
        if (event.pointerType === 'touch' || event.pointerType === 'pen') {
            this.trackTouchTap(event, cell)
            return // Leave native horizontal table and vertical page panning intact.
        }
        event.preventDefault()
        event.stopPropagation()
        this.openCell(cell)
    }

    trackTouchTap(event, cell) {
        const gesture = {
            cell,
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            cancelled: event.isPrimary === false,
            ended: false,
        }
        this.touchGesture = gesture
        const move = event => {
            if (event.pointerId !== gesture.pointerId) return
            if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > TAP_SLOP) gesture.cancelled = true
        }
        const end = event => {
            if (event.pointerId !== gesture.pointerId) return
            move(event)
            if (event.type === 'pointercancel') gesture.cancelled = true
            gesture.ended = true
            this.stopTouchTracking()
            // Keep the result until the next pointerdown to reject a delayed
            // compatibility click after a swipe or cancelled native pan.
        }
        this.touchListeners = [
            [
                'pointerdown',
                event => {
                    if (event.pointerId !== gesture.pointerId) gesture.cancelled = true
                },
            ],
            ['pointermove', move],
            ['pointerup', end],
            ['pointercancel', end],
            [
                'scroll',
                event => {
                    if (event.target.contains?.(cell)) gesture.cancelled = true
                },
            ],
        ]
        // Track outside the editor too, including scrolls on its ancestors.
        this.touchListeners.forEach(([type, handler]) =>
            document.addEventListener(type, handler, { capture: true, passive: true })
        )
    }

    stopTouchTracking() {
        this.touchListeners.forEach(([type, handler]) => document.removeEventListener(type, handler, true))
        this.touchListeners = []
    }

    onClick(event) {
        if (!this.quill.isEnabled()) return
        const button = event.target.closest?.('[data-table-action]')
        if (button) {
            event.stopPropagation()
            this.applyAction(button.dataset.tableAction)
            return
        }
        const cell = event.target.closest?.(CELL_SELECTOR)
        if (cell && !event.target.closest(INPUT_SELECTOR)) {
            event.stopPropagation()
            // Keyboard/programmatic clicks (detail 0) retain their usual path.
            if (
                event.detail !== 0 &&
                this.touchGesture &&
                (!this.touchGesture.ended || this.touchGesture.cancelled || this.touchGesture.cell !== cell)
            )
                return
            this.openCell(cell)
        }
    }

    onKeyDown(event) {
        const input = event.target.closest?.(INPUT_SELECTOR)
        if (input) {
            event.stopImmediatePropagation()
            if (this.active?.input !== input) return
            if (event.isComposing || event.keyCode === 229) return
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
                event.preventDefault()
                input.select()
            } else if (event.key === 'Escape') {
                event.preventDefault()
                this.cancelEdit()
            } else if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                this.finish(true, true)
            } else if (event.key === 'Tab') {
                event.preventDefault()
                const { row, column } = this.active
                const node = this.finish(true)
                if (!node) return
                const cells = Array.from(node.querySelectorAll(CELL_SELECTOR))
                const index = cells.findIndex(cell => +cell.dataset.row === row && +cell.dataset.column === column)
                const next = cells[index + (event.shiftKey ? -1 : 1)]
                if (next) this.openCell(next)
                else
                    this.quill.setSelection(this.quill.getIndex(Quill.find(node)) + (event.shiftKey ? 0 : 1), 0, 'user')
            }
            return
        }
        const cell = event.target.closest?.(CELL_SELECTOR)
        if (event.key === 'Escape' && this.selected && (cell || event.target.closest?.('.ql-table-controls'))) {
            event.preventDefault()
            event.stopImmediatePropagation()
            this.cancelEdit()
            return
        }
        if (cell && this.quill.isEnabled() && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            event.stopImmediatePropagation()
            this.openCell(cell)
        }
    }

    cancelEdit() {
        const selected = this.selected
        this.finish(false)
        this.selected = null
        this.clearControls()
        selected?.node.querySelector(`[data-row="${selected.row}"][data-column="${selected.column}"]`)?.focus()
    }

    openCell(cell) {
        if (!this.quill.isEnabled()) return
        const node = cell.closest('.ql-markdownTable')
        const row = +cell.dataset.row
        const column = +cell.dataset.column
        if (this.active?.cell === cell) return
        // Committing another cell replaces its entire table, including this cell.
        const sameTable = this.active?.node === node
        const committedNode = this.finish(true)
        const currentNode = sameTable ? committedNode : node
        if (!currentNode || !this.quill.root.contains(currentNode)) return
        cell = currentNode.querySelector(`[data-row="${row}"][data-column="${column}"]`)
        const data = Quill.find(currentNode).value().markdownTable
        const input = document.createElement('textarea')
        input.rows = 1
        input.className = 'ql-table-cell-input'
        input.value = normalizeMarkdownTableCell(data.rows[row]?.[column])
        input.setAttribute('aria-label', this.translate('Edit table cell'))
        // Stop at the input itself, preserving its native keyboard/default actions.
        // The app's document clipboard handlers and Quill's clipboard,
        // keyboard and composition handlers all bubble from the input.
        input.addEventListener('keydown', event => this.onKeyDown(event))
        INPUT_EVENTS.forEach(type => input.addEventListener(type, event => event.stopPropagation()))
        // Replacing a long cell with a form control must not redistribute the
        // table's column widths. Restore the original layout when editing ends.
        const table = cell.closest('table')
        const headers = Array.from(table.rows[0].cells)
        const widths = headers.map(header => header.getBoundingClientRect().width)
        const tableStyle = table.style.cssText
        const headerStyles = headers.map(header => header.style.cssText)
        table.style.width = `${table.getBoundingClientRect().width}px`
        table.style.tableLayout = 'fixed'
        headers.forEach((header, index) => {
            header.style.boxSizing = 'border-box'
            header.style.width = `${widths[index]}px`
        })
        const restoreLayout = () => {
            table.style.cssText = tableStyle
            headers.forEach((header, index) => (header.style.cssText = headerStyles[index]))
        }
        const originalChildren = Array.from(cell.childNodes).map(child => child.cloneNode(true))
        const resize = () => {
            input.style.height = '0px'
            input.style.height = `${input.scrollHeight}px`
        }
        const resizeObserver = new ResizeObserver(() => {
            if (this.active?.input !== input || input.clientWidth === this.active.inputWidth) return
            this.active.inputWidth = input.clientWidth
            resize()
        })
        this.active = {
            node: currentNode,
            cell,
            input,
            row,
            column,
            originalChildren,
            snapshot: JSON.stringify(data),
            restoreLayout,
            resizeObserver,
        }
        this.selected = { node: currentNode, row, column }
        cell.replaceChildren(input)
        input.addEventListener('input', event => {
            event.stopPropagation()
            resize()
        })
        resize()
        resizeObserver.observe(input)
        input.addEventListener('blur', event => {
            if (this.active?.input !== input) return
            const action = event.relatedTarget?.dataset.tableAction
            const replacement = this.finish(true)
            if (action && replacement !== currentNode) {
                replacement?.querySelector(`[data-table-action="${action}"]`)?.focus()
            }
        })
        this.showControls()
        this.quill.blur()
        input.focus({ preventScroll: true })
    }

    isCurrent(active) {
        return (
            this.quill.root.contains(active.node) &&
            JSON.stringify(Quill.find(active.node)?.value().markdownTable) === active.snapshot
        )
    }

    finish(commit, focusCell = false) {
        const active = this.active
        if (!active) return this.selected?.node || null
        if (!this.isCurrent(active) || (commit && !this.quill.isEnabled())) {
            this.preserveDraft()
            return null
        }
        const data = JSON.parse(active.snapshot)
        const value = active.input.value
        this.active = null // Removed inputs can blur synchronously during updateContents.
        active.resizeObserver.disconnect()
        active.restoreLayout()
        active.cell.replaceChildren(...active.originalChildren)
        let node = active.node
        if (commit && value !== normalizeMarkdownTableCell(data.rows[active.row]?.[active.column])) {
            const rows = data.rows.map(row => row.slice())
            rows[active.row][active.column] = value
            node = this.replaceTable(node, { ...data, rows })
        }
        this.selected = { node, row: active.row, column: active.column }
        // Keep already-focused controls alive when a blur committed no change.
        if (node !== active.node || !node.querySelector('.ql-table-controls')) this.showControls()
        if (focusCell) node.querySelector(`[data-row="${active.row}"][data-column="${active.column}"]`)?.focus()
        return node
    }

    replaceTable(node, data) {
        const index = this.quill.getIndex(Quill.find(node))
        const id = data.id || node.dataset.id
        this.clearControls()
        this.quill.history.cutoff()
        this.quill.updateContents(
            new Delta()
                .retain(index)
                .delete(1)
                .insert({ markdownTable: { ...data, id } }),
            'user'
        )
        this.quill.history.cutoff()
        return this.quill.getLeaf(index)[0].domNode
    }

    clearControls() {
        this.quill.root.querySelectorAll('.ql-table-controls').forEach(controls => controls.remove())
    }

    showControls() {
        this.clearControls()
        if (!this.selected || !this.quill.isEnabled()) return
        const { node, row, column } = this.selected
        if (!this.quill.root.contains(node)) return
        const data = Quill.find(node).value().markdownTable
        const controls = document.createElement('div')
        controls.className = 'ql-table-controls'
        controls.setAttribute('role', 'group')
        controls.setAttribute('aria-label', this.translate('Table controls'))
        const actions = [
            ['add-row', 'Add row', false],
            ['remove-row', 'Remove row', row === 0 || data.rows.length <= 1],
            ['add-column', 'Add column', false],
            ['remove-column', 'Remove column', data.rows[0].length <= 1],
            ['align-left', 'Align left', false],
            ['align-center', 'Align center', false],
            ['align-right', 'Align right', false],
        ]
        actions.forEach(([action, label, disabled]) => {
            const button = document.createElement('button')
            button.type = 'button'
            button.dataset.tableAction = action
            button.textContent = this.translate(label)
            button.disabled = disabled
            button.addEventListener('keydown', event => {
                // Let the button's native activation run without Quill also
                // treating Enter/Space as a keystroke in the note document.
                if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
            })
            if (action.startsWith('align-'))
                button.setAttribute('aria-pressed', data.alignments[column] === action.slice(6))
            controls.appendChild(button)
        })
        node.appendChild(controls)
    }

    applyAction(action) {
        if (!this.quill.isEnabled() || !this.selected) return
        const node = this.finish(true)
        if (!node) return
        let { row, column } = this.selected
        const data = Quill.find(node).value().markdownTable
        const rows = data.rows.map(cells => cells.slice())
        const alignments = data.alignments.slice()
        const width = Math.max(...rows.map(cells => cells.length))
        rows.forEach(cells => {
            while (cells.length < width) cells.push('')
        })
        if (action === 'add-row') rows.splice(++row, 0, Array(width).fill(''))
        else if (action === 'remove-row' && row > 0) {
            rows.splice(row, 1)
            row = Math.min(row, rows.length - 1)
        } else if (action === 'add-column') {
            rows.forEach(cells => cells.splice(column + 1, 0, ''))
            while (alignments.length < width) alignments.push(null)
            alignments.splice(++column, 0, null)
        } else if (action === 'remove-column' && width > 1) {
            rows.forEach(cells => cells.splice(column, 1))
            alignments.splice(column, 1)
            column = Math.min(column, width - 2)
        } else if (action.startsWith('align-')) alignments[column] = action.slice(6)
        else return
        const replacement = this.replaceTable(node, { ...data, rows, alignments })
        this.selected = { node: replacement, row, column }
        this.openCell(replacement.querySelector(`[data-row="${row}"][data-column="${column}"]`))
    }

    preserveDraft() {
        const active = this.active
        if (!active) return
        const draft = active.input.value
        const original = normalizeMarkdownTableCell(JSON.parse(active.snapshot).rows[active.row]?.[active.column])
        this.active = null
        active.resizeObserver.disconnect()
        active.restoreLayout()
        active.cell.replaceChildren(...active.originalChildren)
        this.selected = null
        this.clearControls()
        if (draft === String(original)) return
        // Outside the Quill root: recovery UI must never become note content.
        const recovery = document.createElement('div')
        recovery.className = 'ql-table-draft-recovery'
        recovery.setAttribute('role', 'alert')
        const message = document.createElement('p')
        message.textContent = this.translate('Table editing stopped. Your unsaved cell text is preserved below.')
        const input = document.createElement('textarea')
        input.value = draft
        input.readOnly = true
        input.rows = Math.max(2, draft.split('\n').length)
        input.setAttribute('aria-label', this.translate('Unsaved table cell text'))
        const dismiss = document.createElement('button')
        dismiss.type = 'button'
        dismiss.textContent = this.translate('Dismiss')
        dismiss.addEventListener('click', () => recovery.remove())
        recovery.append(message, input, dismiss)
        this.quill.container.appendChild(recovery)
    }

    destroy() {
        this.stopTouchTracking()
        this.touchGesture = null
        this.finish(false)
        if (this.quill.selection.getNativeRange === this.cellNativeRange) {
            this.quill.selection.getNativeRange = this.originalNativeRange
        }
        this.listeners.forEach(([type, handler]) => this.quill.root.removeEventListener(type, handler, true))
        this.quill.off('text-change', this.onChange)
        this.enabledObserver.disconnect()
        this.clearControls()
        this.quill.container.querySelectorAll('.ql-table-draft-recovery').forEach(node => node.remove())
    }
}

Quill.register('modules/markdownTableEditing', MarkdownTableEditing, true)
