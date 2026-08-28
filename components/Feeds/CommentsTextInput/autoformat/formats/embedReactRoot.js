import ReactDOM from 'react-dom'

/**
 * A React root mounted inside a quill 2 embed needs its OWN element to own (AT-2454).
 *
 * Every React-backed blot in this app used to render with `ReactDOM.render(<Provider …/>, node)`
 * where `node` is the blot's own `domNode`. That is not a container React can keep: quill 2's
 * `blots/embed` constructor runs immediately after `create()` returns and MOVES every child of
 * `node` into a private `contentNode`, then wraps it in the two cursor-guard text nodes
 * (`node_modules/quill/blots/embed.js`). React is never told, so its container stays `node`
 * while its root host child now lives one level down. Three things follow, and all three end in
 * a tag the user cannot see:
 *
 *  - a container-level INSERT is appended to `node`, i.e. AFTER the right guard instead of
 *    inside `contentNode`. A component whose first render produces no host element (an early
 *    `return null`) therefore renders its real content into the wrong place;
 *  - a container-level DELETE calls `node.removeChild(child)` on a node that is no longer its
 *    child and throws `NotFoundError` in the commit phase. These roots have no error boundary,
 *    so React 18 tears the whole root down and leaves an EMPTY embed span behind — while the
 *    blot and its Yjs entry are untouched, which is exactly why reloading the note brings the
 *    tag back. `AppPopover` makes precisely that swap (`<Popover>` ⇄ fragment + `BottomSheet`)
 *    whenever the viewport crosses `MODAL_SHEET_BREAKPOINT`, i.e. on a rotation or a resize;
 *  - a SECOND `ReactDOM.render` into the same node — `url.js` renders again from an async
 *    `Backend.getObjectFromUrl` callback — finds a container whose content "was removed without
 *    using React", empties it (guards and `contentNode` included) and mounts from scratch.
 *
 * Giving React its own mount element fixes all three: quill relocates that element with React's
 * whole subtree inside it, and React's container stays a real parent of its own children for the
 * life of the blot. `display: contents` keeps the extra element out of layout, so the rendered
 * box is byte-identical to before.
 */
export const EMBED_REACT_ROOT_CLASS = 'ql-embed-react-root'

export const getEmbedReactRoot = node => {
    if (!node || typeof node.querySelector !== 'function') return null
    // Before the blot is constructed the mount node is a direct child of `node`; afterwards
    // quill has moved it inside `contentNode`, so the lookup has to cover the whole subtree.
    return node.querySelector(`.${EMBED_REACT_ROOT_CLASS}`)
}

const GUARD_TEXT = '﻿'
const TEXT_NODE = 3
const ELEMENT_NODE = 1

/**
 * Where a freshly created mount node belongs.
 *
 * During `create()` the blot does not exist yet, so the only place to put it is the node itself
 * — quill's constructor relocates it a moment later. Afterwards the node's children are
 * `[leftGuard, contentNode, rightGuard]` and the mount node has to go INSIDE `contentNode`:
 * appending to the node would leave it after the right guard, outside the non-editable region
 * quill maintains for the embed.
 */
const resolveMountParent = node => {
    const firstChild = node.firstChild
    if (!firstChild || firstChild.nodeType !== TEXT_NODE || firstChild.data !== GUARD_TEXT) return node

    const contentNode = Array.from(node.childNodes).find(
        child => child.nodeType === ELEMENT_NODE && child.getAttribute('contenteditable') === 'false'
    )
    return contentNode || node
}

export const createEmbedReactRoot = node => {
    const existing = getEmbedReactRoot(node)
    if (existing) return existing

    const mountNode = document.createElement('span')
    mountNode.className = EMBED_REACT_ROOT_CLASS
    mountNode.setAttribute('style', 'display: contents')
    resolveMountParent(node).appendChild(mountNode)
    return mountNode
}

/**
 * Drop-in replacement for `ReactDOM.render(element, blotDomNode)`. Returns the mount node so a
 * caller that renders more than once keeps writing into the same React root.
 */
export const renderEmbedContent = (node, element) => {
    const mountNode = createEmbedReactRoot(node)
    if (!mountNode) return null
    ReactDOM.render(element, mountNode)
    return mountNode
}

/**
 * Tears the root down. Only used where a blot knows its node is gone for good; quill itself
 * never calls back into the app when it drops an embed.
 */
export const unmountEmbedContent = node => {
    const mountNode = getEmbedReactRoot(node)
    if (mountNode) ReactDOM.unmountComponentAtNode(mountNode)
}
