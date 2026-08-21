import { useEffect, useRef, useState } from 'react'

import Backend from '../../utils/BackendBridge'
import { awaitWriteAck } from '../../utils/backends/offlineWriteAck'

/**
 * The rating logic behind every happiness editor (AT-2392).
 *
 * Extracted verbatim from the "new day" popup (EndDayStatisticsModal), which
 * was the only place that could rate a project until Settings → Happiness
 * gained its own "Rate happiness" button. Both surfaces now share ONE write
 * path, which is the whole point of the extraction: `setProjectHappiness`
 * writes a fresh feed entry plus a feed-count bump on every call, so a second
 * hand-rolled copy of this would immediately re-introduce AT-2367's duplicate
 * feed entries in the new surface.
 *
 * What it owns:
 *   - the rating / comment / comment-visibility state per project,
 *   - the per-day watcher that seeds it from what is already stored,
 *   - the deduplicated write path (`persistedHappinessRef`),
 *   - the dirty-draft flush a caller triggers when it closes or switches day.
 *
 * @param {object[]} projects  projects to rate, in display order
 * @param {string} userId      the rating user (ratings are private per user)
 * @param {number} date        timestamp of the rated DAY (any time of day)
 * @param {boolean} watchEnabled  attach the per-day watchers; `false` while the
 *        host popup is closed / offline / anonymous
 * @param {string} watcherKeyPrefix  unique per host, suffixed with the project id
 * @param {(error: Error, label: string) => void} [onError]
 */
