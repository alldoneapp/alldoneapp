import { useEffect, useMemo, useState } from 'react'
import moment from 'moment'
import { shallowEqual, useSelector } from 'react-redux'

import { getDb } from '../../../../utils/backends/firestore'
import { getTasksCompletedTodayQuery } from '../../../../utils/backends/Tasks/myDayDoneTasks'
import { getCalendarConnectedProjectIdsFromApis } from '../../taskBoardCalendarSync'
import {
    getCalendarSyncStatuses,
    subscribeToCalendarSyncStatus,
    summarizeCalendarSyncStatus,
} from '../../../../utils/calendarSyncStatus'
import { deriveMeetingTimeView } from '../../../../utils/meetingTimeToday'
import useMinuteClock from '../../../../hooks/useMinuteClock'

/**
 * AT-3136 — data for the "Meetings / calendar-free" figures in the All projects line.
 *
 * Working hours: the public meeting link settings doc (see utils/meetingTimeToday.js for why).
 *
 * Meetings: the meeting tasks the calendar sync already writes into the user's projects (a meeting
 * is routed to whichever project it belongs to, so every active project is read). Two streams per
 * project, both byte-identical to queries the task board / My Day already run, so Firestore serves
 * them from the same server targets instead of new ones (keep the clause order in step):
 *
 *   - open: `getOpenTasksQuery` state 0 / `watchTasksToAttend` (today's open tasks);
 *   - done today: `getTasksCompletedTodayQuery`, so a meeting ticked off this morning still counts
 *     for the whole working day.
 *
 * Only calendar tasks are kept from the snapshots.
 *
 * Clock: `useMinuteClock` re-derives the view every minute and when the page is visible again, so
 * "time to work" (what is still free from now until the end of the working hours) counts down on
 * its own, without a calendar sync or a navigation. The same clock gives the local day: when it
 * changes (a tab left open over midnight, before `utils/DailyAppReload.js` reloads the page, or
 * while that reload waits for the network), the listeners are re-opened for the new day and the
 * line shows "…" until they answer; yesterday's meetings are never shown as today's.
 */

const getActiveProjectIds = (projectIds, archivedProjectIds, templateProjectIds, guideProjectIds) => {
    const excluded = new Set([...(archivedProjectIds || []), ...(templateProjectIds || []), ...(guideProjectIds || [])])
    return (projectIds || []).filter(projectId => projectId && !excluded.has(projectId))
}

const getCalendarTasksFromSnapshot = snapshot => {
    const tasks = []
    snapshot.forEach(doc => {
        const data = doc.data()
        if (data && data.calendarData) tasks.push({ id: doc.id, name: data.name, calendarData: data.calendarData })
    })
    return tasks
}

