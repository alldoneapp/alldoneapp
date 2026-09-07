import React, { useEffect, useState, useRef } from 'react'
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import Lottie from 'lottie-react'
import moment from 'moment'

import styles, { colors, em2px, hexColorToRGBa } from '../../styles/global'
import Icon from '../../Icon'
import { deleteCacheAndRefresh } from '../../../utils/Observers'
import { applyPopoverWidth } from '../../../utils/HelperFunctions'
import starsAnimation from '../../../assets/animations/stars.json'
import cloudAnimation from '../../../assets/animations/cloud.json'
import goldAnimation from '../../../assets/animations/coin-gold.json'
import Backend from '../../../utils/BackendBridge'
import { getDateFormat } from './DateFormatPickerModal'
import { translate } from '../../../i18n/TranslationService'
import { getIfLoggedUserReachedEmptyInbox } from '../../ContactsView/Utils/ContactsHelper'
import store from '../../../redux/store'
import { setShowNewDayNotification, storeLoggedUser } from '../../../redux/actions'
import UserDataCache from '../../../utils/UserDataCache'
import {
    ESTIMATION_TYPE_POINTS,
    ESTIMATION_TYPE_TIME,
    getEstimationTypeByProjectId,
} from '../../../utils/EstimationHelper'
import { setUserStatisticsModalDate } from '../../../utils/backends/Users/usersFirestore'
import { needToAcknowledgeNewDay, startNewDay as runStartNewDay } from '../../../utils/NewDayModalHelper'
import { awaitWriteAck } from '../../../utils/backends/offlineWriteAck'
import {
    normalizeDayRateTimeLogConfig,
    reconcileProjectDayRateTimeLogsBackfill,
} from '../../../utils/DayRateTimeLogHelper'
import ProjectDayActivity from '../../ProjectHappiness/ProjectDayActivity'
import ProjectHappinessRatingList from '../../ProjectHappiness/ProjectHappinessRatingList'
import useProjectHappinessEditor from '../../ProjectHappiness/useProjectHappinessEditor'
import { getHappinessProjects } from '../../ProjectHappiness/happinessProjects'
import { getSafeStatisticNumber } from '../../../utils/StatisticDataHelper'
import { getEndDayMoneyEarnedSummary } from './EndDayStatisticsHelper'
import useSafeAreaOverlayPadding from '../../../hooks/useSafeAreaOverlayPadding'
import {
    CONNECTION_HEALTH_LIVE,
    CONNECTION_HEALTH_OFFLINE,
    CONNECTION_HEALTH_RECONNECTING,
    CONNECTION_HEALTH_STALE,
    reconnectNow,
} from '../../../utils/connectionHealth'

/**
 * Ceiling for the statistics re-read that follows a successful reconnect
 * (AT-2391). `getUserStatistics` is callback-based and reports nothing when it
 * neither resolves nor rejects, so without a bound the button could spin
 * forever on a connection that came back and died again mid-read — the
 * "spinner that never goes away" failure this codebase keeps re-learning.
 * Generous, because by this point the transport has been *proven* alive: it is
 * a backstop, not the normal path.
 */
export const RECONNECT_STATISTICS_TIMEOUT_MS = 15000

/**
 * Last-resort UI ceiling for the shared reconnect operation itself. The
 * connection layer bounds its probes and transport restarts, but the popup
 * must still own a deadline so a regression below it can never strand the
 * button in its loading state again.
 */
export const RECONNECT_ATTEMPT_TIMEOUT_MS = 25000

/**
 * Stages of a manual reconnect, kept apart because the offline latch means
 * opposite things in each: while PROBING the card is still legitimately
 * offline, so a completion check must not read that latch as "the retry
 * failed"; while RELOADING the latch has been cleared and setting it again IS
 * the retry failing.
 */
const RECONNECT_IDLE = ''
const RECONNECT_PROBING = 'probing'
const RECONNECT_RELOADING = 'reloading'
const RECONNECT_FAILED = 'failed'

