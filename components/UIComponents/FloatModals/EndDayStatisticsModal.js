import React, { useEffect, useState, useRef } from 'react'
import { Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
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
    getDoneTimeValue,
    getEstimationTypeByProjectId,
} from '../../../utils/EstimationHelper'
import { setUserStatisticsModalDate } from '../../../utils/backends/Users/usersFirestore'
import {
    normalizeDayRateTimeLogConfig,
    reconcileProjectDayRateTimeLogsBackfill,
} from '../../../utils/DayRateTimeLogHelper'
import HappinessRatingPicker from '../../ProjectHappiness/HappinessRatingPicker'
import { HAPPINESS_PRIVACY_TEXT } from '../../../utils/ProjectHappinessHelper'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { getSafeStatisticNumber } from '../../../utils/StatisticDataHelper'

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
    const sidebarNumbersAreLoading = useSelector(state => state.sidebarNumbers.loading)
    const loggedUserProjectsAmount = useSelector(state => state.loggedUserProjects.length)
    const statisticsModalDate = useSelector(state => state.loggedUser.statisticsModalDate)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const projectIdsAmount = useSelector(state => state.loggedUser.projectIds.length)
    const showNewDayNotification = useSelector(state => state.showNewDayNotification)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const showNewVersionMandtoryNotifcation = useSelector(state => state.showNewVersionMandtoryNotifcation)
    const templateProjectIdsAmount = useSelector(state => state.loggedUser.templateProjectIds.length)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const loggedUser = useSelector(state => state.loggedUser)

    const [doneTasks, setDoneTasks] = useState(0)
    const [xp, setXp] = useState(0)
    const [donePoints, setDonePoints] = useState(0)
    const [doneTime, setDoneTime] = useState(0)
    const [gold, setGold] = useState(0)
    const [showEmptyInbox, setShowEmptyInbox] = useState(true)
    const [dataLoaded, setDataLoaded] = useState(null)
    const [statsDate, setStatsDate] = useState(statisticsModalDate)
    const [doneTasksByProject, setDoneTasksByProject] = useState({})
    const [happinessRatings, setHappinessRatings] = useState({})
    const [happinessComments, setHappinessComments] = useState({})
    const [visibleComments, setVisibleComments] = useState({})

    const isOfflineRef = useRef(false)
    const isLoading = useRef(false)
    const isSavingStartNewDay = useRef(false)
    const happinessWatcherKeyRef = useRef(`new_day_happiness_${loggedUserId}`)
    const commentInputRefs = useRef({})
    const pendingCommentFocusProjectIdRef = useRef(null)
    const dirtyHappinessProjectIdsRef = useRef(new Set())
    const happinessDraftsRef = useRef({})

    const needToShowYesterdayStats = () => {
        const today = moment()
        const statsDay = moment(statisticsModalDate)
        return today.isAfter(statsDay, 'day')
    }

    const resetModalState = () => {
        setDoneTasks(0)
        setXp(0)
        setDonePoints(0)
        setGold(0)
        setDoneTasksByProject({})
        setShowEmptyInbox(true)
        setDataLoaded(null)
        setStatsDate(statisticsModalDate)
        setHappinessRatings({})
        setHappinessComments({})
        setVisibleComments({})
        pendingCommentFocusProjectIdRef.current = null
        dirtyHappinessProjectIdsRef.current.clear()
        happinessDraftsRef.current = {}
        isOfflineRef.current = false
        isLoading.current = false
        isSavingStartNewDay.current = false
    }

    const saveDirtyHappinessEntries = async () => {
        const dirtyProjectIds = dirtyHappinessProjectIdsRef.current
        if (dirtyProjectIds.size === 0) return

        const promises = getHappinessProjects().reduce((promises, project) => {
            if (!dirtyProjectIds.has(project.id)) return promises

            const draft = happinessDraftsRef.current[project.id] || {}
            const rating = draft.rating || happinessRatings[project.id]
            if (rating) {
                promises.push(
                    Backend.setProjectHappiness(
                        project.id,
                        loggedUserId,
                        statsDate,
                        rating,
                        draft.comment != null ? draft.comment : happinessComments[project.id] || '',
                        project
                    )
                )
            }
            return promises
        }, [])

        await Promise.all(promises)
        dirtyProjectIds.clear()
    }

    const startNewDay = async e => {
        e.preventDefault()
        e.stopPropagation()
        if (isSavingStartNewDay.current) return

        isSavingStartNewDay.current = true

        try {
            if (!isOfflineRef.current) {
                const newStatisticsModalDate = Date.now()
                const { loggedUser } = store.getState()
                const updatedLoggedUser = {
                    ...loggedUser,
                    statisticsModalDate: newStatisticsModalDate,
                    previousStatisticsModalDate: statsDate,
                }
                await saveDirtyHappinessEntries()
                await setUserStatisticsModalDate(statsDate, newStatisticsModalDate)
                store.dispatch(storeLoggedUser(updatedLoggedUser))
                UserDataCache.setCachedUserData(updatedLoggedUser)
                store.dispatch(setShowNewDayNotification(false))
            }

            if (showNewDayNotification) {
                await deleteCacheAndRefresh()
            } else {
                resetModalState()
                isSavingStartNewDay.current = false
            }
        } catch (error) {
            console.log(error)
            isSavingStartNewDay.current = false
        }
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
            setDoneTasks(state => state + doneTasks)
            setDonePoints(state => state + (estimationType === ESTIMATION_TYPE_POINTS ? donePoints : 0))
            setDoneTime(state => state + (estimationType === ESTIMATION_TYPE_TIME ? doneTime : 0))
            setGold(state => state + gold)
            setXp(state => state + xp)
            setDataLoaded(dataLoaded => {
                return { ...dataLoaded, [projectId]: true }
            })
        }
    }

    const activeOfflineMode = () => {
        isOfflineRef.current = true
        setDataLoaded({})
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
            (needToShowYesterdayStats() || showNewDayNotification)
        ) {
            isLoading.current = true
            const endDayStatisticsDate = moment(statisticsModalDate)
            const statisticsDate = endDayStatisticsDate.format('DDMMYYYY')
            const dataLoaded = {}
            setDoneTasksByProject({})
            const { loggedUserProjects, loggedUser } = store.getState()
            const { templateProjectIds } = loggedUser
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
    }, [
        showNewDayNotification,
        loggedUserProjectsAmount,
        statisticsModalDate,
        projectIdsAmount,
        templateProjectIdsAmount,
        sidebarNumbersAreLoading,
        isAnonymous,
    ])

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
        Backend.setProjectHappiness(
            project.id,
            loggedUserId,
            statsDate,
            rating,
            happinessComments[project.id] || '',
            project
        )
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
        const rating = happinessRatings[project.id]
        if (rating)
            Backend.setProjectHappiness(
                project.id,
                loggedUserId,
                statsDate,
                rating,
                happinessComments[project.id] || '',
                project
            )
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
        if (isOfflineRef.current) {
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

    return (
        !showNewVersionMandtoryNotifcation &&
        checkIfDataIsLoaded() && (
            <View style={localStyles.parent}>
                <View
                    style={[
                        localStyles.container,
                        smallScreenNavigation && localStyles.mobileContainer,
                        !smallScreenNavigation && { marginLeft: 263 },
                        applyPopoverWidth(),
                    ]}
                >
                    <ScrollView showsVerticalScrollIndicator={false}>
                        <Text style={[localStyles.title, smallScreenNavigation && localStyles.mobileTitle]}>
                            {translate('A new day has begun')}
                        </Text>
                        <Text style={[localStyles.description, smallScreenNavigation && localStyles.mobileDescription]}>
                            {translate('Here a quick summary of how you have been doing')}
                        </Text>
                        <View style={localStyles.animationContainer}>
                            <Lottie
                                animationData={isOfflineRef.current ? cloudAnimation : starsAnimation}
                                autoplay={true}
                                initialSegment={isOfflineRef.current ? [0, 144] : getAnimationSegment()}
                                style={{ width: 156, height: 101 }}
                            />
                        </View>

                        <View style={[localStyles.emptyInboxContainer, isOfflineRef.current && { marginBottom: 16 }]}>
                            <Text style={localStyles.emptyInboxTitle}>{rewardTitle}</Text>
                            <Text style={localStyles.emptyInboxDescription}>{rewardDescription}</Text>
                            <Text style={localStyles.date}>{`${dayName} ${dateFormated}`}</Text>
                        </View>

                        {!isOfflineRef.current && (
                            <View style={[localStyles.statsGrid, smallScreenNavigation && localStyles.mobileStatsGrid]}>
                                <View style={[localStyles.statsColumn, !smallScreenNavigation && { marginRight: 8 }]}>
                                    <View style={localStyles.statRow}>
                                        <Icon name="check-square" size={24} color="#ffffff" />
                                        <View
                                            style={[
                                                localStyles.statTextBlock,
                                                smallScreenNavigation && localStyles.mobileStatTextBlock,
                                            ]}
                                        >
                                            <Text style={localStyles.text}>{translate('Tasks done:')}</Text>
                                            <Text
                                                style={[
                                                    localStyles.text,
                                                    localStyles.value,
                                                    smallScreenNavigation && localStyles.mobileValue,
                                                ]}
                                            >
                                                {doneTasks}
                                            </Text>
                                        </View>
                                    </View>
                                    <View style={localStyles.statRow}>
                                        <Icon name="story-point" size={24} color="#ffffff" />
                                        <View
                                            style={[
                                                localStyles.statTextBlock,
                                                smallScreenNavigation && localStyles.mobileStatTextBlock,
                                            ]}
                                        >
                                            <Text style={localStyles.text}>{translate('Points earned:')}</Text>
                                            <Text
                                                style={[
                                                    localStyles.text,
                                                    localStyles.value,
                                                    smallScreenNavigation && localStyles.mobileValue,
                                                ]}
                                            >
                                                {donePoints}
                                            </Text>
                                        </View>
                                    </View>
                                    <View style={localStyles.statRow}>
                                        <Icon name="clock" size={24} color="#ffffff" />
                                        <View
                                            style={[
                                                localStyles.statTextBlock,
                                                smallScreenNavigation && localStyles.mobileStatTextBlock,
                                            ]}
                                        >
                                            <Text style={localStyles.text}>{`${translate('Time logged')}:`}</Text>
                                            <Text
                                                style={[
                                                    localStyles.text,
                                                    localStyles.value,
                                                    smallScreenNavigation && localStyles.mobileValue,
                                                ]}
                                            >
                                                {getDoneTimeValue(doneTime)}
                                            </Text>
                                        </View>
                                    </View>
                                </View>
                                <View style={[localStyles.statsColumn, !smallScreenNavigation && { marginLeft: 8 }]}>
                                    <View style={localStyles.statRow}>
                                        <Icon name="trending-up" size={24} color="#ffffff" />
                                        <View
                                            style={[
                                                localStyles.statTextBlock,
                                                smallScreenNavigation && localStyles.mobileStatTextBlock,
                                            ]}
                                        >
                                            <Text style={localStyles.text}>{translate('XP earned:')}</Text>
                                            <Text
                                                style={[
                                                    localStyles.text,
                                                    localStyles.value,
                                                    smallScreenNavigation && localStyles.mobileValue,
                                                ]}
                                            >
                                                {xp}
                                            </Text>
                                        </View>
                                    </View>
                                    <View style={localStyles.statRow}>
                                        <Lottie
                                            animationData={goldAnimation}
                                            autoplay={false}
                                            style={localStyles.goldIcon}
                                        />
                                        <View
                                            style={[
                                                localStyles.statTextBlock,
                                                smallScreenNavigation && localStyles.mobileStatTextBlock,
                                            ]}
                                        >
                                            <Text style={localStyles.text}>{translate('Gold earned:')}</Text>
                                            <Text
                                                style={[
                                                    localStyles.text,
                                                    localStyles.value,
                                                    smallScreenNavigation && localStyles.mobileValue,
                                                ]}
                                            >
                                                {Math.floor(gold)}
                                            </Text>
                                        </View>
                                    </View>
                                </View>
                            </View>
                        )}
                        {!isOfflineRef.current && happinessProjects.length > 0 && (
                            <View style={localStyles.happinessSection}>
                                <Text style={localStyles.happinessTitle}>{translate('Project happiness')}</Text>
                                <Text style={localStyles.happinessPrivacy}>{translate(HAPPINESS_PRIVACY_TEXT)}</Text>
                                {happinessProjects.map(project => (
                                    <View
                                        key={project.id}
                                        style={[
                                            localStyles.happinessProject,
                                            smallScreenNavigation && localStyles.mobileHappinessProject,
                                        ]}
                                    >
                                        <View
                                            style={[
                                                localStyles.happinessProjectHeader,
                                                smallScreenNavigation && localStyles.mobileHappinessProjectHeader,
                                            ]}
                                        >
                                            <View
                                                style={[
                                                    localStyles.happinessProjectInfo,
                                                    smallScreenNavigation && localStyles.mobileHappinessProjectInfo,
                                                ]}
                                            >
                                                <Text style={localStyles.happinessProjectName}>{project.name}</Text>
                                                <View style={localStyles.happinessProjectStats}>
                                                    <Icon name="check-square" size={16} color={colors.Text04} />
                                                    <Text style={localStyles.happinessProjectStatsText}>
                                                        {translate('Tasks done:')}{' '}
                                                        {doneTasksByProject[project.id]
                                                            ? doneTasksByProject[project.id]
                                                            : 0}
                                                    </Text>
                                                </View>
                                            </View>
                                            <View
                                                style={[
                                                    localStyles.happinessActions,
                                                    smallScreenNavigation && localStyles.mobileHappinessActions,
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
                        <View style={localStyles.line} />
                        <TouchableOpacity
                            style={[localStyles.refresh, smallScreenNavigation && localStyles.mobileRefresh]}
                            onPress={startNewDay}
                        >
                            <Text style={localStyles.buttonText}>{translate('Start new day')}</Text>
                        </TouchableOpacity>
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
        justifyContent: 'center',
        alignItems: 'center',
    },
    container: {
        backgroundColor: colors.Secondary400,
        padding: 16,
        borderRadius: 4,
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
    animationContainer: {
        alignSelf: 'center',
    },
    title: {
        ...styles.title7,
        color: '#FFFFFF',
        fontWeight: '500',
    },
    mobileTitle: {
        textAlign: 'center',
    },
    description: {
        ...styles.body2,
        color: colors.Text03,
    },
    mobileDescription: {
        textAlign: 'center',
        marginTop: 4,
    },
    emptyInboxContainer: {
        marginBottom: 32,
        flexDirection: 'column',
        alignItems: 'center',
    },
    emptyInboxTitle: {
        ...styles.title4,
        color: '#ffffff',
        marginBottom: 12,
    },
    emptyInboxDescription: {
        ...styles.subtitle1,
        color: colors.Text04,
    },
    line: {
        height: 1,
        backgroundColor: '#ffffff',
        opacity: 0.2,
        marginHorizontal: -16,
        marginVertical: 16,
    },
    refresh: {
        borderRadius: 4,
        backgroundColor: colors.Primary300,
        paddingHorizontal: 16,
        paddingVertical: 16,
        alignSelf: 'center',
    },
    mobileRefresh: {
        alignSelf: 'stretch',
        alignItems: 'center',
        marginHorizontal: 4,
    },
    buttonText: {
        fontFamily: 'Roboto-Regular',
        fontWeight: '500',
        color: '#FFFFFF',
        fontSize: 14,
        lineHeight: 14,
        letterSpacing: em2px(0.05),
    },
    text: {
        ...styles.subtitle2,
        color: '#ffffff',
        marginLeft: 8,
    },
    statsGrid: {
        flexDirection: 'row',
    },
    mobileStatsGrid: {
        flexDirection: 'column',
        marginTop: 4,
    },
    statsColumn: {
        flex: 1,
    },
    statRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 16,
    },
    statTextBlock: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        minWidth: 0,
    },
    mobileStatTextBlock: {
        flexDirection: 'column',
        alignItems: 'flex-start',
        paddingTop: 1,
    },
    mobileValue: {
        marginLeft: 8,
        marginTop: 4,
        color: colors.Text04,
    },
    goldIcon: {
        width: 24,
        height: 24,
    },
    date: {
        ...styles.body2,
        color: colors.Text04,
    },
    value: {
        marginLeft: 4,
    },
    happinessSection: {
        marginTop: 24,
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
        paddingVertical: 8,
    },
    mobileHappinessProject: {
        paddingVertical: 14,
    },
    happinessProjectHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    mobileHappinessProjectHeader: {
        flexDirection: 'column',
        alignItems: 'stretch',
    },
    happinessProjectInfo: {
        flex: 1,
        marginRight: 8,
        minWidth: 0,
    },
    mobileHappinessProjectInfo: {
        marginRight: 0,
        marginBottom: 10,
    },
    happinessProjectName: {
        ...styles.subtitle2,
        color: '#ffffff',
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
    happinessActions: {
        flexDirection: 'row',
        alignItems: 'center',
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
        marginRight: 4,
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
