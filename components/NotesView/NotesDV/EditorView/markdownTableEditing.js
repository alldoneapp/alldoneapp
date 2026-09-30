import Quill from 'quill'

const Delta = Quill.import('delta')
const CELL_SELECTOR = '.ql-markdown-table [data-row][data-column]'
const INPUT_SELECTOR = '.ql-table-cell-input'
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
        this.listen('pointerdown', event => this.onPointerDown(event))
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
        event.preventDefault()
        event.stopPropagation()
        this.openCell(cell)
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
                this.finish(false, true)
            } else if (event.key === 'Enter') {
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
        if (cell && this.quill.isEnabled() && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            event.stopImmediatePropagation()
            this.openCell(cell)
        }
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
        const input = document.createElement('input')
        input.type = 'text'
        input.className = 'ql-table-cell-input'
        input.value = String(data.rows[row]?.[column] ?? '')
        input.setAttribute('aria-label', this.translate('Edit table cell'))
        // Stop at the input itself, preserving its native keyboard/default actions.
        // The app's document clipboard handlers and Quill's clipboard,
        // keyboard and composition handlers all bubble from the input.
        input.addEventListener('keydown', event => this.onKeyDown(event))
        INPUT_EVENTS.forEach(type => input.addEventListener(type, event => event.stopPropagation()))
        const originalChildren = Array.from(cell.childNodes).map(child => child.cloneNode(true))
        this.active = { node: currentNode, cell, input, row, column, originalChildren, snapshot: JSON.stringify(data) }
        this.selected = { node: currentNode, row, column }
        cell.replaceChildren(input)
        input.addEventListener('blur', event => {
            if (this.active?.input !== input) return
            const action = event.relatedTarget?.dataset.tableAction
            const replacement = this.finish(true)
            if (action && replacement !== currentNode) {
                replacement?.querySelector(`[data-table-action="${action}"]`)?.focus()
            }
        })
        this.showControls()
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
        active.cell.replaceChildren(...active.originalChildren)
        let node = active.node
        if (commit && value !== String(data.rows[active.row]?.[active.column] ?? '')) {
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
        const original = JSON.parse(active.snapshot).rows[active.row]?.[active.column] ?? ''
        this.active = null
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
        const input = document.createElement('input')
        input.type = 'text'
        input.value = draft
        input.readOnly = true
        input.setAttribute('aria-label', this.translate('Unsaved table cell text'))
        const dismiss = document.createElement('button')
        dismiss.type = 'button'
        dismiss.textContent = this.translate('Dismiss')
        dismiss.addEventListener('click', () => recovery.remove())
        recovery.append(message, input, dismiss)
        this.quill.container.appendChild(recovery)
    }

    destroy() {
        this.listeners.forEach(([type, handler]) => this.quill.root.removeEventListener(type, handler, true))
        this.quill.off('text-change', this.onChange)
        this.enabledObserver.disconnect()
        this.clearControls()
        this.quill.container.querySelectorAll('.ql-table-draft-recovery').forEach(node => node.remove())
    }
}

Quill.register('modules/markdownTableEditing', MarkdownTableEditing, true)
