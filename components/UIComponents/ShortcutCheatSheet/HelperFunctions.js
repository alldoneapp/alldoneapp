import dom from 'react-dom'

export const execShortcutFn = (ref, shortcutFunction, event) => {
    document.activeElement.blur()
    dom.findDOMNode(ref).click()
    shortcutFunction()
    if (event != null) {
        event.preventDefault()
    }
}
