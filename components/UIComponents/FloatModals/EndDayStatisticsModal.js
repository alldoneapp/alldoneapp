import React, { useEffect, useState, useRef } from 'react'
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
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
import {
    ESTIMATION_TYPE_POINTS,
    ESTIMATION_TYPE_TIME,
    getDoneTimeValue,
    getEstimationTypeByProjectId,
} from '../../../utils/EstimationHelper'
import { setUserStatisticsModalDate } from '../../../utils/backends/Users/usersFirestore'

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

    const [doneTasks, setDoneTasks] = useState(0)
    const [xp, setXp] = useState(0)
    const [donePoints, setDonePoints] = useState(0)
    const [doneTime, setDoneTime] = useState(0)
    const [gold, setGold] = useState(0)
    const [showEmptyInbox, setShowEmptyInbox] = useState(true)
    const [dataLoaded, setDataLoaded] = useState(null)
    const [statsDate, setStatsDate] = useState(statisticsModalDate)

    const isOfflineRef = useRef(false)
    const isLoading = useRef(false)

    const needToShowYesterdayStats = () => {
        const today = moment()
        const statsDay = moment(statisticsModalDate)
        return today.isAfter(statsDay, 'day')
    }

    const close = e => {
        e.preventDefault()
        e.stopPropagation()
        setDoneTasks(0)
        setXp(0)
        setDonePoints(0)
        setGold(0)
        setShowEmptyInbox(true)
        setDataLoaded(null)
        setStatsDate(statisticsModalDate)
        isOfflineRef.current = false
        isLoading.current = false
    }

    const updateStatistics = (projectId, statistics) => {
        if (!isOfflineRef.current) {
            const estimationType = getEstimationTypeByProjectId(projectId)
            const recheadEmptyInbox = getIfLoggedUserReachedEmptyInbox(statsDate)
            if (!recheadEmptyInbox) {
                const { sidebarNumbers } = store.getState()
                if (sidebarNumbers[projectId] && sidebarNumbers[projectId][loggedUserId]) setShowEmptyInbox(false)
            }

            const { donePoints, doneTime, doneTasks, gold, xp } = statistics
            setDoneTasks(state => state + (doneTasks ? doneTasks : 0))
            setDonePoints(state => state + (donePoints && estimationType === ESTIMATION_TYPE_POINTS ? donePoints : 0))
            setDoneTime(state => state + (doneTime && estimationType === ESTIMATION_TYPE_TIME ? doneTime : 0))
            setGold(state => state + (gold ? gold : 0))
            setXp(state => state + (xp ? xp : 0))
            setDataLoaded(dataLoaded => {
                return { ...dataLoaded, [projectId]: true }
            })
            setUserStatisticsModalDate(statisticsModalDate)
        }
    }

    const activeOfflineMode = () => {
        isOfflineRef.current = true
        setDataLoaded({})
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
            const { loggedUserProjects, loggedUser } = store.getState()
            const { templateProjectIds } = loggedUser
            for (let i = 0; i < loggedUserProjects.length; i++) {
                const project = loggedUserProjects[i]
                if (!templateProjectIds.includes(project.id)) {
                    dataLoaded[project.id] = false
                    Backend.getUserStatistics(
                        project.id,
                        loggedUserId,
                        statisticsDate,
                        updateStatistics,
                        activeOfflineMode
                    )
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

    return (
        !showNewVersionMandtoryNotifcation &&
        checkIfDataIsLoaded() && (
            <View style={localStyles.parent}>
                <View
                    style={[localStyles.container, !smallScreenNavigation && { marginLeft: 263 }, applyPopoverWidth()]}
                >
                    <Text style={localStyles.title}>{translate('A new day has begun')}</Text>
                    <Text style={localStyles.description}>
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
                        <View style={{ flexDirection: smallScreenNavigation ? 'column' : 'row' }}>
                            <View style={{ flex: 1, marginRight: 8 }}>
                                <View style={{ flexDirection: 'row', marginBottom: 16 }}>
                                    <Icon name="check-square" size={24} color="#ffffff" />
                                    <Text style={localStyles.text}>{translate('Tasks done:')}</Text>
                                    <Text style={[localStyles.text, localStyles.value]}>{doneTasks}</Text>
                                </View>
                                <View style={{ flexDirection: 'row', marginBottom: 16 }}>
                                    <Icon name="story-point" size={24} color="#ffffff" />
                                    <Text style={localStyles.text}>{translate('Points earned:')}</Text>
                                    <Text style={[localStyles.text, localStyles.value]}>{donePoints}</Text>
                                </View>
                                <View style={[{ flexDirection: 'row' }, smallScreenNavigation && { marginBottom: 16 }]}>
                                    <Icon name="clock" size={24} color="#ffffff" />
                                    <Text style={localStyles.text}>{`${translate('Time logged')}:`}</Text>
                                    <Text style={[localStyles.text, localStyles.value]}>
                                        {getDoneTimeValue(doneTime)}
                                    </Text>
                                </View>
                            </View>
                            <View style={{ flex: 1, marginLeft: smallScreenNavigation ? 0 : 8 }}>
                                <View style={{ flexDirection: 'row', marginBottom: 16 }}>
                                    <Icon name="trending-up" size={24} color="#ffffff" />
                                    <Text style={localStyles.text}>{translate('XP earned:')}</Text>
                                    <Text style={[localStyles.text, localStyles.value]}>{xp}</Text>
                                </View>
                                <View style={{ flexDirection: 'row' }}>
                                    <Lottie
                                        animationData={goldAnimation}
                                        autoplay={false}
                                        style={{ width: 24, height: 24 }}
                                    />
                                    <Text style={localStyles.text}>{translate('Gold earned:')}</Text>
                                    <Text style={[localStyles.text, localStyles.value]}>{Math.floor(gold)}</Text>
                                </View>
                            </View>
                        </View>
                    )}
                    <View style={localStyles.line} />
                    <TouchableOpacity
                        style={localStyles.refresh}
                        onPress={showNewDayNotification ? deleteCacheAndRefresh : close}
                    >
                        <Text style={localStyles.buttonText}>{translate('Start new day')}</Text>
                    </TouchableOpacity>
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
        ...Platform.select({
            web: {
                boxShadow: `${0}px ${16}px ${32}px rgba(0,0,0,0.04), ${0}px ${16}px ${24}px rgba(0, 0, 0, 0.04)`,
            },
        }),
    },
    animationContainer: {
        alignSelf: 'center',
    },
    title: {
        ...styles.title7,
        color: '#FFFFFF',
        fontWeight: '500',
    },
    description: {
        ...styles.body2,
        color: colors.Text03,
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
    date: {
        ...styles.body2,
        color: colors.Text04,
    },
    value: {
        marginLeft: 4,
    },
})
