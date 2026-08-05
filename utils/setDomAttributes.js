// react-native-web 0.19+ removed setNativeProps; refs to host components ARE
// the DOM nodes now. Every former setNativeProps call site in this app only
// ever stamped custom attributes (check-box-id, aria-task-id,
// is-observed-task) that DOM-query logic reads back — setAttribute is the
// exact equivalent. Guarded so a not-yet-attached or already-detached ref is
// a no-op instead of a crash.
export const setDomAttributes = (node, attributes) => {
    if (!node || typeof node.setAttribute !== 'function') return
    Object.keys(attributes).forEach(key => {
        node.setAttribute(key, attributes[key])
    })
}
