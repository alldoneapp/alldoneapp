import { useEffect, useState } from 'react'

import { getKnowledgeRevisionTitle } from '../../../utils/backends/KnowledgeBase/knowledgeBaseFirestore'

// A wiki feed entry stores no page title (knowledgeWikiFeedModel.js), so its line reads the title
// from the revision. One read per revision and session: a card with several lines, the Followed
// and All tabs and a re-render all share it. Kept for a few minutes only, because a revision's
// title is removed when a source it used is withdrawn and the line should not keep showing it.
const TITLE_CACHE_MS = 5 * 60 * 1000
const titles = new Map()

export function loadWikiFeedPageTitle(projectId, slug, revision, now = Date.now()) {
    const key = `${projectId}/${slug}/${revision}`
    const cached = titles.get(key)
    if (cached && now - cached.at < TITLE_CACHE_MS) return cached.promise
    const promise = getKnowledgeRevisionTitle(projectId, slug, revision).catch(() => null)
    titles.set(key, { promise, at: now })
    return promise
}

export function clearWikiFeedPageTitles() {
    titles.clear()
}

// The page's title in that revision; the slug until it is known, and when it was removed.
export default function useWikiFeedPageTitle(projectId, slug, revision) {
    const [title, setTitle] = useState(null)

    useEffect(() => {
        let cancelled = false
        setTitle(null)
        if (!projectId || !slug) return undefined
        loadWikiFeedPageTitle(projectId, slug, revision).then(loaded => !cancelled && setTitle(loaded))
        return () => {
            cancelled = true
        }
    }, [projectId, slug, revision])

    return title || slug
}
