import { useEffect, useState } from 'react'

// Which wiki page is open, per project, and which of its changes when a change is shown (a feed
// entry or the page history opened it). Deliberately not redux: it concerns one view, and a slice
// written on every page change would re-render every store subscriber for it (AT-2336). The URL
// trigger writes it, the view reads and writes it.

const selectionByProject = new Map()
const listeners = new Set()

const getSelection = projectId => selectionByProject.get(projectId) || { slug: null, revision: null }

export function getWikiSelectedSlug(projectId) {
    return getSelection(projectId).slug
}

export function getWikiSelectedRevision(projectId) {
    return getSelection(projectId).revision
}

// Selecting a page without a revision closes any change that was open.
export function setWikiSelectedSlug(projectId, slug, revision = null) {
    if (!projectId) return
    const nextSlug = slug || null
    const nextRevision = nextSlug && Number.isInteger(revision) && revision > 0 ? revision : null
    const current = getSelection(projectId)
    if (current.slug === nextSlug && current.revision === nextRevision) return
    if (nextSlug) selectionByProject.set(projectId, { slug: nextSlug, revision: nextRevision })
    else selectionByProject.delete(projectId)
    listeners.forEach(listener => listener(projectId, getSelection(projectId)))
}

function useWikiSelection(projectId) {
    const [selection, setSelection] = useState(() => getSelection(projectId))

    useEffect(() => {
        setSelection(getSelection(projectId))
        const listener = (changedProjectId, next) => {
            if (changedProjectId === projectId) setSelection(next)
        }
        listeners.add(listener)
        return () => listeners.delete(listener)
    }, [projectId])

    return selection
}

export function useWikiSelectedSlug(projectId) {
    const { slug } = useWikiSelection(projectId)
    return [slug, nextSlug => setWikiSelectedSlug(projectId, nextSlug)]
}

export function useWikiSelectedRevision(projectId) {
    return useWikiSelection(projectId).revision
}
