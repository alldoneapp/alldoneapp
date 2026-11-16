// AT-3028 — a click anywhere in the assistant composer's TEXT FIELD starts typing.
//
// The field is two lines tall at rest (assistantInputLayout.js), but it auto-expands, which sets
// Quill's container and editor to `height: auto` — so the contenteditable itself was only as tall
// as its content (one line), and the blank line under "Start a new chat" was the scroll frame
// around it, which takes no clicks. Two parts fix that:
//
// 1. `assistantInput.css` gives the editor a two-line `min-height`, so the blank line IS the
//    contenteditable and the browser places the caret natively (mouse and touch alike).
// 2. What is left — the field frame's own few pixels of padding — is handled here, on mousedown.
//
// The handler is attached to the field's wrapper only, never to the composer box: the toolbar
// (+, Templates, mic, call, send) and the header must keep their own clicks. It still has to guard
// against them, because the + and the mic are rendered by the text field and PORTALLED into the
// toolbar — and React bubbles synthetic events along the component tree, not the DOM tree, so a
// press on either would otherwise arrive here.

// Anything the user can operate on its own. The editor (`contenteditable`) is in the list on
// purpose: a click that lands in it already does the right thing natively.
const INTERACTIVE_SELECTOR = [
    'button',
    'a[href]',
    'input',
    'textarea',
    'select',
    'label',
    '[contenteditable]:not([contenteditable="false"])',
    '[role="button"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="checkbox"]',
    '[role="switch"]',
    '[role="textbox"]',
    '[tabindex]:not([tabindex="-1"])',
].join(', ')

const isElement = node => !!node && node.nodeType === 1 && typeof node.closest === 'function'

/**
 * Whether a mousedown on the text field's wrapper should be turned into "focus the composer".
 * Only a plain primary-button press that really landed (in the DOM) inside the field, on a
 * non-interactive part of it.
 */
export const shouldFocusComposerFromPointer = event => {
    if (!event || event.defaultPrevented) return false
    if (event.button !== undefined && event.button !== 0) return false
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false

    const field = event.currentTarget
    const target = event.target
    if (!isElement(field) || !isElement(target)) return false

    // A portalled + / mic / mention popup: inside the field in React's tree, not in the DOM.
    if (!field.contains(target)) return false

    const interactive = target.closest(INTERACTIVE_SELECTOR)
    return !(interactive && field.contains(interactive))
}

/**
 * Focuses the composer with the caret at the end of what is already there, which is where a click
 * below or beside the text means to continue. An already focused composer keeps its caret.
 */
export const focusComposerAtEnd = input => {
    if (!input) return
    if (input.isFocused?.()) return

    const editor = input.getEditor?.()
    if (!editor) {
        input.focus?.()
        return
    }

    editor.focus()
    // Quill's length counts the trailing newline it always keeps.
    const end = Math.max(0, (editor.getLength?.() ?? 1) - 1)
    editor.setSelection?.(end, 0)
}

/**
 * The mousedown handler for the field's wrapper. `preventDefault` stops the press from first
 * blurring the editor (and dropping a selection) before focus is handed back.
 */
export const handleComposerFieldMouseDown = (event, input) => {
    if (!input || !shouldFocusComposerFromPointer(event)) return false
    event.preventDefault()
    focusComposerAtEnd(input)
    return true
}
