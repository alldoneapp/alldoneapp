import Quill from 'quill'

import { getPlaceholderData, QUILL_EDITOR_TEXT_INPUT_TYPE } from './textInputHelper'

const Module = Quill.import('core/module')
const Clipboard = Quill.import('modules/clipboard')
const History = Quill.import('modules/history')
const SnowTheme = Quill.import('themes/snow')

// The chevron the old patched dist used for picker labels (replaces quill's sort-arrows icon).
export const PICKER_CHEVRON_SVG = `<svg
  class="ql-fill ql-stroke ql-chevron"
  viewBox="-1 -2 21 21">
  <path
  d="M 5.9902344,7.9902344 A 1.0001,1.0001 0 0 0 5.2929688,9.7070312 l 6.0000002,5.9999998 a 1.0001,1.0001 0 0 0 1.414062,0 l 6,-5.9999998 A 1.0001,1.0001 0 1 0 17.292969,8.2929688 L 12,13.585938 6.7070312,8.2929688 A 1.0001,1.0001 0 0 0 5.9902344,7.9902344 Z"/>
  </svg>
`

// Replaces the retired quill-1 dist patch (replacement_node_modules/quill). Every editor
// passes an app-encoded placeholder (`text#editorType#editorId#…`, see createPlaceholder);
// this module decodes it, tags the editor DOM with the per-editor classes the rest of the
// app looks up, and keeps the raw metadata off the visible placeholder. It must be listed
// in every <ReactQuill> modules config (`editorMeta: true`).
class EditorMeta extends Module {
    constructor(quill, options) {
        super(quill, options)
        const meta = getPlaceholderData(quill.options.placeholder || '')
        quill.editorMeta = meta
        quill.enablePasteListener = meta.editorType === QUILL_EDITOR_TEXT_INPUT_TYPE
        quill.appManagedCopy = true
        if (meta.editorId) {
            quill.container.classList.add(`ql-container-${meta.editorId}`)
            quill.root.classList.add(`ql-editor-${meta.editorId}`)
        }
        // Quill writes options.placeholder into the root's data-placeholder attribute
        // after module init, so stripping the metadata here keeps the visible text clean.
        quill.options.placeholder = meta.placeholderText || ''
    }
}

// Reads editor metadata whether or not the editorMeta module ran (headless editors
// created with plain `new Quill(node)` have no placeholder encoding).
export const getEditorMeta = quill =>
    quill.editorMeta ? quill.editorMeta : getPlaceholderData((quill.options && quill.options.placeholder) || '')

// Quill 2 (unlike 1.x) captures copy/cut/paste on the editor root itself. The app owns
// copy/cut on every real editor (onCopy in textInputHelper — quill's cut capture would
// delete the selection a second time), and owns paste for note-type editors (the notes
// editor attaches its own markdown/html paste pipeline).
class GatedClipboard extends Clipboard {
    onCaptureCopy(e, isCut) {
        if (this.quill.appManagedCopy) return
        super.onCaptureCopy(e, isCut)
    }

    onCapturePaste(e) {
        if (this.quill.enablePasteListener === false) return
        super.onCapturePaste(e)
    }

    // AT-2416. Quill places the post-paste caret at `delta.length() - range.length`, i.e. it
    // derives the position from the delta it was ABOUT to apply. That is only correct while
    // nothing else edits the document during the same update — and in this app something
    // always might: the autoformat module listens for `text-change` and rewrites a pasted
    // task/note/goal URL into a one-character embed (plus a leading space when the link opens
    // the line). A 46-character URL collapsing to one character leaves quill's index ~45
    // characters too far to the right, so pasting a task link mid-sentence dropped the caret
    // at the end of the line instead of behind the link. It only looked correct when the paste
    // happened at the end of the text, where quill clamps the overshoot to the last index.
    //
    // Everything a paste inserts lands at `range.index`, so the honest measure of how much was
    // inserted is how much the document actually grew, taken AFTER the update (and therefore
    // after every synchronous `text-change` listener has had its turn). For a paste nothing
    // rewrites, this resolves to exactly the index quill would have chosen.
    onPaste(range, { text, html }) {
        const lengthBefore = this.quill.getLength()
        super.onPaste(range, { text, html })
        const inserted = this.quill.getLength() - lengthBefore + range.length
        this.quill.setSelection(range.index + inserted, Quill.sources.SILENT)
        this.quill.scrollSelectionIntoView()
    }
}

// History with the beforeUndoRedo hook from the retired dist patch: the hook may consume
// the top stack entry itself (hashtag color changes push non-delta entries) and return
// false to cancel quill's own undo/redo.
class HookedHistory extends History {
    undo() {
        const hook = this.options.beforeUndoRedo
        if (hook && hook(this.stack, 'undo', 'redo') === false) return
        super.undo()
    }

    redo() {
        const hook = this.options.beforeUndoRedo
        if (hook && hook(this.stack, 'redo', 'undo') === false) return
        super.redo()
    }
}

