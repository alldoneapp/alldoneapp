import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import StatisticsHeader from './StatisticsHeader'
import URLsSettings, { URL_SETTINGS_STATISTICS } from '../../../URLSystem/Settings/URLsSettings'
import StatisticItem from '../../StatisticsView/StatisticsSection/StatisticItem'
import { getDateRangesTimestamps, parseNumberToUseThousand } from '../../StatisticsView/statisticsHelper'
import {
    ESTIMATION_TYPE_BOTH,
    ESTIMATION_TYPE_POINTS,
    ESTIMATION_TYPE_TIME,
    getDoneTimeValue,
    getEstimationTypeToUse,
} from '../../../utils/EstimationHelper'
import StackedBarChart from './StackedBarChart'
import {
    getDataForAllProjectsCharts,
    STATISTIC_CHART_DONE_POINTS,
    STATISTIC_CHART_DONE_TASKS,
    STATISTIC_CHART_DONE_TIME,
    STATISTIC_CHART_GOLD,
    STATISTIC_CHART_XP,
} from '../../../utils/StatisticChartsHelper'
import { translate } from '../../../i18n/TranslationService'
import ChartsOptionsButton from './ChartsOptionsButton'
import StatisticItemWrapper from '../../StatisticsView/StatisticsSection/StatisticItemWrapper'
import SelectProjectModalInInvoceGenerationWrapper from './SelectProjectModalInInvoceGenerationWrapper'
import DefaultCurrency from './DefaultCurrency'
import { convertCurrency, formatCurrency } from '../../../utils/CurrencyConverter'

