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
import HappinessRatingModal from '../../ProjectHappiness/HappinessRatingModal'
import Button from '../../UIControls/Button'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import { updateUserStatisticsFilter } from '../../../utils/backends/Users/usersFirestore'
import Backend from '../../../utils/BackendBridge'

export default function UserHappiness() {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const loggedUser = useSelector(state => state.loggedUser)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const filterData = useSelector(state => state.loggedUser.statisticsData)
    const { timestamp1, timestamp2 } = getDateRangesTimestamps(filterData, true)
    const [happinessByProject, setHappinessByProject] = useState({})
    const [showRatingModal, setShowRatingModal] = useState(false)

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
            {/* On a phone the title and the two controls cannot share one
                72px line: the "Rate happiness" button ended up squeezed
                against the date filter. The header stacks and the controls
                wrap instead. */}
            <View style={[localStyles.header, mobile && localStyles.mobileHeader]} testID="happinessHeader">
                <Text style={[styles.title6, { color: colors.Text01 }]}>{translate('Happiness')}</Text>
                <View
                    style={[localStyles.actionsContainer, mobile && localStyles.mobileActionsContainer]}
                    testID="happinessHeaderActions"
                >
                    {/* The on-demand twin of the "new day" popup (AT-2392): the
                        same rating rows, for a day you pick. */}
                    <Button
                        title={translate('Rate happiness')}
                        type="primary"
                        icon="smile"
                        onPress={() => setShowRatingModal(true)}
                        buttonStyle={localStyles.rateButton}
                    />
                    <FilterBy
                        updateFilterData={updateHappinessFilter}
                        statisticsFilter={getFilterOption(filterData)}
                        modalDescription={'happiness filter description'}
                        showWarningIconInModal={true}
                    />
                </View>
            </View>

            <HappinessStatsPanel happinessByProject={happinessByProject} showTitle={false} />

            {showRatingModal && <HappinessRatingModal onClose={() => setShowRatingModal(false)} />}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        minHeight: 72,
        paddingTop: 32,
        paddingBottom: 12,
        alignItems: 'center',
        flexDirection: 'row',
    },
    mobileHeader: {
        flexDirection: 'column',
        alignItems: 'stretch',
    },
    actionsContainer: {
        marginLeft: 'auto',
        flexDirection: 'row',
        alignItems: 'center',
    },
    mobileActionsContainer: {
        marginLeft: 0,
        marginTop: 12,
        flexWrap: 'wrap',
        rowGap: 8,
    },
    rateButton: {
        marginRight: 8,
    },
})
