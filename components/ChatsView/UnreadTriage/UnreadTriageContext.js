import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { UNREAD_SORT_NEWEST, UNREAD_TAG_ALL, UNREAD_TAG_ORDER } from './unreadMessageTags'

/**
 * State of the unread list (Chats > Unread) shared by the filter line and every project section:
 * the selected tag, the sort, and what each project section is showing.
 *
 * The rows only exist inside the project sections, because each section subscribes to its own
 * chats' unread comments. So the sections publish their tag counts and the comments they show,
 * and the filter line (chip counts) and the "Mark as read" buttons (act on what is visible) read
 * them back. Same pattern as UnreadEmailArchiveProvider, whose registry the sections also feed so
 * the existing "Archive emails" buttons and the Gmail read sync keep working in this view.
 */
const UnreadTriageContext = createContext(null)

const sameProjectEntry = (previous, next) =>
    !!previous &&
    previous.countsKey === next.countsKey &&
    previous.refsKey === next.refsKey &&
    previous.loaded === next.loaded

export function UnreadTriageProvider({ children }) {
    const [tagFilter, setTagFilter] = useState(UNREAD_TAG_ALL)
    const [sortMode, setSortMode] = useState(UNREAD_SORT_NEWEST)
    const [projects, setProjects] = useState({})

    const registerProject = useCallback((projectId, counts, visibleCommentRefs, loaded = true) => {
        const entry = {
            counts,
            visibleCommentRefs,
            loaded: !!loaded,
            countsKey: JSON.stringify(counts),
            refsKey: visibleCommentRefs.map(ref => ref.commentId).join('|'),
        }
        setProjects(current =>
            sameProjectEntry(current[projectId], entry) ? current : { ...current, [projectId]: entry }
        )
    }, [])

    const unregisterProject = useCallback(projectId => {
        setProjects(current => {
            if (!current[projectId]) return current
            const { [projectId]: removed, ...rest } = current
            return rest
        })
    }, [])

    const value = useMemo(
        () => ({ tagFilter, setTagFilter, sortMode, setSortMode, projects, registerProject, unregisterProject }),
        [tagFilter, sortMode, projects, registerProject, unregisterProject]
    )

    return <UnreadTriageContext.Provider value={value}>{children}</UnreadTriageContext.Provider>
}

export function useUnreadTriage() {
    return useContext(UnreadTriageContext)
}

export const sumTagCounts = (projects, projectIds) => {
    const totals = {}
    ;(projectIds || Object.keys(projects || {})).forEach(projectId => {
        const counts = projects?.[projectId]?.counts || {}
        Object.keys(counts).forEach(tag => {
            totals[tag] = (totals[tag] || 0) + counts[tag]
        })
    })
    return totals
}

export const collectVisibleCommentRefs = (projects, projectIds) =>
    (projectIds || Object.keys(projects || {})).flatMap(projectId => projects?.[projectId]?.visibleCommentRefs || [])

/**
 * True when a tag filter is selected and leaves nothing in any of `projectIds` (the projects that
 * have unread chats), once every one of them has loaded its messages. All Projects then shows one
 * global empty state instead of the hidden project sections (AT-3112). Waiting for every project to
 * register and load keeps it from flashing while the messages are still arriving.
 */
export const isTagFilterEmptyEverywhere = (triage, projectIds) => {
    if (!triage || triage.tagFilter === UNREAD_TAG_ALL || !projectIds || projectIds.length === 0) return false
    return projectIds.every(projectId => {
        const entry = triage.projects?.[projectId]
        return !!entry && entry.loaded && entry.visibleCommentRefs.length === 0
    })
}

/**
 * Every project of `projectIds` that has registered with the unread list has loaded all its chats'
 * first snapshots. Projects without unread chats never mount a list (and count nothing), so they do
 * not hold the decision back.
 */
export const isTriageScopeLoaded = (projects, projectIds) =>
    (projectIds || Object.keys(projects || {}))
        .filter(projectId => !!projects?.[projectId])
        .every(projectId => projects[projectId].loaded)

/**
 * The tag to select once `currentTag` has nothing left (AT-3120): the next tag after it in the chip
 * order (UNREAD_TAG_ORDER) that still has unread messages, wrapping around to the start (decided with
 * Karsten, 2026-11-20). Null when no other tag has any, or `currentTag` is not a tag chip.
 */
export const getNextUnreadTag = (currentTag, counts, order = UNREAD_TAG_ORDER) => {
    const start = order.indexOf(currentTag)
    if (start === -1) return null
    for (let step = 1; step < order.length; step += 1) {
        const tag = order[(start + step) % order.length]
        if ((counts?.[tag] || 0) > 0) return tag
    }
    return null
}

/**
 * AT-3120: when the selected tag chip (e.g. "Ads") drops to zero unread messages while the user
 * looks at it, select the next tag that still has some instead of staying on an empty tag. Any
 * cause counts (archive or mark as read in the list, the Gmail read sync, another device; decided
 * 2026-11-20). Only the tag changes; the project and the Unread filter stay as they are.
 *
 * Guards against switching on a transient state:
 * - The tag is armed only after it was seen with messages in a fully loaded scope, so selecting a
 *   tag, switching project or entering Unread never jumps by itself on stale or missing data.
 * - The drop to zero counts only once every registered project in the scope has loaded.
 * - A different scope (the selected project changed) disarms.
 *
 * When no other tag has unread messages, nothing changes here: the tag's empty state shows, and
 * once the whole scope has nothing unread the existing flows take over (AT-3104/3108 open the task
 * list after an action in the list; ChatFiltersLine leaves Unread when its count is 0).
 */
export function useAutoAdvanceUnreadTag(triage, projectIds) {
    const armedRef = useRef(null)
    const tagFilter = triage?.tagFilter || UNREAD_TAG_ALL
    const setTagFilter = triage?.setTagFilter
    const projects = triage?.projects
    const counts = useMemo(() => sumTagCounts(projects, projectIds), [projects, projectIds])
    const loaded = isTriageScopeLoaded(projects, projectIds)
    const armKey = `${tagFilter}::${(projectIds || []).join('|')}`
    const count = counts[tagFilter] || 0

    useEffect(() => {
        if (!setTagFilter || tagFilter === UNREAD_TAG_ALL) {
            armedRef.current = null
            return
        }
        if (!loaded) return
        if (count > 0) {
            armedRef.current = armKey
            return
        }
        if (armedRef.current !== armKey) return
        armedRef.current = null
        const nextTag = getNextUnreadTag(tagFilter, counts)
        if (nextTag) setTagFilter(nextTag)
    }, [setTagFilter, tagFilter, loaded, count, armKey, counts])
}