export default function UserStatistics() {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const loggedUser = useSelector(state => state.loggedUser)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const filterData = useSelector(state => state.loggedUser.statisticsData)
    const { timestamp1, timestamp2 } = getDateRangesTimestamps(filterData, true)
    const [doneTasksByProject, setDoneTasksByProject] = useState({ total: 0 })
    const [donePointsByProject, setDonePointsByProject] = useState({ total: 0 })
    const [doneTimeByProject, setDoneTimeByProject] = useState({ total: 0 })
    const [xpByProject, setXpByProject] = useState({ total: 0 })
    const [goldByProject, setGoldByProject] = useState({ total: 0 })

    const [allDoneTasksByProject, setAllDoneTasksByProject] = useState({ total: null })
    const [allDonePointsByProject, setAllDonePointsByProject] = useState({ total: null })
    const [allDoneTimeByProject, setAllDoneTimeByProject] = useState({ total: null })
    const [allXpByProject, setAllXpByProject] = useState({ total: null })
    const [allGoldByProject, setAllGoldByProject] = useState({ total: null })

    const [selectedChart, setSelectedChart] = useState(STATISTIC_CHART_DONE_TASKS)
    const estimationTypeToUse = getEstimationTypeToUse()

    // Calculate money earned across all projects
    const calculateMoneyEarned = () => {
        const defaultCurrency = loggedUser.defaultCurrency || 'EUR'
        const loggedUserId = loggedUser.uid
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

    const moneyEarned = calculateMoneyEarned()
    const defaultCurrency = loggedUser.defaultCurrency || 'EUR'
    const showMoneyEarned = moneyEarned > 0

    const writeBrowserURL = () => {
        return URLsSettings.push(URL_SETTINGS_STATISTICS)
    }

    useEffect(() => {
        writeBrowserURL()
    }, [])

    return (
        <View style={localStyles.container}>
            <StatisticsHeader
                setDoneTasksByProject={setDoneTasksByProject}
                setDonePointsByProject={setDonePointsByProject}
                setDoneTimeByProject={setDoneTimeByProject}
                setXpByProject={setXpByProject}
                setGoldByProject={setGoldByProject}
                setAllDoneTasksByProject={setAllDoneTasksByProject}
                setAllDonePointsByProject={setAllDonePointsByProject}
                setAllDoneTimeByProject={setAllDoneTimeByProject}
                setAllXpByProject={setAllXpByProject}
                setAllGoldByProject={setAllGoldByProject}
            />

            <View style={[localStyles.properties, mobile && localStyles.propertiesMobile]}>
                <View
                    style={[
                        localStyles.propertiesSection,
                        mobile && localStyles.propertiesSectionMobile,
                        { marginRight: mobile ? 0 : 36 },
                    ]}
                >
                    <StatisticItemWrapper
                        title={'Done tasks by projects'}
                        subtitle={'Here you can see how much tasks you have done by project'}
                        estimationType={ESTIMATION_TYPE_BOTH}
                        statistics={doneTasksByProject}
                    >
                        <StatisticItem
                            icon="check-square"
                            text={'Done tasks'}
                            amount={parseNumberToUseThousand(doneTasksByProject.total)}
                        />
                    </StatisticItemWrapper>

                    <StatisticItemWrapper
                        title={'Gold points by projects'}
                        subtitle={'Here you can see how gold points you have earned by project'}
                        estimationType={ESTIMATION_TYPE_BOTH}
                        statistics={goldByProject}
                    >
                        <StatisticItem
                            isGold={true}
                            text={'Gold points'}
                            amount={parseNumberToUseThousand(goldByProject.total)}
                        />
                    </StatisticItemWrapper>
                </View>

                <View
                    style={[
                        localStyles.propertiesSection,
                        mobile && localStyles.propertiesSectionMobile,
                        { marginLeft: mobile ? 0 : 36 },
                    ]}
                >
                    {(estimationTypeToUse === ESTIMATION_TYPE_POINTS ||
                        estimationTypeToUse === ESTIMATION_TYPE_BOTH) && (
                        <StatisticItemWrapper
                            title={'Estimation by projects'}
                            subtitle={'Here you can see how much points you have logged by project'}
                            estimationType={ESTIMATION_TYPE_POINTS}
                            statistics={donePointsByProject}
                        >
                            <StatisticItem
                                icon="story-point"
                                text={'Done points'}
                                amount={parseNumberToUseThousand(donePointsByProject.total)}
                            />
                        </StatisticItemWrapper>
                    )}
                    {(estimationTypeToUse === ESTIMATION_TYPE_TIME || estimationTypeToUse === ESTIMATION_TYPE_BOTH) && (
                        <StatisticItemWrapper
                            title={'Estimation by projects'}
                            subtitle={'Here you can see how much hours you have logged by project'}
                            estimationType={ESTIMATION_TYPE_TIME}
                            statistics={doneTimeByProject}
                        >
                            <StatisticItem
                                icon="clock"
                                text={'Time logged'}
                                amount={getDoneTimeValue(doneTimeByProject.total)}
                            />
                        </StatisticItemWrapper>
                    )}

                    {showMoneyEarned && (
                        <StatisticItem
                            icon="credit-card"
                            text="Money earned"
                            amount={formatCurrency(moneyEarned, defaultCurrency)}
                        />
                    )}

                    <StatisticItemWrapper
                        title={'XP by projects'}
                        subtitle={'Here you can see how XP you have earned by project'}
                        estimationType={ESTIMATION_TYPE_BOTH}
                        statistics={xpByProject}
                    >
                        <StatisticItem
                            icon="trending-up"
                            text="XP"
                            amount={parseNumberToUseThousand(xpByProject.total)}
                        />
                    </StatisticItemWrapper>
                    <DefaultCurrency userId={loggedUser.uid} defaultCurrency={loggedUser.defaultCurrency} />
                    <SelectProjectModalInInvoceGenerationWrapper />
                </View>
            </View>

            <View style={[localStyles.properties, localStyles.propertiesMobile]}>
                <View style={[localStyles.propertiesSection, localStyles.propertiesSectionMobile]}>
                    <ChartsOptionsButton
                        key={selectedChart}
                        selectedChart={selectedChart}
                        setSelectedChart={setSelectedChart}
                        estimationTypeToUse={estimationTypeToUse}
                    />

                    {(() => {
                        switch (selectedChart) {
                            case STATISTIC_CHART_DONE_TASKS:
                                return (
                                    <StackedBarChart
                                        title={translate('Done tasks')}
                                        statisticData={getDataForAllProjectsCharts(
                                            allDoneTasksByProject,
                                            timestamp1,
                                            timestamp2
                                        )}
                                    />
                                )
                            case STATISTIC_CHART_DONE_POINTS:
                                return (
                                    <StackedBarChart
                                        title={translate('Done points')}
                                        statisticData={getDataForAllProjectsCharts(
                                            allDonePointsByProject,
                                            timestamp1,
                                            timestamp2
                                        )}
                                    />
                                )
                            case STATISTIC_CHART_DONE_TIME:
                                return (
                                    <StackedBarChart
                                        title={`${translate('Time logged')} (${translate('hours')})`}
                                        statisticData={getDataForAllProjectsCharts(
                                            allDoneTimeByProject,
                                            timestamp1,
                                            timestamp2
                                        )}
                                    />
                                )
                            case STATISTIC_CHART_GOLD:
                                return (
                                    <StackedBarChart
                                        title={translate('Gold points')}
                                        statisticData={getDataForAllProjectsCharts(
                                            allGoldByProject,
                                            timestamp1,
                                            timestamp2
                                        )}
                                    />
                                )
                            case STATISTIC_CHART_XP:
                                return (
                                    <StackedBarChart
                                        title={translate('XP')}
                                        statisticData={getDataForAllProjectsCharts(
                                            allXpByProject,
                                            timestamp1,
                                            timestamp2
                                        )}
                                    />
                                )
                        }
                    })()}
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
    },
    properties: {
        flex: 1,
        flexDirection: 'row',
        marginBottom: 32,
    },
    propertiesMobile: {
        flexDirection: 'column',
    },
    propertiesSection: {
        flex: 1,
        width: '50%',
    },
    propertiesSectionMobile: {
        width: '100%',
    },
})