export default function useMeetingTimeToday({ enabled = true } = {}) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const projectIds = useSelector(state => state.loggedUser.projectIds, shallowEqual)
    const archivedProjectIds = useSelector(state => state.loggedUser.archivedProjectIds, shallowEqual)
    const templateProjectIds = useSelector(state => state.loggedUser.templateProjectIds, shallowEqual)
    const guideProjectIds = useSelector(state => state.loggedUser.guideProjectIds, shallowEqual)
    const apisConnected = useSelector(state => state.loggedUser.apisConnected, shallowEqual)

    // The assistant profile board renders these views for another `currentUser`; the figures are
    // about the signed-in human's calendar only.
    const active = enabled && !!loggedUserId && !isAnonymous && currentUserId === loggedUserId
    const nowMs = useMinuteClock()
    const dayKey = moment(nowMs).format('YYYY-MM-DD')

    const calendarProjectIds = useMemo(() => getCalendarConnectedProjectIdsFromApis(apisConnected), [apisConnected])
    const calendarConnected = calendarProjectIds.length > 0

    const watchedProjectIdsKey = useMemo(() => {
        if (!calendarConnected) return ''
        const ids = new Set([
            ...getActiveProjectIds(projectIds, archivedProjectIds, templateProjectIds, guideProjectIds),
            ...calendarProjectIds,
        ])
        return [...ids].sort().join(',')
    }, [calendarConnected, projectIds, archivedProjectIds, templateProjectIds, guideProjectIds, calendarProjectIds])

    // undefined = not answered yet, null = no saved settings, object = saved settings.
    const [settings, setSettings] = useState(undefined)
    useEffect(() => {
        if (!active) return undefined
        setSettings(undefined)
        return getDb()
            .doc(`users/${loggedUserId}/bookingSettings/default`)
            .onSnapshot(
                doc => setSettings(doc.exists ? doc.data() || {} : null),
                error => {
                    // Falls back to the labelled default hours rather than hiding the line.
                    console.warn('[MeetingTimeToday] working hours could not be read', error?.message)
                    setSettings(null)
                }
            )
    }, [active, loggedUserId])

    const [tasksState, setTasksState] = useState({ key: '', byStream: {}, error: false })
    useEffect(() => {
        if (!active || !watchedProjectIdsKey) return undefined

        const key = `${watchedProjectIdsKey}|${dayKey}`
        const watchedIds = watchedProjectIdsKey.split(',')
        const day = moment(dayKey, 'YYYY-MM-DD')
        const endOfDay = day.clone().endOf('day').valueOf()
        const startOfToday = day.clone().startOf('day').valueOf()
        const byStream = {}
        let error = false
        let disposed = false
        const publish = () => {
            if (!disposed) setTasksState({ key, byStream: { ...byStream }, error })
        }
        setTasksState({ key, byStream: {}, error: false })

        const onError = streamKey => listenerError => {
            console.warn('[MeetingTimeToday] meeting listener failed', streamKey, listenerError?.message)
            error = true
            publish()
        }

        const unsubscribers = []
        watchedIds.forEach(projectId => {
            const openKey = `${projectId}:open`
            unsubscribers.push(
                getDb()
                    .collection(`items/${projectId}/tasks`)
                    .where('inDone', '==', false)
                    .where('currentReviewerId', '==', loggedUserId)
                    .where('readerIds', 'array-contains', loggedUserId)
                    .where('dueDate', '<=', endOfDay)
                    .onSnapshot(snapshot => {
                        byStream[openKey] = getCalendarTasksFromSnapshot(snapshot)
                        publish()
                    }, onError(openKey))
            )
            const doneKey = `${projectId}:done`
            unsubscribers.push(
                getTasksCompletedTodayQuery(projectId, loggedUserId, loggedUserId, startOfToday).onSnapshot(
                    snapshot => {
                        byStream[doneKey] = getCalendarTasksFromSnapshot(snapshot)
                        publish()
                    },
                    onError(doneKey)
                )
            )
        })

        return () => {
            disposed = true
            unsubscribers.forEach(unsubscribe => unsubscribe())
        }
    }, [active, watchedProjectIdsKey, dayKey, loggedUserId])

    const [syncStatuses, setSyncStatuses] = useState(getCalendarSyncStatuses)
    useEffect(() => subscribeToCalendarSyncStatus(setSyncStatuses), [])

    return useMemo(() => {
        if (!active) return null
        const currentKey = `${watchedProjectIdsKey}|${dayKey}`
        const isCurrent = tasksState.key === currentKey
        const expectedStreams = watchedProjectIdsKey ? watchedProjectIdsKey.split(',').length * 2 : 0
        const tasks = isCurrent ? Object.values(tasksState.byStream).flat() : []
        return deriveMeetingTimeView({
            settings,
            calendarConnected,
            tasksLoaded: isCurrent && Object.keys(tasksState.byStream).length >= expectedStreams,
            tasksError: isCurrent && tasksState.error,
            syncStatus: summarizeCalendarSyncStatus(calendarProjectIds, syncStatuses),
            tasks,
            nowMs,
        })
        // nowMs re-derives the remaining window every minute (and the working window on a new day).
    }, [
        active,
        settings,
        calendarConnected,
        calendarProjectIds,
        tasksState,
        syncStatuses,
        watchedProjectIdsKey,
        dayKey,
        nowMs,
    ])
}