export default function EndDayStatisticsModal() {
    const safeAreaOverlayPadding = useSafeAreaOverlayPadding()
    const loggedUserProjectsAmount = useSelector(state => state.loggedUserProjects.length)
    const statisticsModalDate = useSelector(state => state.loggedUser.statisticsModalDate)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const projectIdsAmount = useSelector(state => state.loggedUser.projectIds.length)
    const showNewDayNotification = useSelector(state => state.showNewDayNotification)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const showNewVersionMandtoryNotifcation = useSelector(state => state.showNewVersionMandtoryNotifcation)
    const templateProjectIdsAmount = useSelector(state => state.loggedUser.templateProjectIds.length)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const loggedUser = useSelector(state => state.loggedUser)
    // Both connection signals, because they answer different questions and the
    // popup is reachable in either state: `connectionState` is what the BROWSER
    // reports, `connectionHealth` is whether the app is actually talking to the
    // server (PT-4660) — the transport can be dead while the browser still says
    // online. Primitives, so this cannot amplify renders (AT-2336).
    const connectionState = useSelector(state => state.connectionState)
    const connectionHealth = useSelector(state => state.connectionHealth)

    const [doneTasks, setDoneTasks] = useState(0)
    const [xp, setXp] = useState(0)
    const [donePoints, setDonePoints] = useState(0)
    const [gold, setGold] = useState(0)
    const [showEmptyInbox, setShowEmptyInbox] = useState(true)
    const [dataLoaded, setDataLoaded] = useState(null)
    const [statsDate, setStatsDate] = useState(statisticsModalDate)
    const [doneTasksByProject, setDoneTasksByProject] = useState({})
    const [statisticsByProject, setStatisticsByProject] = useState({})
    const [startNewDayIsLoading, setStartNewDayIsLoading] = useState(false)
    // Render mirror of `statisticsUnavailableRef`, which is a ref because the statistics
    // callbacks below need to read it synchronously, plus the stage of a manual
    // reconnect attempt (AT-2391).
    const [statisticsUnavailable, setStatisticsUnavailable] = useState(false)
    const [reconnectStatus, setReconnectStatus] = useState(RECONNECT_IDLE)

    const statisticsUnavailableRef = useRef(false)
    const reconnectTimeoutRef = useRef(undefined)
    const isLoading = useRef(false)
    const statisticsResultsRef = useRef({})
    const statisticsFailuresRef = useRef(new Set())
    const statisticsGenerationRef = useRef(0)
    const statisticsScopeRef = useRef(null)
    const statisticsScope = `${loggedUserId}:${statisticsModalDate}:${loggedUserProjects
        .map(project => project.id)
        .sort()
        .join(',')}`
    const statisticsTimersRef = useRef(new Set())
    const isSavingStartNewDay = useRef(false)
    const happinessWatcherKeyRef = useRef(`new_day_happiness_${loggedUserId}`)

    const isReconnecting = reconnectStatus === RECONNECT_PROBING || reconnectStatus === RECONNECT_RELOADING
    // Loading and failed statistics are distinct from device connectivity.
    // Keep the popup startable while its summary is being fetched.
    const statisticsPending = dataLoaded !== null && Object.values(dataLoaded).some(loaded => !loaded)
    const showStatisticsPlaceholder =
        statisticsUnavailable || statisticsPending || reconnectStatus === RECONNECT_RELOADING
    const browserOffline =
        connectionState === 'offline' || (typeof navigator !== 'undefined' && navigator.onLine === false)
    // The button is offered whenever there is something to reconnect: either
    // the popup itself could not read the statistics, or the app as a whole is
    // not talking to the server. The second case is real even with a complete
    // summary on screen — yesterday's numbers can be served from the local
    // cache while the connection is down.
    const connectionNeedsAttention =
        connectionState === 'offline' ||
        connectionHealth === CONNECTION_HEALTH_OFFLINE ||
        connectionHealth === CONNECTION_HEALTH_STALE ||
        connectionHealth === CONNECTION_HEALTH_RECONNECTING
    const showReconnectButton = statisticsUnavailable || connectionNeedsAttention || isReconnecting
    // Also disabled while the app-wide monitor is mid-probe, so the popup and
    // the top-bar chip can never disagree about whether a reconnect is running.
    const reconnectDisabled = isReconnecting || connectionHealth === CONNECTION_HEALTH_RECONNECTING

    const needToShowYesterdayStats = () => needToAcknowledgeNewDay(statisticsModalDate)

    const clearReconnectTimeout = () => {
        if (reconnectTimeoutRef.current !== undefined) {
            clearTimeout(reconnectTimeoutRef.current)
            reconnectTimeoutRef.current = undefined
        }
    }

    const checkIfDataIsLoaded = () => {
        if (!dataLoaded) return false
        const { loggedUserProjects, loggedUser } = store.getState()
        const { templateProjectIds } = loggedUser
        for (let i = 0; i < loggedUserProjects.length; i++) {
            const project = loggedUserProjects[i]
            if (!dataLoaded[project.id] && !templateProjectIds.includes(project.id)) return false
        }
        return true
    }

    const reportNewDayError = (error, label) => {
        // Never rethrow: by the time these run the popup is already closed and
        // the state is already local. Logging with the failing step is what
        // makes a real failure diagnosable instead of a silent `console.log`.
        console.warn(`[NewDay] "${label}" failed`, error)
    }

    const happinessProjects = getHappinessProjects(loggedUserProjects, loggedUser)

    /**
     * The rating rows are shared with Settings → Happiness (AT-2392): the
     * state, the per-day watchers and the one deduplicated write path all live
     * in `useProjectHappinessEditor` now. The watchers stay detached until the
     * statistics have loaded — offline there is nothing to read, and an
     * anonymous user has no ratings.
     */
    const happinessEditor = useProjectHappinessEditor({
        projects: happinessProjects,
        userId: loggedUserId,
        date: statsDate,
        watchEnabled: checkIfDataIsLoaded() && !statisticsUnavailableRef.current && !isAnonymous,
        watcherKeyPrefix: happinessWatcherKeyRef.current,
        onError: reportNewDayError,
    })

    /**
     * @param {{ keepStartNewDayGuard?: boolean }} options when the reset comes
     * from the "Start new day" flow itself the double-press guard must survive
     * it: the flow closes the popup synchronously, so clearing the guard here
     * would let a second tap landing in the same frame start a second
     * acknowledgement (and a second reload). It is cleared again by the
     * data-loading effect, i.e. the next time a day actually needs confirming.
     */
    const resetModalState = ({ keepStartNewDayGuard = false } = {}) => {
        statisticsGenerationRef.current++
        statisticsTimersRef.current.forEach(clearTimeout)
        statisticsTimersRef.current.clear()
        statisticsResultsRef.current = {}
        statisticsFailuresRef.current.clear()
        setDoneTasks(0)
        setXp(0)
        setDonePoints(0)
        setGold(0)
        setDoneTasksByProject({})
        setStatisticsByProject({})
        setShowEmptyInbox(true)
        setDataLoaded(null)
        // Read from the store rather than the render closure: the "Start new
        // day" flow dispatches the new acknowledgement first, so the closure
        // value here is one day stale by the time it resets.
        setStatsDate(store.getState().loggedUser.statisticsModalDate)
        happinessEditor.reset()
        statisticsUnavailableRef.current = false
        setStatisticsUnavailable(false)
        clearReconnectTimeout()
        setReconnectStatus(RECONNECT_IDLE)
        isLoading.current = false
        if (!keepStartNewDayGuard) isSavingStartNewDay.current = false
        setStartNewDayIsLoading(false)
    }

    /**
     * "Start new day" (AT-2367).
     *
     * The popup closes on the tap itself — see `startNewDay` in
     * `NewDayModalHelper` for why every await used to sit in front of that.
     * The full app reload is kept, but only for the device that actually
     * crossed midnight while open (the one whose date-scoped watchers are on
     * yesterday), and it can no longer be delayed by a pending write.
     */
    const onPressStartNewDay = e => {
        e?.preventDefault?.()
        e?.stopPropagation?.()
        if (isSavingStartNewDay.current) return

        isSavingStartNewDay.current = true
        setStartNewDayIsLoading(true)

        const acknowledgedStatsDate = statsDate
        const crossedMidnightWhileOpen = showNewDayNotification
        // Snapshot the unsaved drafts here, not inside the flow: the flow
        // closes the popup (which resets this editor) before it issues any
        // write, so a flush read after the close would find nothing.
        const persistHappinessDrafts = happinessEditor.takeDirtyEntries(acknowledgedStatsDate)

        return runStartNewDay({
            applyLocalAcknowledgement: statisticsModalDate => {
                const { loggedUser } = store.getState()
                const updatedLoggedUser = {
                    ...loggedUser,
                    statisticsModalDate,
                    previousStatisticsModalDate: acknowledgedStatsDate,
                }
                store.dispatch(storeLoggedUser(updatedLoggedUser))
                UserDataCache.setCachedUserData(updatedLoggedUser)
                store.dispatch(setShowNewDayNotification(false))
            },
            closePopup: () => resetModalState({ keepStartNewDayGuard: true }),
            persistHappinessDrafts,
            // Acknowledge the day even when the statistics could not be read
            // (offline). The write lands in the persisted mutation queue and
            // flushes on reconnect; skipping it is what made the popup come
            // back after every offline "Start new day".
            persistAcknowledgement: statisticsModalDate =>
                awaitWriteAck(
                    setUserStatisticsModalDate(acknowledgedStatsDate, statisticsModalDate),
                    'new day statisticsModalDate'
                ),
            reloadApp: crossedMidnightWhileOpen ? () => deleteCacheAndRefresh() : undefined,
            onError: reportNewDayError,
        })
    }

    const updateStatistics = (projectId, statistics = {}) => {
        // Replace this project's result, so a retry or late answer never doubles
        // totals. One failed project must not discard all the successful ones.
        statisticsResultsRef.current[projectId] = statistics
        statisticsFailuresRef.current.delete(projectId)
        const results = statisticsResultsRef.current
        let taskTotal = 0,
            pointTotal = 0,
            goldTotal = 0,
            xpTotal = 0
        const tasksByProject = {},
            timeByProject = {}
        Object.entries(results).forEach(([id, data]) => {
            const tasks = getSafeStatisticNumber(data.doneTasks)
            const estimationType = getEstimationTypeByProjectId(id)
            tasksByProject[id] = tasks
            timeByProject[id] = {
                doneTime: estimationType === ESTIMATION_TYPE_TIME ? getSafeStatisticNumber(data.doneTime) : 0,
            }
            taskTotal += tasks
            pointTotal += estimationType === ESTIMATION_TYPE_POINTS ? getSafeStatisticNumber(data.donePoints) : 0
            goldTotal += getSafeStatisticNumber(data.gold)
            xpTotal += getSafeStatisticNumber(data.xp)
        })
        setDoneTasksByProject(tasksByProject)
        setStatisticsByProject(timeByProject)
        setDoneTasks(taskTotal)
        setDonePoints(pointTotal)
        setGold(goldTotal)
        setXp(xpTotal)
        // Yesterday's recorded achievement does not depend on today's counters.
        setShowEmptyInbox(getIfLoggedUserReachedEmptyInbox(store.getState().loggedUser.statisticsModalDate))
        statisticsUnavailableRef.current = statisticsFailuresRef.current.size > 0
        setStatisticsUnavailable(statisticsUnavailableRef.current)
        setDataLoaded(loaded => ({ ...loaded, [projectId]: true }))
    }

    const markStatisticsUnavailable = (projectId, error) => {
        if (projectId) statisticsFailuresRef.current.add(projectId)
        statisticsUnavailableRef.current = true
        setStatisticsUnavailable(true)
        if (error) console.warn('[NewDay] Statistics could not be loaded', { code: error.code, message: error.message })
    }

    /**
     * Reads yesterday's per-project statistics.
     *
     * Extracted from the mount effect so the offline card's reconnect button
     * can run the very same load again (AT-2391) — a retry that read a
     * different way could report a different answer than the one the popup was
     * already showing, and the offline fallback (`markStatisticsUnavailable`) has to
     * stay reachable on the second attempt exactly as on the first.
     *
     * Retry only missing projects. Successful results are retained and replaced
     * by project rather than added again; obsolete attempts cannot update the UI.
     */
    const loadYesterdayStatistics = () => {
        const { loggedUserProjects, loggedUser } = store.getState()
        const endDayStatisticsDate = moment(loggedUser.statisticsModalDate)
        const statisticsDate = endDayStatisticsDate.format('DDMMYYYY')
        const generation = ++statisticsGenerationRef.current
        statisticsTimersRef.current.forEach(clearTimeout)
        statisticsTimersRef.current.clear()
        statisticsFailuresRef.current.clear()
        statisticsUnavailableRef.current = false
        setStatisticsUnavailable(false)
        const projects = loggedUserProjects.filter(project => !loggedUser.templateProjectIds.includes(project.id))
        setDataLoaded(
            Object.fromEntries(projects.map(project => [project.id, !!statisticsResultsRef.current[project.id]]))
        )
        const isCurrent = () =>
            generation === statisticsGenerationRef.current &&
            store.getState().loggedUser.uid === loggedUser.uid &&
            store.getState().loggedUser.statisticsModalDate === loggedUser.statisticsModalDate

        projects.forEach(project => {
            if (statisticsResultsRef.current[project.id]) return
            // Includes optional day-rate reconciliation, so even a pending write
            // cannot leave the summary spinning forever. A late success can recover it.
            const timer = setTimeout(() => {
                statisticsTimersRef.current.delete(timer)
                if (isCurrent())
                    markStatisticsUnavailable(project.id, {
                        code: 'deadline-exceeded',
                        message: 'Statistics loading timed out',
                    })
            }, RECONNECT_STATISTICS_TIMEOUT_MS)
            statisticsTimersRef.current.add(timer)
            const finish =
                callback =>
                (...args) => {
                    clearTimeout(timer)
                    statisticsTimersRef.current.delete(timer)
                    if (isCurrent()) callback(...args)
                }
            reconcileDayRateTimeLogBeforeStats(project, endDayStatisticsDate.valueOf()).finally(() => {
                if (!isCurrent()) return
                Backend.getUserStatistics(
                    project.id,
                    loggedUser.uid,
                    statisticsDate,
                    finish(updateStatistics),
                    finish(error => markStatisticsUnavailable(project.id, error)),
                    { preferDirect: true }
                )
            })
        })
    }

    /**
     * "Reconnect now" (AT-2391).
     *
     * The popup used to be a dead end while offline: it said it could not read
     * yesterday's numbers and offered no way to ask again, so the only route to
     * the summary was to reload the whole app (losing the session) or to start
     * the day blind.
     *
     * It runs through the app's single manual-reconnect path
     * (`reconnectNow`, PT-4660) rather than just re-issuing the read, because
     * the read is not what is broken: offline the Firestore transport has been
     * parked by the network gate, and after a suspend/captive portal it can be
     * dead while the browser still claims to be online. `reconnectNow` rebuilds
     * the transport and *proves* the server is reachable before we re-read —
     * which is what keeps this button bounded instead of hanging on a read that
     * can never answer.
     *
     * Only a popup that is MISSING the statistics re-reads them. With a summary
     * already on screen the button restores the connection and nothing else:
     * yesterday's statistics are a closed day and do not change, so re-reading
     * them would buy nothing and would flash the card through zeroes — and a
     * re-read that then failed would replace a perfectly good summary with the
     * offline card, which is a worse popup than the one the user started with.
     */
    const onPressReconnect = async e => {
        e?.preventDefault?.()
        e?.stopPropagation?.()
        if (reconnectDisabled) return

        const statisticsAreMissing = statisticsUnavailableRef.current
        clearReconnectTimeout()
        if (statisticsAreMissing && !connectionNeedsAttention) {
            setReconnectStatus(RECONNECT_RELOADING)
            loadYesterdayStatistics()
            return
        }
        setReconnectStatus(RECONNECT_PROBING)

        const reconnectAttempt = Promise.resolve()
            .then(() => reconnectNow())
            .catch(error => {
                reportNewDayError(error, 'reconnectNow')
                return undefined
            })
        const reconnectDeadline = new Promise(resolve => {
            reconnectTimeoutRef.current = setTimeout(() => {
                reconnectTimeoutRef.current = undefined
                resolve(undefined)
            }, RECONNECT_ATTEMPT_TIMEOUT_MS)
        })
        const outcome = await Promise.race([reconnectAttempt, reconnectDeadline])
        clearReconnectTimeout()

        if (outcome !== CONNECTION_HEALTH_LIVE) {
            // Still unreachable. Say so and leave the day startable — the
            // acknowledgement works offline (AT-2340), so a failed reconnect
            // must never look like a blocked popup.
            setReconnectStatus(RECONNECT_FAILED)
            return
        }

        if (!statisticsAreMissing) {
            setReconnectStatus(RECONNECT_IDLE)
            return
        }

        // Proven alive: drop the offline latch so the statistics callbacks are
        // accepted again, and read once more. The card keeps rendering while
        // the reconnect is in flight, so the popup cannot flicker out between
        // the reset and the fresh data.
        statisticsUnavailableRef.current = false
        setStatisticsUnavailable(false)
        setReconnectStatus(RECONNECT_RELOADING)
        loadYesterdayStatistics()
        reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = undefined
            markStatisticsUnavailable()
            setReconnectStatus(RECONNECT_FAILED)
        }, RECONNECT_STATISTICS_TIMEOUT_MS)
    }

    const reconcileDayRateTimeLogBeforeStats = async (project, startTimestamp) => {
        const dayRateTimeLog = normalizeDayRateTimeLogConfig(project.dayRateTimeLog)
        if (!dayRateTimeLog.enabled) return

        try {
            const yesterday = moment().subtract(1, 'day').endOf('day').valueOf()
            await reconcileProjectDayRateTimeLogsBackfill(project, loggedUserId, startTimestamp, yesterday, {
                source: 'new-day-modal',
            })
        } catch (error) {
            console.log(error)
        }
    }

    useEffect(() => {
        if (
            !isAnonymous &&
            loggedUserId &&
            (projectIdsAmount === 0 || loggedUserProjectsAmount === projectIdsAmount) &&
            (!isLoading.current || statisticsScopeRef.current !== statisticsScope) &&
            // Account-scoped trigger: statisticsModalDate lives on the user doc and
            // syncs across devices, so it is the single source of truth for whether
            // the new day still needs confirmation. showNewDayNotification (the
            // per-device midnight timer) stays in the dependency list below purely
            // as a wake signal that re-evaluates this account state at midnight.
            needToShowYesterdayStats()
        ) {
            if (statisticsScopeRef.current !== statisticsScope) {
                resetModalState()
                statisticsScopeRef.current = statisticsScope
            }
            isLoading.current = true
            // A day is being confirmed again, so the previous confirmation's
            // double-press guard (kept across its own close) is released here.
            isSavingStartNewDay.current = false
            loadYesterdayStatistics()
        }
    }, [
        showNewDayNotification,
        loggedUserProjectsAmount,
        statisticsModalDate,
        projectIdsAmount,
        templateProjectIdsAmount,
        statisticsScope,
        loggedUserId,
        isAnonymous,
    ])

    // Cross-device reconciliation. The "start new day" confirmation is stored
    // per user account as statisticsModalDate on the user doc, which syncs to
    // every device in real time via watchLoggedUser. Once it advances to today
    // — because the user started the new day here or on another device — there
    // is nothing left to confirm on this device: clear the per-device
    // midnight-timer flag (showNewDayNotification) and dismiss any prompt still
    // open here, so the same user is never asked to confirm the same day twice.
    // This only ever tears down local state and never writes to Firestore, so
    // anonymous users, offline use and other users on the same device are safe.
    useEffect(() => {
        if (isAnonymous || isSavingStartNewDay.current) return
        if (needToShowYesterdayStats()) return

        if (showNewDayNotification) store.dispatch(setShowNewDayNotification(false))
        if (dataLoaded || isLoading.current) resetModalState()
    }, [statisticsModalDate, showNewDayNotification, isAnonymous, dataLoaded])

    // Closes out a reconnect attempt (AT-2391). `getUserStatistics` is
    // callback-based, so the only honest "the retry finished" signal is the
    // same one the first load uses: every project has reported, or one of them
    // fell back to offline.
    useEffect(() => {
        // Only the RELOADING stage: while the probe is still running the card is
        // legitimately still offline, and reading that latch as a verdict would
        // fail the attempt before it had a chance.
        if (reconnectStatus !== RECONNECT_RELOADING) return
        if (statisticsUnavailable) {
            clearReconnectTimeout()
            setReconnectStatus(RECONNECT_FAILED)
            return
        }
        if (checkIfDataIsLoaded()) {
            clearReconnectTimeout()
            setReconnectStatus(RECONNECT_IDLE)
        }
    }, [reconnectStatus, statisticsUnavailable, dataLoaded])

    // A real connectivity recovery retries missing projects without throwing
    // away the successful results or restarting the entire Firestore transport.
    useEffect(() => {
        if (
            statisticsUnavailableRef.current &&
            !isReconnecting &&
            !browserOffline &&
            connectionHealth === CONNECTION_HEALTH_LIVE
        ) {
            loadYesterdayStatistics()
        }
    }, [connectionState, connectionHealth])

    useEffect(
        () => () => {
            clearReconnectTimeout()
            statisticsGenerationRef.current++
            statisticsTimersRef.current.forEach(clearTimeout)
            statisticsTimersRef.current.clear()
        },
        []
    )

    const getAnimationSegment = () => {
        if (showEmptyInbox) return [0, 180]
        if (doneTasks > 3) return [0, 120]
        if (doneTasks > 1) return [0, 60]
        return [0, 1]
    }

    const getRewardTexts = () => {
        if (showStatisticsPlaceholder) {
            return {
                rewardTitle: translate('Welcome back!'),
                rewardDescription: translate(
                    statisticsUnavailable
                        ? browserOffline
                            ? 'You are offline. Your summary will load when you reconnect.'
                            : 'Your summary could not be loaded. Please try again.'
                        : 'Loading your daily summary...'
                ),
            }
        }
        if (showEmptyInbox)
            return {
                rewardTitle: translate('Great, well done!!'),
                rewardDescription: translate('You have reached empty inbox'),
            }
        if (doneTasks > 3)
            return {
                rewardTitle: translate('Well done!'),
                rewardDescription: translate('You are almost there, the goal is clean up your inbox'),
            }
        if (doneTasks > 1)
            return {
                rewardTitle: translate('Nicely done!'),
                rewardDescription: translate('Some good progress but try reaching empty inbox!'),
            }
        return {
            rewardTitle: translate('Welcome back!'),
            rewardDescription: translate('Looks like you had no time to clean your inbox'),
        }
    }

    const getDate = () => {
        const weekdays = [
            translate('Monday'),
            translate('Tuesday'),
            translate('Wednesday'),
            translate('Thursday'),
            translate('Friday'),
            translate('Saturday'),
            translate('Sunday'),
        ]
        const endDayStatisticsDate = moment(statsDate)
        const dayName = weekdays[endDayStatisticsDate.isoWeekday() - 1]
        const dateFormated = endDayStatisticsDate.format(getDateFormat())
        return { dayName, dateFormated }
    }

    const { dayName, dateFormated } = getDate()
    const { rewardTitle, rewardDescription } = getRewardTexts()
    const moneyEarnedSummary = getEndDayMoneyEarnedSummary(
        loggedUserProjects,
        statisticsByProject,
        loggedUserId,
        loggedUser.defaultCurrency || 'EUR'
    )
    const compactModalLayout = smallScreenNavigation || isMiddleScreen
    const getProjectDoneTasks = projectId => getSafeStatisticNumber(doneTasksByProject[projectId])
    const maxProjectDoneTasks = happinessProjects.reduce(
        (maxDoneTasks, project) => Math.max(maxDoneTasks, getProjectDoneTasks(project.id)),
        0
    )
    /**
     * How busy the day being acknowledged was in this project, under its
     * name. The shared rating list does not know about statistics; the host
     * injects the day's count (`ProjectDayActivity` is the same row the
     * Settings → Happiness rating popup renders for the day it rates).
     */
    const renderProjectDayActivity = project => (
        <ProjectDayActivity doneTasks={getProjectDoneTasks(project.id)} maxDoneTasks={maxProjectDoneTasks} />
    )
    const renderStatItem = (key, icon, label, value) => (
        <View style={[localStyles.statItem, compactModalLayout && localStyles.mobileStatItem]} key={key}>
            <View style={localStyles.statIcon}>{icon}</View>
            <View style={localStyles.statTextBlock}>
                <Text style={localStyles.statLabel}>{label}</Text>
                <Text style={localStyles.statValue}>{value}</Text>
            </View>
        </View>
    )
    const statItems = [
        renderStatItem(
            'tasks',
            <Icon name="check-square" size={24} color="#ffffff" />,
            translate('Tasks done:'),
            doneTasks
        ),
        renderStatItem(
            'points',
            <Icon name="story-point" size={24} color="#ffffff" />,
            translate('Points earned:'),
            donePoints
        ),
        moneyEarnedSummary &&
            renderStatItem(
                'money',
                <Icon name="credit-card" size={24} color="#ffffff" />,
                `${translate('Money earned')}:`,
                moneyEarnedSummary.formattedValue
            ),
        renderStatItem('xp', <Icon name="trending-up" size={24} color="#ffffff" />, translate('XP earned:'), xp),
        renderStatItem(
            'gold',
            <Lottie animationData={goldAnimation} autoplay={false} style={{ width: 24, height: 24 }} />,
            translate('Gold earned:'),
            Math.floor(gold)
        ),
    ].filter(Boolean)

    return (
        !showNewVersionMandtoryNotifcation &&
        needToShowYesterdayStats() &&
        (dataLoaded !== null || isReconnecting) && (
            <View style={[localStyles.parent, safeAreaOverlayPadding]}>
                <View
                    style={[
                        localStyles.container,
                        compactModalLayout && localStyles.mobileContainer,
                        applyPopoverWidth(),
                    ]}
                >
                    <ScrollView showsVerticalScrollIndicator={false}>
                        <View style={localStyles.header}>
                            <Text style={[localStyles.title, compactModalLayout && localStyles.mobileTitle]}>
                                {translate('A new day has begun')}
                            </Text>
                            <Text
                                style={[localStyles.description, compactModalLayout && localStyles.mobileDescription]}
                            >
                                {translate('Here a quick summary of how you have been doing')}
                            </Text>
                            <View style={localStyles.animationContainer}>
                                {statisticsPending && !statisticsUnavailable ? (
                                    <ActivityIndicator
                                        size="large"
                                        color="#ffffff"
                                        style={{ width: 132, height: 86 }}
                                    />
                                ) : (
                                    <Lottie
                                        animationData={showStatisticsPlaceholder ? cloudAnimation : starsAnimation}
                                        autoplay={true}
                                        initialSegment={showStatisticsPlaceholder ? [0, 144] : getAnimationSegment()}
                                        style={{ width: 132, height: 86 }}
                                    />
                                )}
                            </View>
                            <Text style={localStyles.emptyInboxTitle}>{rewardTitle}</Text>
                            <Text style={localStyles.emptyInboxDescription}>{rewardDescription}</Text>
                            <Text style={localStyles.date}>{`${dayName} ${dateFormated}`}</Text>
                        </View>

                        {!showStatisticsPlaceholder && (
                            <View style={[localStyles.statsGrid, compactModalLayout && localStyles.mobileStatsGrid]}>
                                {statItems}
                            </View>
                        )}
                        {!showStatisticsPlaceholder && (
                            <ProjectHappinessRatingList
                                projects={happinessProjects}
                                editor={happinessEditor}
                                compact={compactModalLayout}
                                renderProjectMeta={renderProjectDayActivity}
                            />
                        )}
                        {reconnectStatus === RECONNECT_FAILED && (
                            <Text style={localStyles.reconnectFailedNotice}>
                                {translate(
                                    browserOffline
                                        ? 'Still no connection. You can start the day anyway, your data will sync later'
                                        : 'Your summary could not be loaded. You can start the day and try again later.'
                                )}
                            </Text>
                        )}
                        <View style={localStyles.line} />
                        <View style={[localStyles.actions, compactModalLayout && localStyles.mobileActions]}>
                            {/* Offline, the popup used to be a dead end: it said it could
                                not read yesterday's numbers and offered no way to ask
                                again (AT-2391). */}
                            {showReconnectButton && (
                                <TouchableOpacity
                                    style={[
                                        localStyles.reconnect,
                                        compactModalLayout && localStyles.mobileReconnect,
                                        reconnectDisabled && localStyles.refreshDisabled,
                                    ]}
                                    testID="newDayReconnectButton"
                                    onPress={onPressReconnect}
                                    disabled={reconnectDisabled}
                                >
                                    <View style={localStyles.refreshContent}>
                                        {reconnectDisabled ? (
                                            <ActivityIndicator
                                                size="small"
                                                color="#FFFFFF"
                                                style={localStyles.refreshSpinner}
                                            />
                                        ) : (
                                            <View style={localStyles.refreshSpinner}>
                                                <Icon name="refresh-cw" size={16} color="#ffffff" />
                                            </View>
                                        )}
                                        <Text style={localStyles.buttonText}>
                                            {translate(
                                                reconnectDisabled
                                                    ? 'Reconnecting'
                                                    : connectionNeedsAttention
                                                      ? 'Reconnect now'
                                                      : 'Try again'
                                            )}
                                        </Text>
                                    </View>
                                </TouchableOpacity>
                            )}
                            <TouchableOpacity
                                style={[
                                    localStyles.refresh,
                                    compactModalLayout && localStyles.mobileRefresh,
                                    startNewDayIsLoading && localStyles.refreshDisabled,
                                ]}
                                testID="startNewDayButton"
                                onPress={onPressStartNewDay}
                                disabled={startNewDayIsLoading}
                            >
                                <View style={localStyles.refreshContent}>
                                    {startNewDayIsLoading && (
                                        <ActivityIndicator
                                            size="small"
                                            color="#FFFFFF"
                                            style={localStyles.refreshSpinner}
                                        />
                                    )}
                                    <Text style={localStyles.buttonText}>{translate('Start new day')}</Text>
                                </View>
                            </TouchableOpacity>
                        </View>
                    </ScrollView>
                </View>
            </View>
        )
    )
}

