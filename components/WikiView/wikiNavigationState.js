import { useEffect, useState } from 'react'

// Which wiki page is open, per project. Deliberately not redux: it concerns one view, and a slice
// written on every page change would re-render every store subscriber for it (AT-2336). The URL
// trigger writes it, the view reads and writes it.

const selectedSlugByProject = new Map()
const listeners = new Set()

export function getWikiSelectedSlug(projectId) {
    return selectedSlugByProject.get(projectId) || null
}

export function setWikiSelectedSlug(projectId, slug) {
    if (!projectId) return
    const next = slug || null
    if (getWikiSelectedSlug(projectId) === next) return
    if (next) selectedSlugByProject.set(projectId, next)
    else selectedSlugByProject.delete(projectId)
    listeners.forEach(listener => listener(projectId, next))
}

export function useWikiSelectedSlug(projectId) {
    const [slug, setSlug] = useState(() => getWikiSelectedSlug(projectId))

    useEffect(() => {
        setSlug(getWikiSelectedSlug(projectId))
        const listener = (changedProjectId, nextSlug) => {
            if (changedProjectId === projectId) setSlug(nextSlug)
        }
        listeners.add(listener)
        return () => listeners.delete(listener)
    }, [projectId])

    return [slug, nextSlug => setWikiSelectedSlug(projectId, nextSlug)]
}
