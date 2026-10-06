/**
 * Quill's embed arrow handlers also run on noncollapsed selections. At a task
 * boundary they jump over the embed instead of simply collapsing the selected
 * text (AT-2697). Claim only unmodified arrows on selections touching a task;
 * collapsed navigation, Shift selection and other embeds keep their handlers.
 */
export const installTaskTagSelectionCollapse = editor => {
    for (const key of ['ArrowLeft', 'ArrowRight']) {
        editor.keyboard.addBinding({ key, shiftKey: false, collapsed: false }, range => {
            const index = key === 'ArrowLeft' ? range.index : range.index + range.length
            const surrounding = editor.getContents(Math.max(0, index - 1), index === 0 ? 1 : 2)
            if (!surrounding.ops.some(op => op.insert?.taskTagFormat)) return true
            editor.setSelection(index, 0, 'user')
            return false
        })
        // addBinding appends; this correction must precede Quill's embed handler.
        const bindings = editor.keyboard.bindings[key]
        bindings.unshift(bindings.pop())
    }
}
