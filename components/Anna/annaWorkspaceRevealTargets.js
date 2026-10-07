const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]+$/.test(value)

// React Native Web replaces ScrollView's DOM node.scrollTo with its { x, y,
// animated } API. Call the browser implementation directly so DOM coordinates
// remain correct for both ScrollViews and ordinary elements, including cancel.
export function scrollWorkspaceContainer(node, top, reducedMotion = false) {
    const scrollTo = node.ownerDocument?.defaultView?.Element?.prototype.scrollTo
    if (typeof scrollTo === 'function') {
        scrollTo.call(node, { top, left: node.scrollLeft, behavior: reducedMotion ? 'instant' : 'smooth' })
    } else node.scrollTop = top
}

// These markers are attached by Alldone to real rows and detail titles. A model
// cannot supply selectors or select a different object with the same name.
export function findWorkspaceObject(root, change) {
    if (
        !root ||
        !['task', 'note', 'contact'].includes(change?.type) ||
        !validId(change.objectId) ||
        !validId(change.projectId)
    )
        return null
    const selector = `[data-anna-object-type="${change.type}"][data-anna-object-id="${change.objectId}"][data-anna-project-id="${change.projectId}"]`
    return (
        Array.from(root.querySelectorAll(selector)).find(node => {
            const box = node.getBoundingClientRect()
            return (
                !node.closest('[hidden], [aria-hidden="true"], [data-anna-highlight-ui]') &&
                box.width > 0 &&
                box.height > 0 &&
                window.getComputedStyle(node).visibility !== 'hidden'
            )
        }) || null
    )
}

// Scroll only inside Alldone. scrollIntoView would also move the outer shell or
// the conversation, and jump immediately when a row is already in view.
export function scrollWorkspaceObject(node, root, reducedMotion = false) {
    const scrolling = []
    const original = node.getBoundingClientRect()
    let offset = 0
    for (let parent = node.parentElement; parent && root.contains(parent); parent = parent.parentElement) {
        if (
            !/(auto|scroll)/.test(window.getComputedStyle(parent).overflowY) ||
            parent.scrollHeight <= parent.clientHeight
        )
            continue
        const box = { top: original.top - offset, bottom: original.bottom - offset, height: original.height }
        const pane = parent.getBoundingClientRect()
        if (box.top >= pane.top + 32 && box.bottom <= pane.bottom - 16) continue
        const target = parent.scrollTop + box.top - pane.top - Math.max(32, (parent.clientHeight - box.height) / 2)
        const top = Math.max(0, Math.min(parent.scrollHeight - parent.clientHeight, target))
        if (Math.abs(top - parent.scrollTop) > 1) {
            offset += top - parent.scrollTop
            scrollWorkspaceContainer(parent, top, reducedMotion)
            scrolling.push(parent)
        }
    }
    return scrolling
}

export function workspaceObjectRect(node, root) {
    if (!node?.isConnected || !root?.contains(node) || node.closest('[hidden], [aria-hidden="true"]')) return null
    const box = node.getBoundingClientRect()
    if (!box.width || !box.height) return null
    const pane = root.getBoundingClientRect()
    let left = Math.max(box.left - 4, pane.left + 3, 3)
    let top = Math.max(box.top - 4, pane.top + 3, 3)
    let right = Math.min(box.right + 4, pane.right - 3, window.innerWidth - 3)
    let bottom = Math.min(box.bottom + 4, pane.bottom - 3, window.innerHeight - 3)
    for (let parent = node.parentElement; parent && root.contains(parent); parent = parent.parentElement) {
        const style = window.getComputedStyle(parent)
        const bounds = parent.getBoundingClientRect()
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
            left = Math.max(left, bounds.left + 2)
            right = Math.min(right, bounds.right - 2)
        }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
            top = Math.max(top, bounds.top + 2)
            bottom = Math.min(bottom, bounds.bottom - 2)
        }
    }
    return right - left >= 8 && bottom - top >= 8 ? { left, top, width: right - left, height: bottom - top } : null
}
