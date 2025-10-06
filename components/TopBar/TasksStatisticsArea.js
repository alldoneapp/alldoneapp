import React, { useEffect, useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native'
import v4 from 'uuid/v4'
import moment from 'moment'

import styles from '../styles/global'
import { getTheme } from '../../Themes/Themes'
import { Themes } from './Themes'
import Backend from '../../utils/BackendBridge'
import NavigationService from '../../utils/NavigationService'
import { navigateToSettings, setSelectedNavItem, switchProject } from '../../redux/actions'
import { convertCurrency, formatCurrency } from '../../utils/CurrencyConverter'
import { DV_TAB_PROJECT_STATISTICS, DV_TAB_SETTINGS_STATISTICS } from '../../utils/TabNavigationConstants'
import Icon from '../Icon'
import {
    parseNumberToUseThousand,
    STATISTIC_RANGE_ALL,
    STATISTIC_RANGE_CURRENT_MONTH,
    STATISTIC_RANGE_CUSTOM,
    STATISTIC_RANGE_LAST_14_DAYS,
    STATISTIC_RANGE_LAST_7_DAYS,
    STATISTIC_RANGE_LAST_MONTH,
    STATISTIC_RANGE_TODAY,
} from '../StatisticsView/statisticsHelper'
import { translate } from '../../i18n/TranslationService'
import store from '../../redux/store'
import {
    convertMinutesInHours,
    ESTIMATION_TYPE_BOTH,
    ESTIMATION_TYPE_POINTS,
    ESTIMATION_TYPE_TIME,
    getEstimationTypeToUse,
} from '../../utils/EstimationHelper'
import { checkIfSelectedProject } from '../SettingsView/ProjectsSettings/ProjectHelper'

export default function TasksStatisticsArea() {
    const dispatch = useDispatch()
    const loggedUserProjectsAmount = useSelector(state => state.loggedUserProjects.length)
    const themeName = useSelector(state => state.loggedUser.themeName)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const selectedProject = useSelector(state => state.loggedUserProjects[selectedProjectIndex])
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const loggedUser = useSelector(state => state.loggedUser)
    const smallScreen = useSelector(state => state.smallScreen)
    const topBarWidth = useSelector(state => state.topBarWidth)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [doneTasksByProject, setDoneTasksByProject] = useState({ total: 0 })
    const [donePointsByProject, setDonePointsByProject] = useState({ total: 0 })
    const [doneTimeByProject, setDoneTimeByProject] = useState({ total: 0 })
    const estimationTypeToUse = getEstimationTypeToUse()

    const getValueToShow = valuesMap => {
        return selectedProject ? valuesMap[selectedProject.id] || 0 : valuesMap.total
    }

    const doneTasksToShow = getValueToShow(doneTasksByProject)
    const donePointsToShow = getValueToShow(donePointsByProject)
    const doneTimeToShow = getValueToShow(doneTimeByProject)

    // Check if hourly rate and currency are configured for the selected project
    const hasHourlyRateConfigured = () => {
        if (!selectedProject || !selectedProject.hourlyRatesData) return false
        const { currency, hourlyRates } = selectedProject.hourlyRatesData
        const userHourlyRate = hourlyRates[loggedUserId]
        return currency && userHourlyRate && userHourlyRate > 0
    }

    // Check if any project has hourly rate configured (for "All Projects" view)
    const hasAnyProjectWithHourlyRate = () => {
        const { loggedUserProjects } = store.getState()
        return loggedUserProjects.some(project => {
            if (!project.hourlyRatesData) return false
            const { currency, hourlyRates } = project.hourlyRatesData
            const userHourlyRate = hourlyRates[loggedUserId]
            return currency && userHourlyRate && userHourlyRate > 0
        })
    }

    // Calculate money earned for the logged user across all projects
    const calculateMoneyEarnedAllProjects = () => {
        const { loggedUserProjects, loggedUser } = store.getState()
        const defaultCurrency = loggedUser.defaultCurrency || 'EUR'
        let totalEarned = 0

        loggedUserProjects.forEach(project => {
            if (!project.hourlyRatesData) return
            const { currency, hourlyRates } = project.hourlyRatesData
            const userHourlyRate = hourlyRates[loggedUserId]

            if (currency && userHourlyRate && userHourlyRate > 0) {
                const projectTimeLogged = doneTimeByProject[project.id] || 0
                if (projectTimeLogged > 0) {
                    const timeInHours = projectTimeLogged / 60 // Convert minutes to hours
                    const projectEarnedInProjectCurrency = timeInHours * userHourlyRate

                    // Convert project earnings to user's default currency
                    const projectEarnedInDefaultCurrency = convertCurrency(
                        projectEarnedInProjectCurrency,
                        currency,
                        defaultCurrency
                    )

                    totalEarned += projectEarnedInDefaultCurrency
                }
            }
        })

        return totalEarned
    }

    // Calculate money earned for the logged user
    const calculateMoneyEarned = () => {
        if (!hasHourlyRateConfigured() || doneTimeToShow === 0) return 0
        const { hourlyRates } = selectedProject.hourlyRatesData
        const userHourlyRate = hourlyRates[loggedUserId]
        const timeInHours = doneTimeToShow / 60 // Convert minutes to hours
        return timeInHours * userHourlyRate
    }

    const showMoneyInsteadOfTime = selectedProject ? hasHourlyRateConfigured() : hasAnyProjectWithHourlyRate()
    const moneyEarned = selectedProject ? calculateMoneyEarned() : calculateMoneyEarnedAllProjects()
    const currency = selectedProject
        ? selectedProject?.hourlyRatesData?.currency || 'EUR'
        : loggedUser.defaultCurrency || 'EUR'

    const useMobile =
        smallScreen ||
        (donePointsToShow > 0 && doneTimeToShow === 0 && topBarWidth < 840) ||
        (donePointsToShow === 0 && doneTimeToShow > 0 && topBarWidth < 890) ||
        (donePointsToShow > 0 && doneTimeToShow > 0 && topBarWidth < 970)

    const theme = getTheme(Themes, themeName, 'TopBar.TopBarStatisticArea.TasksStatisticsArea')

    const updateValues = (projectId, state, newValue) => {
        let total = state.total + newValue
        if (state[projectId]) total -= state[projectId]
        return { ...state, total, [projectId]: newValue }
    }

    const updateStatistics = (projectId, statistics) => {
        const { doneTasks, donePoints, doneTime } = statistics
        setDoneTasksByProject(state => updateValues(projectId, state, doneTasks))
        setDonePointsByProject(state => updateValues(projectId, state, donePoints))
        setDoneTimeByProject(state => updateValues(projectId, state, doneTime))
    }

    const navigateToStatistics = () => {
        if (checkIfSelectedProject(selectedProjectIndex)) {
            dispatch([setSelectedNavItem(DV_TAB_PROJECT_STATISTICS), switchProject(selectedProjectIndex)])
            NavigationService.navigate('ProjectDetailedView', {
                projectIndex: selectedProjectIndex,
            })
        } else {
            dispatch(navigateToSettings({ selectedNavItem: DV_TAB_SETTINGS_STATISTICS }))
            NavigationService.navigate('SettingsView')
        }
    }

    const getDateRangesTimestamps = statisticsData => {
        const { filter, customDateRange } = statisticsData
        let startDay, endDay
        if (filter === STATISTIC_RANGE_TODAY) {
            startDay = moment()
            endDay = moment()
        } else if (filter === STATISTIC_RANGE_LAST_7_DAYS) {
            startDay = moment().subtract(1, 'week')
            endDay = moment()
        } else if (filter === STATISTIC_RANGE_LAST_14_DAYS) {
            startDay = moment().subtract(2, 'weeks')
            endDay = moment()
        } else if (filter === STATISTIC_RANGE_LAST_MONTH) {
            startDay = moment().subtract(1, 'month').startOf('month')
            endDay = startDay.clone().add(startDay.daysInMonth() - 1, 'day')
        } else if (filter === STATISTIC_RANGE_CURRENT_MONTH) {
            startDay = moment().startOf('month')
            endDay = startDay.clone().add(startDay.daysInMonth() - 1, 'day')
        } else if (filter === STATISTIC_RANGE_CUSTOM) {
            startDay = moment(customDateRange[0])
            endDay = moment(customDateRange[customDateRange.length - 1])
        } else if (filter === STATISTIC_RANGE_ALL) {
            startDay = moment(0)
            endDay = moment()
        }
        const timestamp1 = startDay.startOf('day').valueOf()
        const timestamp2 = endDay.endOf('day').valueOf()
        return { timestamp1, timestamp2 }
    }

    useEffect(() => {
        const watcherKeys = []
        const { loggedUserProjects, loggedUser } = store.getState()
        const { timestamp1, timestamp2 } = getDateRangesTimestamps({ filter: STATISTIC_RANGE_CURRENT_MONTH })

        for (let i = 0; i < loggedUserProjects.length; i++) {
            const project = loggedUserProjects[i]
            watcherKeys.push(v4())
            Backend.watchUserStatistics(
                project.id,
                project.estimationType,
                loggedUserId,
                timestamp1,
                timestamp2,
                watcherKeys[i],
                updateStatistics
            )
        }

        return () => {
            for (let i = 0; i < loggedUserProjects.length; i++) {
                Backend.unwatch(watcherKeys[i])
            }
        }
    }, [loggedUserProjectsAmount])

    return (
        <TouchableOpacity
            onPress={navigateToStatistics}
            style={[
                localStyle.container,
                useMobile || smallScreenNavigation ? { marginRight: 8, paddingLeft: 8 } : null,
                smallScreenNavigation ? theme.containerMobile : theme.container,
            ]}
        >
            <View style={localStyle.textContainer}>
                {useMobile ? (
                    <Icon
                        name="check-square"
                        size={20}
                        color={smallScreenNavigation ? theme.iconColorMobile : theme.iconColor}
                    />
                ) : (
                    <Text style={[localStyle.text, smallScreenNavigation ? theme.textMobile : theme.text]}>
                        {translate('Done tasks')}
                    </Text>
                )}
                <Text style={[localStyle.value, theme.value]}>{parseNumberToUseThousand(doneTasksToShow)}</Text>
            </View>
            {donePointsToShow > 0 &&
                (estimationTypeToUse === ESTIMATION_TYPE_POINTS || estimationTypeToUse === ESTIMATION_TYPE_BOTH) && (
                    <View style={{ flexDirection: 'row' }}>
                        <View style={[localStyle.line, smallScreenNavigation ? theme.lineMobile : theme.line]} />
                        <View style={localStyle.textContainer}>
                            {useMobile ? (
                                <Icon
                                    name="story-point"
                                    size={20}
                                    color={smallScreenNavigation ? theme.iconColorMobile : theme.iconColor}
                                />
                            ) : (
                                <Text style={[localStyle.text, smallScreenNavigation ? theme.textMobile : theme.text]}>
                                    {translate('points')}
                                </Text>
                            )}

                            <Text style={[localStyle.value, theme.value]}>
                                {parseNumberToUseThousand(donePointsToShow)}
                            </Text>
                        </View>
                    </View>
                )}
            {doneTimeToShow > 0 &&
                (estimationTypeToUse === ESTIMATION_TYPE_TIME || estimationTypeToUse === ESTIMATION_TYPE_BOTH) && (
                    <View style={{ flexDirection: 'row' }}>
                        <View style={[localStyle.line, smallScreenNavigation ? theme.lineMobile : theme.line]} />
                        <View style={localStyle.textContainer}>
                            {useMobile ? (
                                <Icon
                                    name={showMoneyInsteadOfTime ? 'credit-card' : 'clock'}
                                    size={20}
                                    color={smallScreenNavigation ? theme.iconColorMobile : theme.iconColor}
                                />
                            ) : (
                                <Text style={[localStyle.text, smallScreenNavigation ? theme.textMobile : theme.text]}>
                                    {translate(showMoneyInsteadOfTime ? 'earned' : 'time')}
                                </Text>
                            )}

                            <Text style={[localStyle.value, theme.value]}>
                                {showMoneyInsteadOfTime
                                    ? formatCurrency(moneyEarned, currency)
                                    : convertMinutesInHours(doneTimeToShow).toFixed(1)}
                            </Text>
                        </View>
                    </View>
                )}
        </TouchableOpacity>
    )
}

const localStyle = StyleSheet.create({
    container: {
        paddingVertical: 4,
        paddingHorizontal: 12,
        flexDirection: 'row',
        borderRadius: 16,
        marginRight: 16,
        height: 28,
    },
    textContainer: {
        flexDirection: 'row',
    },
    text: {
        ...styles.caption2,
    },
    value: {
        ...styles.caption2,
        marginLeft: 8,
    },
    line: {
        width: 1,
        height: 20,
        marginHorizontal: 8,
    },
})
