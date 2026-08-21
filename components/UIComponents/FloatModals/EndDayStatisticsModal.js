import React, { useEffect, useState, useRef } from 'react'
import {
    ActivityIndicator,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native'
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
import HappinessRatingPicker from '../../ProjectHappiness/HappinessRatingPicker'
import { HAPPINESS_PRIVACY_TEXT } from '../../../utils/ProjectHappinessHelper'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { getSafeStatisticNumber, getSafeTextValue } from '../../../utils/StatisticDataHelper'
import { getEndDayMoneyEarnedSummary } from './EndDayStatisticsHelper'
import useSafeAreaOverlayPadding from '../../../hooks/useSafeAreaOverlayPadding'
import { CONNECTION_HEALTH_LIVE, reconnectNow } from '../../../utils/connectionHealth'

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

const getActiveProjectsInSidebarOrder = (projects, user) =>
    ProjectHelper.sortProjects(
        ProjectHelper.getActiveProjectsInList(
            projects,
            user.projectIds,
            user.archivedProjectIds,
            user.templateProjectIds,
            user.guideProjectIds
        ),
        user.uid
    )

export default function EndDayStatisticsModal() {
    const safeAreaOverlayPadding = useSafeAreaOverlayPadding()
    const sidebarNumbersAreLoading = useSelector(state => state.sidebarNumbers.loading)
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

    const [doneTasks, setDoneTasks] = useState(0)
    const [xp, setXp] = useState(0)
    const [donePoints, setDonePoints] = useState(0)
    const [gold, setGold] = useState(0)
    const [showEmptyInbox, setShowEmptyInbox] = useState(true)
    const [dataLoaded, setDataLoaded] = useState(null)
    const [statsDate, setStatsDate] = useState(statisticsModalDate)
    const [doneTasksByProject, setDoneTasksByProject] = useState({})
    const [statisticsByProject, setStatisticsByProject] = useState({})
    const [happinessRatings, setHappinessRatings] = useState({})
    const [happinessComments, setHappinessComments] = useState({})
    const [visibleComments, setVisibleComments] = useState({})
    const [startNewDayIsLoading, setStartNewDayIsLoading] = useState(false)
    // Render mirror of `isOfflineRef`, which is a ref because the statistics
    // callbacks below need to read it synchronously, plus the stage of a manual
    // reconnect attempt (AT-2391).
    const [isOffline, setIsOffline] = useState(false)
    const [reconnectStatus, setReconnectStatus] = useState(RECONNECT_IDLE)

    const isOfflineRef = useRef(false)
    const reconnectTimeoutRef = useRef(undefined)
    const isLoading = useRef(false)
    const isSavingStartNewDay = useRef(false)
    const happinessWatcherKeyRef = useRef(`new_day_happiness_${loggedUserId}`)
    const commentInputRefs = useRef({})
    const pendingCommentFocusProjectIdRef = useRef(null)
    const dirtyHappinessProjectIdsRef = useRef(new Set())
    const happinessDraftsRef = useRef({})
    // Signature (`rating|comment`) of the last value written for a project, so
    // the same happiness entry is never written twice. Rating taps persist
    // immediately AND used to be re-persisted by "Start new day", and every
    // `setProjectHappiness` writes a fresh feed entry plus a feed-count bump —
    // so one rating produced two identical feed entries (AT-2367).
    const persistedHappinessRef = useRef({})

    // A reconnect in flight keeps rendering the offline card: the statistics are
    // not back yet, and flipping to the summary layout with everything at zero
    // (or unmounting the popup entirely, which is what `checkIfDataIsLoaded`
    // would do mid-reload) would read as data rather than as progress.
    const isReconnecting = reconnectStatus === RECONNECT_PROBING || reconnectStatus === RECONNECT_RELOADING
    const showOfflineView = isOffline || isReconnecting

    const needToShowYesterdayStats = () => needToAcknowledgeNewDay(statisticsModalDate)

    const clearReconnectTimeout = () => {
        if (reconnectTimeoutRef.current !== undefined) {
            clearTimeout(reconnectTimeoutRef.current)
            reconnectTimeoutRef.current = undefined
        }
    }

    /**
     * @param {{ keepStartNewDayGuard?: boolean }} options when the reset comes
     * from the "Start new day" flow itself the double-press guard must survive
     * it: the flow closes the popup synchronously, so clearing the guard here
     * would let a second tap landing in the same frame start a second
     * acknowledgement (and a second reload). It is cleared again by the
     * data-loading effect, i.e. the next time a day actually needs confirming.
     */
    const resetModalState = ({ keepStartNewDayGuard = false } = {}) => {
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
        setHappinessRatings({})
        setHappinessComments({})
        setVisibleComments({})
        pendingCommentFocusProjectIdRef.current = null
        dirtyHappinessProjectIdsRef.current.clear()
        happinessDraftsRef.current = {}
        persistedHappinessRef.current = {}
        isOfflineRef.current = false
        setIsOffline(false)
        clearReconnectTimeout()
        setReconnectStatus(RECONNECT_IDLE)
        isLoading.current = false
        if (!keepStartNewDayGuard) isSavingStartNewDay.current = false
        setStartNewDayIsLoading(false)
    }

    const reportNewDayError = (error, label) => {
        // Never rethrow: by the time these run the popup is already closed and
        // the state is already local. Logging with the failing step is what
        // makes a real failure diagnosable instead of a silent `console.log`.
        console.warn(`[NewDay] "${label}" failed`, error)
    }

    /**
     * Single write path for a project's happiness entry.
     *
     * Deduplicated on the last written value, because the same entry is
     * reachable from three places (rating tap, comment blur, "Start new day"
     * flush) and each `setProjectHappiness` writes a new feed entry.
     */
    const persistHappiness = (project, rating, comment) => {
        dirtyHappinessProjectIdsRef.current.delete(project.id)
        if (!rating) return Promise.resolve()

        const cleanComment = comment || ''
        const signature = `${rating}|${cleanComment}`
        if (persistedHappinessRef.current[project.id] === signature) return Promise.resolve()
        persistedHappinessRef.current[project.id] = signature

        return awaitWriteAck(
            Backend.setProjectHappiness(project.id, loggedUserId, statsDate, rating, cleanComment, project),
            'project happiness'
        ).catch(error => {
            // Let a retry through: the value was not stored after all.
            if (persistedHappinessRef.current[project.id] === signature)
                delete persistedHappinessRef.current[project.id]
            reportNewDayError(error, 'setProjectHappiness')
        })
    }

    const saveDirtyHappinessEntries = () => {
        const dirtyProjectIds = dirtyHappinessProjectIdsRef.current
        if (dirtyProjectIds.size === 0) return Promise.resolve()

        const promises = getHappinessProjects().reduce((promises, project) => {
            if (!dirtyProjectIds.has(project.id)) return promises

            const draft = happinessDraftsRef.current[project.id] || {}
            const rating = draft.rating || happinessRatings[project.id]
            const comment = draft.comment != null ? draft.comment : happinessComments[project.id] || ''
            promises.push(persistHappiness(project, rating, comment))
            return promises
        }, [])

        dirtyProjectIds.clear()
        return Promise.all(promises)
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
            persistHappinessDrafts: saveDirtyHappinessEntries,
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
        if (!isOfflineRef.current) {
            const estimationType = getEstimationTypeByProjectId(projectId)
            const recheadEmptyInbox = getIfLoggedUserReachedEmptyInbox(statsDate)
            if (!recheadEmptyInbox) {
                const { sidebarNumbers } = store.getState()
                if (sidebarNumbers[projectId] && sidebarNumbers[projectId][loggedUserId]) setShowEmptyInbox(false)
            }

            const doneTasks = getSafeStatisticNumber(statistics.doneTasks)
            const donePoints = getSafeStatisticNumber(statistics.donePoints)
            const doneTime = getSafeStatisticNumber(statistics.doneTime)
            const gold = getSafeStatisticNumber(statistics.gold)
            const xp = getSafeStatisticNumber(statistics.xp)

            setDoneTasksByProject(state => ({ ...state, [projectId]: doneTasks }))
            setStatisticsByProject(state => ({
                ...state,
                [projectId]: {
                    doneTime: estimationType === ESTIMATION_TYPE_TIME ? doneTime : 0,
                },
            }))
            setDoneTasks(state => state + doneTasks)
            setDonePoints(state => state + (estimationType === ESTIMATION_TYPE_POINTS ? donePoints : 0))
            setGold(state => state + gold)
            setXp(state => state + xp)
            setDataLoaded(dataLoaded => {
                return { ...dataLoaded, [projectId]: true }
            })
        }
    }

    const activeOfflineMode = () => {
        isOfflineRef.current = true
        setIsOffline(true)
        setDataLoaded({})
    }

    /**
     * Reads yesterday's per-project statistics.
     *
     * Extracted from the mount effect so the offline card's reconnect button
     * can run the very same load again (AT-2391) — a retry that read a
     * different way could report a different answer than the one the popup was
     * already showing, and the offline fallback (`activeOfflineMode`) has to
     * stay reachable on the second attempt exactly as on the first.
     *
     * The accumulators are reset here rather than by the caller: a retry that
     * kept them would double-count every project that had already answered
     * before another one failed the first attempt.
     */
    const loadYesterdayStatistics = () => {
        // Read from the store, not the render closure: a retry runs from an
        // event handler whose closure can be a render behind.
        const { loggedUserProjects, loggedUser } = store.getState()
        const { templateProjectIds } = loggedUser
        const endDayStatisticsDate = moment(loggedUser.statisticsModalDate)
        const statisticsDate = endDayStatisticsDate.format('DDMMYYYY')
        const dataLoaded = {}

        setDoneTasks(0)
        setXp(0)
        setDonePoints(0)
        setGold(0)
        setDoneTasksByProject({})
        setStatisticsByProject({})

        for (let i = 0; i < loggedUserProjects.length; i++) {
            const project = loggedUserProjects[i]
            if (!templateProjectIds.includes(project.id)) {
                dataLoaded[project.id] = false
                reconcileDayRateTimeLogBeforeStats(project, endDayStatisticsDate.valueOf()).finally(() => {
                    Backend.getUserStatistics(
                        project.id,
                        loggedUserId,
                        statisticsDate,
                        updateStatistics,
                        activeOfflineMode
                    )
                })
            }
        }

        setDataLoaded(dataLoaded)
    }

    /**
     * "Reconnect now" on the offline card (AT-2391).
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
     */
    const onPressReconnect = async e => {
        e?.preventDefault?.()
        e?.stopPropagation?.()
        if (isReconnecting) return

        clearReconnectTimeout()
        setReconnectStatus(RECONNECT_PROBING)

        let outcome
        try {
            outcome = await reconnectNow()
        } catch (error) {
            reportNewDayError(error, 'reconnectNow')
        }

        if (outcome !== CONNECTION_HEALTH_LIVE) {
            // Still unreachable. Say so and leave the day startable — the
            // acknowledgement works offline (AT-2340), so a failed reconnect
            // must never look like a blocked popup.
            activeOfflineMode()
            setReconnectStatus(RECONNECT_FAILED)
            return
        }

        // Proven alive: drop the offline latch so the statistics callbacks are
        // accepted again, and read once more. The card keeps rendering while
        // the reconnect is in flight, so the popup cannot flicker out between
        // the reset and the fresh data.
        isOfflineRef.current = false
        setIsOffline(false)
        setReconnectStatus(RECONNECT_RELOADING)
        loadYesterdayStatistics()
        reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = undefined
            activeOfflineMode()
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
            (projectIdsAmount === 0 || (!sidebarNumbersAreLoading && loggedUserProjectsAmount === projectIdsAmount)) &&
            !isLoading.current &&
            // Account-scoped trigger: statisticsModalDate lives on the user doc and
            // syncs across devices, so it is the single source of truth for whether
            // the new day still needs confirmation. showNewDayNotification (the
            // per-device midnight timer) stays in the dependency list below purely
            // as a wake signal that re-evaluates this account state at midnight.
            needToShowYesterdayStats()
        ) {
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
        sidebarNumbersAreLoading,
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
        if (isOffline) {
            clearReconnectTimeout()
            setReconnectStatus(RECONNECT_FAILED)
            return
        }
        if (checkIfDataIsLoaded()) {
            clearReconnectTimeout()
            setReconnectStatus(RECONNECT_IDLE)
        }
    }, [reconnectStatus, isOffline, dataLoaded])

    useEffect(() => clearReconnectTimeout, [])

    useEffect(() => {
        if (!checkIfDataIsLoaded() || isOfflineRef.current || isAnonymous) return

        const { loggedUserProjects, loggedUser } = store.getState()
        const activeProjects = getActiveProjectsInSidebarOrder(loggedUserProjects, loggedUser)
        const watcherKeys = activeProjects.map(project => `${happinessWatcherKeyRef.current}_${project.id}`)
        activeProjects.forEach(project => {
            Backend.watchProjectHappinessByRange(
                project.id,
                loggedUserId,
                statsDate,
                statsDate,
                `${happinessWatcherKeyRef.current}_${project.id}`,
                (projectId, entries) => {
                    const entry = entries[0]
                    if (entry) {
                        happinessDraftsRef.current[projectId] = {
                            rating: entry.rating,
                            comment: entry.comment || '',
                        }
                        // Already stored server-side: never re-write it.
                        persistedHappinessRef.current[projectId] = `${entry.rating}|${entry.comment || ''}`
                        setHappinessRatings(state => ({ ...state, [projectId]: entry.rating }))
                        setHappinessComments(state => ({ ...state, [projectId]: entry.comment || '' }))
                    }
                }
            )
        })

        return () => {
            watcherKeys.forEach(key => Backend.unwatch(key))
        }
    }, [JSON.stringify(dataLoaded), statsDate, loggedUserId, isAnonymous])

    useEffect(() => {
        const projectId = pendingCommentFocusProjectIdRef.current
        if (!projectId || !visibleComments[projectId]) return

        const timeoutId = setTimeout(() => {
            commentInputRefs.current[projectId]?.focus?.()
            pendingCommentFocusProjectIdRef.current = null
        })

        return () => clearTimeout(timeoutId)
    }, [visibleComments])

    const getHappinessProjects = () => getActiveProjectsInSidebarOrder(loggedUserProjects, loggedUser)

    const updateHappinessRating = (project, rating) => {
        dirtyHappinessProjectIdsRef.current.add(project.id)
        happinessDraftsRef.current[project.id] = {
            ...happinessDraftsRef.current[project.id],
            rating,
            comment: happinessComments[project.id] || happinessDraftsRef.current[project.id]?.comment || '',
        }
        setHappinessRatings(state => ({ ...state, [project.id]: rating }))
        persistHappiness(project, rating, happinessComments[project.id] || '')
    }

    const updateHappinessComment = (project, comment) => {
        dirtyHappinessProjectIdsRef.current.add(project.id)
        happinessDraftsRef.current[project.id] = {
            ...happinessDraftsRef.current[project.id],
            rating: happinessRatings[project.id] || happinessDraftsRef.current[project.id]?.rating,
            comment,
        }
        setHappinessComments(state => ({ ...state, [project.id]: comment }))
    }

    const saveHappinessComment = project => {
        persistHappiness(project, happinessRatings[project.id], happinessComments[project.id] || '')
    }

    const toggleHappinessComment = projectId => {
        setVisibleComments(state => {
            const willShow = !state[projectId]
            pendingCommentFocusProjectIdRef.current = willShow ? projectId : null
            return { ...state, [projectId]: willShow }
        })
    }

    const getAnimationSegment = () => {
        if (showEmptyInbox) return [0, 180]
        if (doneTasks > 3) return [0, 120]
        if (doneTasks > 1) return [0, 60]
        return [0, 1]
    }

    const getRewardTexts = () => {
        if (showOfflineView) {
            return {
                rewardTitle: translate('You surely did well:'),
                rewardDescription: translate('but since we are offline right now we don’t know'),
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

    const checkIfDataIsLoaded = () => {
        if (!dataLoaded) return false
        if (isOfflineRef.current) return true
        const { loggedUserProjects, loggedUser } = store.getState()
        const { templateProjectIds } = loggedUser
        for (let i = 0; i < loggedUserProjects.length; i++) {
            const project = loggedUserProjects[i]
            if (!dataLoaded[project.id] && !templateProjectIds.includes(project.id)) return false
        }
        return true
    }

    const { dayName, dateFormated } = getDate()
    const { rewardTitle, rewardDescription } = getRewardTexts()
    const happinessProjects = getHappinessProjects()
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
    const getProjectActivityWidth = projectId => {
        const projectDoneTasks = getProjectDoneTasks(projectId)
        if (projectDoneTasks <= 0 || maxProjectDoneTasks <= 0) return 0
        return `${Math.max(8, Math.round((projectDoneTasks / maxProjectDoneTasks) * 100))}%`
    }
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
        (checkIfDataIsLoaded() || isReconnecting) && (
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
                                <Lottie
                                    animationData={showOfflineView ? cloudAnimation : starsAnimation}
                                    autoplay={true}
                                    initialSegment={showOfflineView ? [0, 144] : getAnimationSegment()}
                                    style={{ width: 132, height: 86 }}
                                />
                            </View>
                            <Text style={localStyles.emptyInboxTitle}>{rewardTitle}</Text>
                            <Text style={localStyles.emptyInboxDescription}>{rewardDescription}</Text>
                            <Text style={localStyles.date}>{`${dayName} ${dateFormated}`}</Text>
                        </View>

                        {!showOfflineView && (
                            <View style={[localStyles.statsGrid, compactModalLayout && localStyles.mobileStatsGrid]}>
                                {statItems}
                            </View>
                        )}
                        {!showOfflineView && happinessProjects.length > 0 && (
                            <View style={localStyles.happinessSection}>
                                <Text style={localStyles.happinessTitle}>{translate('Project happiness')}</Text>
                                <Text style={localStyles.happinessPrivacy}>{translate(HAPPINESS_PRIVACY_TEXT)}</Text>
                                {happinessProjects.map(project => (
                                    <View
                                        key={project.id}
                                        style={[
                                            localStyles.happinessProject,
                                            compactModalLayout && localStyles.mobileHappinessProject,
                                        ]}
                                    >
                                        <View
                                            style={[
                                                localStyles.happinessProjectHeader,
                                                compactModalLayout && localStyles.mobileHappinessProjectHeader,
                                            ]}
                                        >
                                            <View
                                                style={[
                                                    localStyles.happinessProjectInfo,
                                                    compactModalLayout && localStyles.mobileHappinessProjectInfo,
                                                ]}
                                            >
                                                <Text style={localStyles.happinessProjectName} numberOfLines={1}>
                                                    {getSafeTextValue(project.name, translate('Project'))}
                                                </Text>
                                                <View style={localStyles.happinessProjectStats}>
                                                    <Icon name="check-square" size={16} color={colors.Text04} />
                                                    <Text style={localStyles.happinessProjectStatsText}>
                                                        {translate('Tasks done:')} {getProjectDoneTasks(project.id)}
                                                    </Text>
                                                </View>
                                                <View style={localStyles.projectActivityTrack}>
                                                    <View
                                                        style={[
                                                            localStyles.projectActivityFill,
                                                            { width: getProjectActivityWidth(project.id) },
                                                            getProjectDoneTasks(project.id) === 0 &&
                                                                localStyles.projectActivityFillEmpty,
                                                        ]}
                                                    />
                                                </View>
                                            </View>
                                            <View
                                                style={[
                                                    localStyles.happinessActions,
                                                    compactModalLayout && localStyles.mobileHappinessActions,
                                                ]}
                                            >
                                                <TouchableOpacity
                                                    style={localStyles.commentButton}
                                                    onPress={() => toggleHappinessComment(project.id)}
                                                >
                                                    <Icon name="message-circle" size={20} color="#ffffff" />
                                                </TouchableOpacity>
                                                <HappinessRatingPicker
                                                    value={happinessRatings[project.id]}
                                                    onChange={rating => updateHappinessRating(project, rating)}
                                                    compact
                                                    light
                                                />
                                            </View>
                                        </View>
                                        {visibleComments[project.id] && (
                                            <TextInput
                                                ref={ref => {
                                                    if (ref) {
                                                        commentInputRefs.current[project.id] = ref
                                                    } else {
                                                        delete commentInputRefs.current[project.id]
                                                    }
                                                }}
                                                style={localStyles.happinessComment}
                                                multiline
                                                value={happinessComments[project.id] || ''}
                                                placeholder={translate('Add comment')}
                                                placeholderTextColor={colors.Text03}
                                                onChangeText={comment => updateHappinessComment(project, comment)}
                                                onBlur={() => saveHappinessComment(project)}
                                            />
                                        )}
                                    </View>
                                ))}
                            </View>
                        )}
                        {reconnectStatus === RECONNECT_FAILED && (
                            <Text style={localStyles.reconnectFailedNotice}>
                                {translate(
                                    'Still no connection. You can start the day anyway, your data will sync later'
                                )}
                            </Text>
                        )}
                        <View style={localStyles.line} />
                        <View style={[localStyles.actions, compactModalLayout && localStyles.mobileActions]}>
                            {/* Offline, the popup used to be a dead end: it said it could
                                not read yesterday's numbers and offered no way to ask
                                again (AT-2391). */}
                            {showOfflineView && (
                                <TouchableOpacity
                                    style={[
                                        localStyles.reconnect,
                                        compactModalLayout && localStyles.mobileReconnect,
                                        isReconnecting && localStyles.refreshDisabled,
                                    ]}
                                    testID="newDayReconnectButton"
                                    onPress={onPressReconnect}
                                    disabled={isReconnecting}
                                >
                                    <View style={localStyles.refreshContent}>
                                        {isReconnecting ? (
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
                                            {translate(isReconnecting ? 'Reconnecting' : 'Reconnect now')}
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
    happinessSection: {
        marginTop: 12,
    },
    happinessTitle: {
        ...styles.subtitle1,
        color: '#ffffff',
        marginBottom: 4,
    },
    happinessPrivacy: {
        ...styles.body2,
        color: colors.Text04,
        marginBottom: 8,
    },
    happinessProject: {
        borderTopWidth: 1,
        borderColor: 'rgba(255,255,255,0.12)',
        paddingVertical: 16,
    },
    mobileHappinessProject: {
        paddingVertical: 14,
    },
    happinessProjectHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
    },
    mobileHappinessProjectHeader: {
        flexDirection: 'column',
        alignItems: 'stretch',
    },
    happinessProjectInfo: {
        flex: 1,
        marginRight: 16,
        minWidth: 0,
    },
    mobileHappinessProjectInfo: {
        marginRight: 0,
        marginBottom: 10,
    },
    happinessProjectName: {
        ...styles.subtitle2,
        color: '#ffffff',
        flexShrink: 1,
    },
    happinessProjectStats: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
    },
    happinessProjectStatsText: {
        ...styles.caption2,
        color: colors.Text04,
        marginLeft: 4,
    },
    projectActivityTrack: {
        height: 4,
        borderRadius: 2,
        backgroundColor: 'rgba(255,255,255,0.12)',
        marginTop: 8,
        overflow: 'hidden',
    },
    projectActivityFill: {
        height: 4,
        borderRadius: 2,
        backgroundColor: colors.Primary300,
    },
    projectActivityFillEmpty: {
        width: 0,
    },
    happinessActions: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 0,
    },
    mobileHappinessActions: {
        alignSelf: 'stretch',
        justifyContent: 'space-between',
    },
    commentButton: {
        width: 36,
        height: 36,
        borderRadius: 4,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 8,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.2)',
        backgroundColor: 'rgba(255,255,255,0.08)',
    },
    happinessComment: {
        ...styles.body2,
        color: '#ffffff',
        minHeight: 72,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.2)',
        borderRadius: 4,
        padding: 8,
        marginTop: 8,
        textAlignVertical: 'top',
    },
})
