import React, { useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import v4 from 'uuid/v4'
import { DV_TAB_PROJECT_STATISTICS, DV_TAB_USER_STATISTICS } from '../../../utils/TabNavigationConstants'
import URLsPeople, { URL_PEOPLE_DETAILS_STATISTICS } from '../../../URLSystem/People/URLsPeople'
import URLsProjects, { URL_PROJECT_DETAILS_STATISTICS } from '../../../URLSystem/Projects/URLsProjects'
import {
    getDateRangesTimestamps,
    getFilterOption,
    getStatisticsFilterData,
} from '../../StatisticsView/statisticsHelper'
import { getEstimationTypeByProjectId } from '../../../utils/EstimationHelper'
import Backend from '../../../utils/BackendBridge'
import StatisticsSection from '../../StatisticsView/StatisticsSection/StatisticsSection'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'

export default function StatisticsView({ projectId, userId }) {
    const selectedTab = useSelector(state => state.selectedNavItem)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const statisticsSelectedUsersIds = useSelector(state => state.loggedUser.statisticsSelectedUsersIds[projectId])
    const [filterData, setFilterData] = useState({ filter: 'Current month', customDateRange: [] })
    const statisticsDataRef = useRef({})
    const allStatisticsDataRef = useRef({})
    const [statisticsData, setStatisticsData] = useState({})
    const [allStatisticsData, setAllStatisticsData] = useState({})

    const usersToShow = statisticsSelectedUsersIds ? statisticsSelectedUsersIds : [loggedUserId]

    const writeBrowserURL = () => {
        const data = { projectId, userId }
        if (selectedTab === DV_TAB_USER_STATISTICS) {
            URLsPeople.push(URL_PEOPLE_DETAILS_STATISTICS, data, projectId, userId)
        } else if (selectedTab === DV_TAB_PROJECT_STATISTICS) {
            URLsProjects.push(URL_PROJECT_DETAILS_STATISTICS, data, projectId, userId)
        }
    }

    const updateAllStatistics = (projectId, statistics, allStatistics, userId) => {
        // Cumulative statistics
        statisticsDataRef.current[userId] = statistics
        setStatisticsData({ ...statisticsDataRef.current, [userId]: statistics })

        // All dates statistics
        const finalStatistics = { ...allStatistics }

        for (let date in allStatistics.allDoneTime) {
            finalStatistics.allDoneTime[date] = Number((allStatistics.allDoneTime[date] / 60).toFixed(2))
        }

        allStatisticsDataRef.current[userId] = finalStatistics
        setAllStatisticsData({ ...allStatisticsDataRef.current, [userId]: finalStatistics })
    }

    const updateStatisticsFilter = (filterOption, customDateRange) => {
        setFilterData(getStatisticsFilterData(filterOption, customDateRange))
    }

    useEffect(() => {
        writeBrowserURL()
    }, [])

    useEffect(() => {
        const { timestamp1, timestamp2 } = getDateRangesTimestamps(filterData)
        const estimationType = getEstimationTypeByProjectId(projectId)
        const watcherKey = v4()
        statisticsDataRef.current = {}
        allStatisticsDataRef.current = {}
        let array = []
        usersToShow.forEach(id => {
            array.push(id)
            Backend.watchAllUserStatisticsByRange(
                projectId,
                estimationType,
                id,
                timestamp1,
                timestamp2,
                id + watcherKey,
                updateAllStatistics
            )
        })

        return () => {
            array.forEach(id => {
                Backend.unwatch(id + watcherKey)
            })
        }
    }, [JSON.stringify(filterData), JSON.stringify(usersToShow)])

    const filter = getFilterOption(filterData)

    const statisticsDataReduced = Object.values(statisticsData).reduce(
        (prev, curr) => ({
            doneTasks: prev.doneTasks + curr.doneTasks,
            donePoints: prev.donePoints + curr.donePoints,
            doneTime: prev.doneTime + curr.doneTime,
            gold: prev.gold + curr.gold,
            xp: prev.xp + curr.xp,
        }),
        { doneTasks: 0, donePoints: 0, doneTime: 0, gold: 0, xp: 0 }
    )

    const allStatisticsDataReduced = Object.values(allStatisticsData).reduce(
        (prev, curr) => ({
            allDoneTasks: { ...prev.allDoneTasks, ...curr.allDoneTasks },
            allDonePoints: { ...prev.allDonePoints, ...curr.allDonePoints },
            allDoneTime: { ...prev.allDoneTime, ...curr.allDoneTime },
            allXp: { ...prev.allXp, ...curr.allXp },
            allGold: { ...prev.allGold, ...curr.allGold },
        }),
        { allDoneTasks: 0, allDonePoints: 0, allDoneTime: 0, allXp: 0, allGold: 0 }
    )

    return (
        <StatisticsSection
            projectId={projectId}
            updateFilterData={updateStatisticsFilter}
            statisticsData={statisticsDataReduced}
            allStatisticsData={allStatisticsDataReduced}
            statisticsFilter={filter}
            filterData={filterData}
        />
    )
}
