import { useEffect, useMemo } from 'react'

import { ensureProjectDataLoaded, ensureProjectsDataLoaded } from '../utils/InitialLoad/projectDataLoader'

/**
 * AT-2386 — "this view needs project X's people".
 *
 * The per-project collections (users, contacts, workstreams, assistants) are no longer part of the
 * login bundle, so a view that enumerates them has to say so. `TasksHelper`'s lookup funnels
 * already self-heal on a miss, which covers rendering a KNOWN id; this hook covers the other
 * shape — a view that needs the whole list before it can render anything (the Contacts board, the
 * assignee pickers, the sidebar people section).
 *
 * Loading is idempotent inside the loader, so calling this from several mounted components for the
 * same project costs one watcher. Nothing is unsubscribed on unmount on purpose: the watcher is
 * shared process-wide and the data it holds is exactly what the next view will want. Watchers stay
 * bounded because `updateInactiveProjectsData` has already limited redux to the active projects.
 */
export default function useProjectData(projectId, kinds) {
    // `kinds` is usually an inline array literal, which would be a new identity on every render.
    const kindsKey = Array.isArray(kinds) ? kinds.join('|') : kinds || ''

    useEffect(() => {
        if (!projectId) return
        ensureProjectDataLoaded(projectId, kinds)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId, kindsKey])
}

/**
 * Same, for a list of projects — the all-projects boards. The ids are joined into a stable key so
 * a freshly derived array of the same ids does not re-run the effect.
 */
export function useProjectsData(projectIds, kinds, { enabled = true } = {}) {
    const ids = useMemo(() => (Array.isArray(projectIds) ? projectIds.filter(Boolean) : []), [projectIds])
    const idsKey = ids.join('|')
    const kindsKey = Array.isArray(kinds) ? kinds.join('|') : kinds || ''

    useEffect(() => {
        if (!enabled || ids.length === 0) return
        ensureProjectsDataLoaded(ids, kinds)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, idsKey, kindsKey])
}