export const decoratePicker = picker => {
    const { select } = picker
    const items = picker.container.querySelectorAll('.ql-picker-item')
    Array.from(select.options).forEach((option, index) => {
        const item = items[index]
        if (!item) return
        if (option.hasAttribute('data-html')) {
            item.innerHTML = option.getAttribute('data-html')
        }
        // Quill 1 stamped data-value onto items whenever the option carried a value
        // attribute — including value="" — while quill 2 skips falsy values. The app
        // CSS keys the header picker's layout and its text-hiding rules off
        // [data-value=''], so restore the quill-1 behavior.
        if (option.hasAttribute('value') && !item.hasAttribute('data-value')) {
            item.setAttribute('data-value', option.getAttribute('value'))
        }
    })
    if (select.hasAttribute('data-html')) {
        picker.label.innerHTML += select.getAttribute('data-html')
    }
    if (select.classList.contains('ql-header')) {
        // The header picker label mirrors the selected item's icon (the quill-1 patched
        // look) instead of quill's default sort-arrows glyph. Two quill-2 deltas matter
        // here: selectItem() now copies the item's data-label onto the LABEL — which the
        // vendored CSS renders as literal text via `content: attr(data-label)`, so it
        // must be stripped — and selectItem() early-returns when the selection is
        // unchanged, so the label is synced from the current .ql-selected item rather
        // than from selectItem's argument.
        const syncLabel = () => {
            picker.label.removeAttribute('data-label')
            const selectedItem = picker.container.querySelector('.ql-picker-item.ql-selected')
            // The label must ALWAYS carry data-value (empty for "Normal text") — the
            // app CSS hides the fallback ::before text via [data-value='']::before
            // { display: none }, which quill 1 satisfied by keeping the empty
            // attribute and quill 2 breaks by removing it.
            picker.label.setAttribute('data-value', (selectedItem && selectedItem.getAttribute('data-value')) || '')
            const selectedIcon = selectedItem && selectedItem.querySelector('.ql-header-item-icon')
            picker.label.innerHTML = ''
            if (selectedIcon) {
                picker.label.appendChild(selectedIcon.cloneNode(true))
            } else {
                picker.label.innerHTML = PICKER_CHEVRON_SVG
            }
        }
        const originalSelectItem = picker.selectItem.bind(picker)
        picker.selectItem = (item, trigger) => {
            originalSelectItem(item, trigger)
            syncLabel()
        }
        syncLabel()
    }
}

// Snow theme with the app's toolbar affordances: `data-html` payloads on toolbar buttons
// and picker <option>s render as rich labels (shortcut hints, color swatches), and the
// built-in cmd/ctrl+K link binding is dropped — the app binds ctrl+k itself and inserts
// its own url embed instead of quill's link tooltip flow.
class CustomSnowTheme extends SnowTheme {
    extendToolbar(toolbar) {
        super.extendToolbar(toolbar)
        if (toolbar.container == null) return
        toolbar.container.querySelectorAll('button[data-html]').forEach(button => {
            button.innerHTML += button.getAttribute('data-html')
        })
        ;(this.pickers || []).forEach(decoratePicker)
        const kBindings = this.quill.keyboard.bindings['k']
        if (kBindings) {
            this.quill.keyboard.bindings['k'] = kBindings.filter(binding => !binding.shortKey)
        }
    }
}

// Quill 2's `focus()` and `setSelection()` end in `scrollSelectionIntoView()`,
// which walks EVERY scrollable ancestor of the editor up to `document.body` and
// scrolls each one so the caret rect is inside it — finishing with a
// `window.scrollBy` for the document itself. Quill 1 did the opposite: it saved
// its own `scrollingContainer.scrollTop` around `selection.focus()`, put it back
// afterwards, and only ever scrolled that one container. The app relied on that:
// an inline task editor is mounted with `autoFocus`, so since the Quill 2
// migration simply opening a task line can scroll the task list, a detailed view
// or the page underneath it — the "jumping around" in AT-2220. It fires up to
// three times per open (mount focus, `setSelection` after the initial text, and
// the parent's own `focus()`), and again on every mention insert and popup
// dismiss.
//
// Restore the Quill 1 contract without reimplementing any of Quill's geometry:
// remember where every scroll container ABOVE the editor's own scroll boundary
// was, let Quill do exactly what it does today, then put those containers back.
// Everything at or inside the boundary — the `.ql-editor`'s own scrollbar, the
// editor's own scroll view — still follows the caret unchanged.
//
// The boundary is opt-in per editor (`quill.scrollBoundaryElement`, set by
// CustomTextInput3). An editor that does not set one — the notes document
// editor, whose page scroller SHOULD follow the caret — keeps Quill's stock
// behaviour, so this cannot regress it.
export const confineScrollRectIntoView = original => {
    function scrollRectIntoViewWithinBoundary(rect) {
        const boundary = this.scrollBoundaryElement
        if (!boundary || typeof document === 'undefined' || !boundary.parentElement) {
            return original.call(this, rect)
        }

        const frozen = []
        for (let node = boundary.parentElement; node; node = node.parentElement) {
            frozen.push({ node, top: node.scrollTop, left: node.scrollLeft })
        }
        const view = typeof window !== 'undefined' ? window : null
        const pageX = view ? view.scrollX : 0
        const pageY = view ? view.scrollY : 0

        try {
            return original.call(this, rect)
        } finally {
            // Plain assignment, never scrollTo(): `html { scroll-behavior: smooth }`
            // would otherwise animate the restore and show the very jump we are
            // suppressing. Assignment on these containers is instant — they do not
            // set scroll-behavior themselves.
            frozen.forEach(({ node, top, left }) => {
                if (node.scrollTop !== top) node.scrollTop = top
                if (node.scrollLeft !== left) node.scrollLeft = left
            })
            if (view && (view.scrollX !== pageX || view.scrollY !== pageY)) {
                view.scrollTo({ left: pageX, top: pageY, behavior: 'instant' })
            }
        }
    }
    scrollRectIntoViewWithinBoundary.confinesScrollToEditor = true
    return scrollRectIntoViewWithinBoundary
}

Quill.prototype.scrollRectIntoView = confineScrollRectIntoView(Quill.prototype.scrollRectIntoView)

Quill.register('modules/editorMeta', EditorMeta, true)
Quill.register('modules/clipboard', GatedClipboard, true)
Quill.register('modules/history', HookedHistory, true)
Quill.register('themes/snow', CustomSnowTheme, true)
