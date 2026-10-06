/**
 * One observer per live note. Defer React roots (and their listeners/media
 * requests), not Quill blots. Activation is one-way: document positions, native
 * selection and already loaded content never disappear during scrolling.
 */
const notes = new Map()
const pending = new WeakMap()

export const enableDeferredNoteEmbeds = (editorId, editorRoot, { subscribe, getTasks } = {}) => {
    if (typeof IntersectionObserver === 'undefined') return () => {}
    const entries = new Map()
    const activate = mount => {
        const entry = entries.get(mount)
        if (!entry) return
        entries.delete(mount)
        pending.delete(mount)
        observer.unobserve(mount)
        mount.removeAttribute('data-deferred-embed')
        // A task's placeholder is only an estimate. Keeping its 480px box
        // after React mounts lets the title/date/avatar overflow over the next
        // text node and its caret (AT-2697). Restore the normal React mount
        // before rendering so Quill's guards follow the entire visible row.
        // Media still needs its reserved box while its dimensions load.
        if (entry.kind === 'task') mount.style.cssText = 'display: contents;'
        entry.render()
    }
    const observer = new IntersectionObserver(
        changes => {
            for (const change of changes) if (change.isIntersecting) activate(change.target)
        },
        { rootMargin: '600px 0px' }
    )
    const activateAll = event => {
        // Native find must see the real labels too, including tasks not in the
        // note's aggregate query (copied tags). Printing likewise needs media.
        if (event.type === 'keydown' && !((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f')) return
        Array.from(entries.keys()).forEach(activate)
    }
    let previousTasks = getTasks?.()
    const unsubscribe = subscribe?.(() => {
        const tasks = getTasks?.()
        if (tasks === previousTasks) return
        previousTasks = tasks
        for (const [mount, entry] of entries) {
            if (entry.getLabel) mount.textContent = entry.getLabel()
        }
    })
    const note = { entries, observer, activate }
    notes.set(editorId, note)
    document.addEventListener('keydown', activateAll)
    window.addEventListener('beforeprint', activateAll)
    editorRoot?.addEventListener('beforematch', activateAll)
    return () => {
        if (notes.get(editorId) === note) notes.delete(editorId)
        observer.disconnect()
        unsubscribe?.()
        for (const mount of entries.keys()) pending.delete(mount)
        entries.clear()
        document.removeEventListener('keydown', activateAll)
        window.removeEventListener('beforeprint', activateAll)
        editorRoot?.removeEventListener('beforematch', activateAll)
    }
}

export const deferNoteEmbed = (mount, render, { editorId, kind, label, getLabel, width = 320, height = 24 } = {}) => {
    const note = notes.get(editorId)
    if (!note) return false
    // Reserve a bounded box until activation. Tasks then use their real row
    // size; media keeps its box until its dimensions are known.
    mount.style.cssText = `display:inline-block;vertical-align:middle;max-width:100%;width:${width}px;height:${height}px;`
    mount.setAttribute('data-deferred-embed', kind)
    mount.setAttribute('contenteditable', 'false')
    mount.textContent = getLabel ? getLabel() : label || ''
    const entry = { render, getLabel, kind }
    note.entries.set(mount, entry)
    pending.set(mount, note)
    note.observer.observe(mount)
    return true
}

export const cancelDeferredNoteEmbed = mount => {
    const note = pending.get(mount)
    if (!note) return
    note.observer.unobserve(mount)
    note.entries.delete(mount)
    pending.delete(mount)
}