const localStyles = StyleSheet.create({
    parent: {
        position: 'absolute',
        zIndex: 10000,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: hexColorToRGBa(colors.Text03, 0.24),
        // Centered in the WINDOW on both axes (no sidebar offset — same call
        // as popoverToCenter, 2026-08-12). The card caps itself below, so
        // centering can never clip it.
        justifyContent: 'center',
        alignItems: 'center',
        ...Platform.select({ web: { position: 'fixed' } }),
    },
    container: {
        backgroundColor: colors.Secondary400,
        padding: 24,
        borderRadius: 8,
        // Content taller than the cap scrolls inside the card (deliberate:
        // window-level scrolling was tried on 2026-08-12 and rolled back).
        maxHeight: '90%',
        ...Platform.select({
            web: {
                boxShadow: `${0}px ${16}px ${32}px rgba(0,0,0,0.04), ${0}px ${16}px ${24}px rgba(0, 0, 0, 0.04)`,
            },
        }),
    },
    mobileContainer: {
        padding: 20,
        maxHeight: '94%',
    },
    header: {
        alignItems: 'center',
        marginBottom: 24,
    },
    animationContainer: {
        alignSelf: 'center',
        marginTop: 12,
        marginBottom: 6,
    },
    title: {
        ...styles.title7,
        color: '#FFFFFF',
        fontWeight: '500',
        textAlign: 'center',
    },
    mobileTitle: {
        textAlign: 'center',
    },
    description: {
        ...styles.body2,
        color: colors.Text03,
        marginTop: 4,
        textAlign: 'center',
    },
    mobileDescription: {
        textAlign: 'center',
        marginTop: 4,
    },
    emptyInboxTitle: {
        ...styles.title4,
        color: '#ffffff',
        marginBottom: 8,
        textAlign: 'center',
    },
    emptyInboxDescription: {
        ...styles.subtitle1,
        color: colors.Text04,
        textAlign: 'center',
    },
    line: {
        height: 1,
        backgroundColor: '#ffffff',
        opacity: 0.2,
        marginVertical: 20,
    },
    refresh: {
        borderRadius: 4,
        backgroundColor: colors.Primary300,
        paddingHorizontal: 16,
        paddingVertical: 16,
        alignSelf: 'center',
    },
    refreshDisabled: {
        opacity: 0.72,
    },
    refreshContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    refreshSpinner: {
        marginRight: 8,
    },
    mobileRefresh: {
        alignSelf: 'stretch',
        alignItems: 'center',
        marginHorizontal: 4,
    },
    // Side by side on desktop, stacked on phones — the same compact-layout
    // switch the stats grid and the happiness rows already use, so the offline
    // card never puts two buttons on a line too narrow for them.
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    mobileActions: {
        flexDirection: 'column',
        alignItems: 'stretch',
    },
    // Secondary treatment: reconnecting is the optional escape hatch, starting
    // the day stays the primary action (offline it works regardless — the
    // acknowledgement is queued locally).
    reconnect: {
        borderRadius: 4,
        paddingHorizontal: 16,
        paddingVertical: 16,
        alignSelf: 'center',
        marginRight: 8,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.2)',
        backgroundColor: 'rgba(255,255,255,0.08)',
    },
    mobileReconnect: {
        alignSelf: 'stretch',
        alignItems: 'center',
        marginRight: 0,
        marginBottom: 8,
        marginHorizontal: 4,
    },
    reconnectFailedNotice: {
        ...styles.body2,
        color: colors.Text04,
        textAlign: 'center',
        marginTop: 12,
    },
    buttonText: {
        fontFamily: 'Roboto-Regular',
        fontWeight: '500',
        color: '#FFFFFF',
        fontSize: 14,
        lineHeight: 14,
        letterSpacing: em2px(0.05),
    },
    statsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginBottom: 6,
    },
    mobileStatsGrid: {
        flexDirection: 'column',
        flexWrap: 'nowrap',
        marginTop: 4,
    },
    statItem: {
        width: '50%',
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingRight: 16,
        marginBottom: 18,
    },
    mobileStatItem: {
        width: '100%',
        paddingRight: 0,
    },
    statIcon: {
        width: 32,
        alignItems: 'center',
        paddingTop: 1,
    },
    statTextBlock: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'column',
        alignItems: 'flex-start',
    },
    statLabel: {
        ...styles.caption2,
        color: colors.Text04,
        marginLeft: 8,
    },
    statValue: {
        ...styles.subtitle1,
        color: '#ffffff',
        marginLeft: 8,
        marginTop: 1,
        flexWrap: 'wrap',
    },
    date: {
        ...styles.body2,
        color: colors.Text04,
        marginTop: 2,
        textAlign: 'center',
    },
})
