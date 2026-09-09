import { useEffect, useMemo, useRef, useState } from 'react'
import { multiSearchTypesense } from '../../../../utils/typesenseSearch'
import { formatTypesenseValue } from '../../../GlobalSearchAlgolia/typesenseSearchFilters'
import { GOALS_INDEX_NAME_PREFIX } from '../../../GlobalSearchAlgolia/searchIndexes'

// Independent pages prevent other projects from crowding the task's own goals out.
// Keep both cursors: a failed page can be retried without losing successful results.
export default function useParentGoalSearch({ projectId, userId, projectsMap, query }) {
    const sessionRef = useRef(null)
    const [state, setState] = useState({ hits: [], loading: true, error: false, hasMore: false })
    const projectScope = JSON.stringify(Object.keys(projectsMap).sort())

    const load = async session => {
        if (!session?.active || session.loading) return
        const pending = session.scopes.filter(scope => scope.hasMore)
        if (!pending.length) return
        session.loading = true
        setState(previous => ({ ...previous, loading: true, error: false }))
        let error = false
        try {
            const results = await multiSearchTypesense(
                pending.map(scope => ({
                    collection: GOALS_INDEX_NAME_PREFIX,
                    query: session.query,
                    matchAllWhenEmpty: true,
                    page: scope.page,
                    filterBy: `projectId:=[${scope.ids.map(formatTypesenseValue).join(',')}] && isPublicFor:=[${formatTypesenseValue(
                        0
                    )},${formatTypesenseValue(session.userId)}]`,
                }))
            )
            if (!session.active) return
            pending.forEach((scope, index) => {
                const result = results[index]
                if (!result || result.error) {
                    error = true
                    return
                }
                scope.hits.push(...result.hits)
                scope.page += 1
                scope.hasMore = result.hasMore
            })
        } catch (_) {
            error = true
        }
        if (!session.active) return
        session.loading = false
        setState({
            hits: session.scopes.flatMap(scope => scope.hits),
            loading: false,
            error,
            hasMore: session.scopes.some(scope => scope.hasMore),
        })
    }

    useEffect(() => {
        const ids = JSON.parse(projectScope)
        const session = {
            active: true,
            loading: false,
            query,
            userId,
            scopes: [ids.filter(id => id === projectId), ids.filter(id => id !== projectId)]
                .filter(ids => ids.length)
                .map(ids => ({ ids, page: 1, hits: [], hasMore: true })),
        }
        sessionRef.current = session
        setState({ hits: [], loading: session.scopes.length > 0, error: false, hasMore: false })
        load(session)
        return () => {
            session.active = false
        }
    }, [projectId, userId, projectScope, query])

    const hits = useMemo(() => {
        const unique = new Map()
        state.hits.forEach(goal => {
            if (projectsMap[goal.projectId]) unique.set(`${goal.projectId}/${goal.id}`, goal)
        })
        // Match the rendered project grouping so keyboard navigation selects the visible row.
        const groups = [...new Set([...unique.values()].map(goal => goal.projectId))].sort((a, b) => {
            if (a === projectId) return -1
            if (b === projectId) return 1
            return (projectsMap[a]?.index ?? 999) - (projectsMap[b]?.index ?? 999)
        })
        return [...unique.values()].sort((a, b) => groups.indexOf(a.projectId) - groups.indexOf(b.projectId))
    }, [state.hits, projectsMap, projectId])

    return { ...state, hits, loadMore: () => load(sessionRef.current) }
}