export default function useProjectHappinessEditor({
    projects = [],
    userId,
    date,
    watchEnabled = true,
    watcherKeyPrefix = 'project_happiness_editor',
    onError,
}) {
    const [ratings, setRatings] = useState({})
    const [comments, setComments] = useState({})
    const [visibleComments, setVisibleComments] = useState({})

    const commentInputRefs = useRef({})
    const pendingCommentFocusProjectIdRef = useRef(null)
    const dirtyHappinessProjectIdsRef = useRef(new Set())
    const happinessDraftsRef = useRef({})
    // Signature (`date|rating|comment`) of the last value written for a
    // project, so the same happiness entry is never written twice. Rating taps
    // persist immediately AND used to be re-persisted by "Start new day", and
    // every `setProjectHappiness` writes a fresh feed entry plus a feed-count
    // bump — so one rating produced two identical feed entries (AT-2367).
    // The date is part of the signature because this editor can now switch
    // days (AT-2392): without it, rating two days the same way would look like
    // a repeat of the first write and the second day would never be stored.
    const persistedHappinessRef = useRef({})
    const watchedDateRef = useRef(date)

    const projectIds = projects.map(project => project.id)
    const projectIdsKey = projectIds.join(',')

    const getSignature = (targetDate, rating, comment) => `${targetDate}|${rating}|${comment || ''}`

    const reportError = (error, label) => {
        // Never rethrow: by the time these run the value is already local and
        // the popup may already be closed. Logging with the failing step is
        // what makes a real failure diagnosable instead of a silent swallow.
        if (onError) onError(error, label)
        else console.warn(`[Happiness] "${label}" failed`, error)
    }

    /**
     * Single write path for a project's happiness entry.
     *
     * Deduplicated on the last written value, because the same entry is
     * reachable from several places (rating tap, comment blur, close/flush)
     * and each `setProjectHappiness` writes a new feed entry.
     *
     * `targetDate` is explicit rather than closed over so a flush triggered BY
     * a day change still writes the drafts against the day they were typed on.
     */
    const persistHappiness = (project, rating, comment, targetDate = date) => {
        dirtyHappinessProjectIdsRef.current.delete(project.id)
        if (!rating) return Promise.resolve()

        const cleanComment = comment || ''
        const signature = getSignature(targetDate, rating, cleanComment)
        if (persistedHappinessRef.current[project.id] === signature) return Promise.resolve()
        persistedHappinessRef.current[project.id] = signature

        return awaitWriteAck(
            Backend.setProjectHappiness(project.id, userId, targetDate, rating, cleanComment, project),
            'project happiness'
        ).catch(error => {
            // Let a retry through: the value was not stored after all.
            if (persistedHappinessRef.current[project.id] === signature)
                delete persistedHappinessRef.current[project.id]
            reportError(error, 'setProjectHappiness')
        })
    }

    /**
     * Reads the unsaved drafts SYNCHRONOUSLY and returns a thunk that writes
     * them, so a caller can hand the writes to something that runs later.
     *
     * "Start new day" needs exactly this: it closes the popup before it issues
     * any I/O (AT-2367), and closing resets this editor — so a flush called
     * after the close finds an empty draft set and silently writes nothing.
     * Taking the snapshot at press time keeps both properties: nothing is
     * awaited in front of the close, and a comment the user typed but never
     * blurred is still stored.
     */
    const takeDirtyEntries = (targetDate = date) => {
        const dirtyProjectIds = dirtyHappinessProjectIdsRef.current
        const pendingEntries = projects.reduce((pendingEntries, project) => {
            if (!dirtyProjectIds.has(project.id)) return pendingEntries

            const draft = happinessDraftsRef.current[project.id] || {}
            const rating = draft.rating || ratings[project.id]
            const comment = draft.comment != null ? draft.comment : comments[project.id] || ''
            pendingEntries.push({ project, rating, comment })
            return pendingEntries
        }, [])

        dirtyProjectIds.clear()

        if (pendingEntries.length === 0) return () => Promise.resolve()
        return () =>
            Promise.all(
                pendingEntries.map(({ project, rating, comment }) =>
                    persistHappiness(project, rating, comment, targetDate)
                )
            )
    }

    const saveDirtyEntries = (targetDate = date) => takeDirtyEntries(targetDate)()

    const clearDrafts = () => {
        setRatings({})
        setComments({})
        setVisibleComments({})
        pendingCommentFocusProjectIdRef.current = null
        dirtyHappinessProjectIdsRef.current.clear()
        happinessDraftsRef.current = {}
        persistedHappinessRef.current = {}
    }

    const setRating = (project, rating) => {
        dirtyHappinessProjectIdsRef.current.add(project.id)
        happinessDraftsRef.current[project.id] = {
            ...happinessDraftsRef.current[project.id],
            rating,
            comment: comments[project.id] || happinessDraftsRef.current[project.id]?.comment || '',
        }
        setRatings(state => ({ ...state, [project.id]: rating }))
        persistHappiness(project, rating, comments[project.id] || '')
    }

    const setComment = (project, comment) => {
        dirtyHappinessProjectIdsRef.current.add(project.id)
        happinessDraftsRef.current[project.id] = {
            ...happinessDraftsRef.current[project.id],
            rating: ratings[project.id] || happinessDraftsRef.current[project.id]?.rating,
            comment,
        }
        setComments(state => ({ ...state, [project.id]: comment }))
    }

    const saveComment = project => {
        persistHappiness(project, ratings[project.id], comments[project.id] || '')
    }

    const toggleComment = projectId => {
        setVisibleComments(state => {
            const willShow = !state[projectId]
            pendingCommentFocusProjectIdRef.current = willShow ? projectId : null
            return { ...state, [projectId]: willShow }
        })
    }

    const registerCommentInput = (projectId, ref) => {
        if (ref) commentInputRefs.current[projectId] = ref
        else delete commentInputRefs.current[projectId]
    }

    /**
     * Switching the rated day (Settings → Happiness lets you pick one).
     *
     * Declared BEFORE the watcher effect so it runs first in the same commit:
     * the stale day's values are flushed and cleared before the new day's
     * watchers can deliver anything. The flush names the PREVIOUS day
     * explicitly — writing a comment typed for Monday onto Tuesday because the
     * user changed the date before the field blurred would be silent data
     * corruption.
     */
    useEffect(() => {
        if (watchedDateRef.current === date) return

        const previousDate = watchedDateRef.current
        watchedDateRef.current = date
        saveDirtyEntries(previousDate)
        clearDrafts()
    }, [date])

    useEffect(() => {
        if (!watchEnabled || !userId || !date || projectIds.length === 0) return

        const watcherKeys = projectIds.map(projectId => `${watcherKeyPrefix}_${projectId}`)
        projects.forEach(project => {
            Backend.watchProjectHappinessByRange(
                project.id,
                userId,
                date,
                date,
                `${watcherKeyPrefix}_${project.id}`,
                (projectId, entries) => {
                    const entry = entries[0]
                    if (entry) {
                        happinessDraftsRef.current[projectId] = {
                            rating: entry.rating,
                            comment: entry.comment || '',
                        }
                        // Already stored server-side: never re-write it.
                        persistedHappinessRef.current[projectId] = getSignature(date, entry.rating, entry.comment)
                        setRatings(state => ({ ...state, [projectId]: entry.rating }))
                        setComments(state => ({ ...state, [projectId]: entry.comment || '' }))
                    }
                }
            )
        })

        return () => {
            watcherKeys.forEach(key => Backend.unwatch(key))
        }
    }, [projectIdsKey, userId, date, watchEnabled, watcherKeyPrefix])

    useEffect(() => {
        const projectId = pendingCommentFocusProjectIdRef.current
        if (!projectId || !visibleComments[projectId]) return

        const timeoutId = setTimeout(() => {
            commentInputRefs.current[projectId]?.focus?.()
            pendingCommentFocusProjectIdRef.current = null
        })

        return () => clearTimeout(timeoutId)
    }, [visibleComments])

    return {
        ratings,
        comments,
        visibleComments,
        setRating,
        setComment,
        saveComment,
        toggleComment,
        registerCommentInput,
        saveDirtyEntries,
        takeDirtyEntries,
        reset: clearDrafts,
    }
}
