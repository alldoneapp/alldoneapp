import { useEffect, useState } from 'react'

// Which wiki page is open, per project, and which of its changes when a change is shown (a feed
// entry or the page history opened it), or since which revision when its recent changes are shown
// together (AT-2878: `since` is the base revision of that comparison, 0 = before the page existed). Deliberately not redux: it concerns one view, and a slice
// written on every page change would re-render every store subscriber for it (AT-2336). The URL
// trigger writes it, the view reads and writes it.

const selectionByProject = new Map()
const listeners = new Set()

const EMPTY_SELECTION = { slug: null, revision: null, since: null }
const getSelection = projectId => selectionByProject.get(projectId) || EMPTY_SELECTION

export function getWikiSelectedSlug(projectId) {
    return getSelection(projectId).slug
}

export function getWikiSelectedRevision(projectId) {
    return getSelection(projectId).revision
}

export function getWikiSelectedSince(projectId) {
    return getSelection(projectId).since
}

function select(projectId, slug, revision, since) {
    if (!projectId) return
    const nextSlug = slug || null
    const nextRevision = nextSlug && Number.isInteger(revision) && revision > 0 ? revision : null
    // A single change and a range are two different views; a single change wins.
    const nextSince = nextSlug && !nextRevision && Number.isInteger(since) && since >= 0 ? since : null
    const current = getSelection(projectId)
    if (current.slug === nextSlug && current.revision === nextRevision && current.since === nextSince) return
    if (nextSlug) selectionByProject.set(projectId, { slug: nextSlug, revision: nextRevision, since: nextSince })
    else selectionByProject.delete(projectId)
    listeners.forEach(listener => listener(projectId, getSelection(projectId)))
}

// Selecting a page without a revision closes any change that was open.
export function setWikiSelectedSlug(projectId, slug, revision = null) {
    select(projectId, slug, revision, null)
}

// Everything a page changed since revision `since`, as one comparison with its newest revision.
export function setWikiSelectedRange(projectId, slug, since) {
    select(projectId, slug, null, since)
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

export function useWikiSelectedSince(projectId) {
    return useWikiSelection(projectId).since
}
