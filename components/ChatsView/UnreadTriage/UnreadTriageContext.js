import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'

import { UNREAD_SORT_NEWEST, UNREAD_TAG_ALL } from './unreadMessageTags'

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
    !!previous && previous.countsKey === next.countsKey && previous.refsKey === next.refsKey

export function UnreadTriageProvider({ children }) {
    const [tagFilter, setTagFilter] = useState(UNREAD_TAG_ALL)
    const [sortMode, setSortMode] = useState(UNREAD_SORT_NEWEST)
    const [projects, setProjects] = useState({})

    const registerProject = useCallback((projectId, counts, visibleCommentRefs) => {
        const entry = {
            counts,
            visibleCommentRefs,
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
