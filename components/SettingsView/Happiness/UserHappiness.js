import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import URLsSettings, { URL_SETTINGS_HAPPINESS } from '../../../URLSystem/Settings/URLsSettings'
import FilterBy from '../../StatisticsView/StatisticsSection/FilterBy'
import {
    getDateRangesTimestamps,
    getFilterOption,
    getStatisticsFilterData,
} from '../../StatisticsView/statisticsHelper'
import HappinessStatsPanel from '../../ProjectHappiness/HappinessStatsPanel'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import { updateUserStatisticsFilter } from '../../../utils/backends/Users/usersFirestore'
import Backend from '../../../utils/BackendBridge'

export default function UserHappiness() {
    const loggedUser = useSelector(state => state.loggedUser)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const filterData = useSelector(state => state.loggedUser.statisticsData)
    const { timestamp1, timestamp2 } = getDateRangesTimestamps(filterData, true)
    const [happinessByProject, setHappinessByProject] = useState({})

    const writeBrowserURL = () => {
        URLsSettings.push(URL_SETTINGS_HAPPINESS)
    }

    const updateHappinessFilter = (filterOption, customDateRange) => {
        const filterData = getStatisticsFilterData(filterOption, customDateRange)
        updateUserStatisticsFilter(loggedUser.uid, filterData)
    }

    useEffect(() => {
        writeBrowserURL()
    }, [])

    useEffect(() => {
        const watcherKey = v4()
        const watcherKeys = loggedUserProjects.map(project => `settings_happiness_${project.id}_${watcherKey}`)

        setHappinessByProject({})

        loggedUserProjects.forEach(project => {
            Backend.watchProjectHappinessByRange(
                project.id,
                loggedUser.uid,
                timestamp1,
                timestamp2,
                `settings_happiness_${project.id}_${watcherKey}`,
                (projectId, entries) => {
                    setHappinessByProject(state => ({ ...state, [projectId]: entries }))
                }
            )
        })

        return () => watcherKeys.forEach(key => Backend.unwatch(key))
    }, [JSON.stringify(filterData), JSON.stringify(loggedUserProjects.map(project => project.id)), loggedUser.uid])

    return (
        <View style={localStyles.container}>
            <View style={localStyles.header}>
                <Text style={[styles.title6, { color: colors.Text01 }]}>{translate('Happiness')}</Text>
                <View style={localStyles.filterContainer}>
                    <FilterBy
                        updateFilterData={updateHappinessFilter}
                        statisticsFilter={getFilterOption(filterData)}
                        modalDescription={'happiness filter description'}
                        showWarningIconInModal={true}
                    />
                </View>
            </View>

            <HappinessStatsPanel happinessByProject={happinessByProject} showTitle={false} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
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
