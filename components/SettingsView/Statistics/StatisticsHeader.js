import React, { useEffect } from 'react'
import { StyleSheet, View, Text } from 'react-native'
import { useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import styles, { colors } from '../../styles/global'
import FilterBy from '../../StatisticsView/StatisticsSection/FilterBy'
import Backend from '../../../utils/BackendBridge'
import {
    getDateRangesTimestamps,
    getFilterOption,
    getStatisticsFilterData,
} from '../../StatisticsView/statisticsHelper'
import { translate } from '../../../i18n/TranslationService'
import { updateUserStatisticsFilter } from '../../../utils/backends/Users/usersFirestore'

export default function StatisticsHeader({
    setDoneTasksByProject,
    setDonePointsByProject,
    setDoneTimeByProject,
    setXpByProject,
    setGoldByProject,
    setAllDoneTasksByProject,
    setAllDonePointsByProject,
    setAllDoneTimeByProject,
    setAllXpByProject,
    setAllGoldByProject,
}) {
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const loggedUser = useSelector(state => state.loggedUser)
    const filterData = useSelector(state => state.loggedUser.statisticsData)

    const updateStatisticsFilter = (filterOption, customDateRange) => {
        const filterData = getStatisticsFilterData(filterOption, customDateRange)
        updateUserStatisticsFilter(loggedUser.uid, filterData)
    }

    const updateValues = (projectId, state, newValue) => {
        let total = state.total + newValue
        if (state[projectId]) total -= state[projectId]
        return { ...state, total, [projectId]: newValue }
    }

    const updateAllValues = (projectId, state, newValue, isTime = false) => {
        let total = state.total != null ? { ...state.total } : {}
        let project = state[projectId] ? { ...state[projectId] } : {}

        for (let date in newValue) {
            if (total[date]) {
                total[date] += newValue[date]
            } else {
                total[date] = newValue[date] || 0
            }

            if (project[date]) {
                project[date] += newValue[date]
            } else {
                project[date] = newValue[date] || 0
            }

            if (state[projectId]?.[date]) {
                total[date] -= state[projectId][date]
            }
        }

        if (isTime) {
            for (let key in total) {
                total[key] = total[key] / 60
            }
            for (let key in project) {
                project[key] = project[key] / 60
            }
        }

        return { ...state, total, [projectId]: project }
    }

    const updateAllStatistics = (projectId, statistics, allStatistics) => {
        // Cumulative statistics
        const { doneTasks, donePoints, doneTime, xp, gold } = statistics

        setDoneTasksByProject(state => updateValues(projectId, state, doneTasks))
        setDonePointsByProject(state => updateValues(projectId, state, donePoints))
        setDoneTimeByProject(state => updateValues(projectId, state, doneTime))
        setXpByProject(state => updateValues(projectId, state, xp))
        setGoldByProject(state => updateValues(projectId, state, gold))

        // All dates statistics
        const { allDoneTasks, allDonePoints, allDoneTime, allXp, allGold } = allStatistics

        setAllDoneTasksByProject(state => updateAllValues(projectId, state, allDoneTasks))
        setAllDonePointsByProject(state => updateAllValues(projectId, state, allDonePoints))
        setAllDoneTimeByProject(state => updateAllValues(projectId, state, allDoneTime, true))
        setAllXpByProject(state => updateAllValues(projectId, state, allXp))
        setAllGoldByProject(state => updateAllValues(projectId, state, allGold))
    }

    useEffect(() => {
        setAllDoneTasksByProject({ total: null })
        setAllDonePointsByProject({ total: null })
        setAllDoneTimeByProject({ total: null })
        setAllXpByProject({ total: null })
        setAllGoldByProject({ total: null })

        const watcherKeys = []
        const { timestamp1, timestamp2 } = getDateRangesTimestamps(filterData)
        for (let i = 0; i < loggedUserProjects.length; i++) {
            const project = loggedUserProjects[i]
            watcherKeys.push(v4())
            Backend.watchAllUserStatisticsByRange(
                project.id,
                project.estimationType,
                loggedUser.uid,
                timestamp1,
                timestamp2,
                watcherKeys[i],
                updateAllStatistics
            )
        }

        return () => {
            for (let i = 0; i < loggedUserProjects.length; i++) {
                Backend.unwatch(watcherKeys[i])
            }
        }
    }, [loggedUserProjects.length, JSON.stringify(filterData)])

    const filter = getFilterOption(filterData)

    return (
        <View style={localStyles.container}>
            <Text style={[styles.title6, { color: colors.Text01 }]}>{translate('Statistics')}</Text>
            <View style={localStyles.filterContainer}>
                <FilterBy
                    updateFilterData={updateStatisticsFilter}
                    statisticsFilter={filter}
                    modalDescription={'statistics filter description'}
                    showWarningIconInModal={true}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 72,
        paddingTop: 32,
        paddingBottom: 12,
        alignItems: 'center',
        flexDirection: 'row',
    },
    filterContainer: {
        marginLeft: 'auto',
    },
})
