import React, { useEffect, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import moment from 'moment'

import StatisticItem from './StatisticItem'
import { getDateRangesTimestamps, parseNumberToUseThousand } from '../statisticsHelper'
import {
    ESTIMATION_TYPE_BOTH,
    ESTIMATION_TYPE_POINTS,
    ESTIMATION_TYPE_TIME,
    getDoneTimeValue,
    getEstimationTypeToUse,
} from '../../../utils/EstimationHelper'
import StatisticsSectionHeader from './StatisticsSectionHeader'
import { useSelector } from 'react-redux'
import StackedBarChart from '../../SettingsView/Statistics/StackedBarChart'
import { translate } from '../../../i18n/TranslationService'
import {
    getDataForOneProjectCharts,
    STATISTIC_CHART_DONE_POINTS,
    STATISTIC_CHART_DONE_TASKS,
    STATISTIC_CHART_DONE_TIME,
    STATISTIC_CHART_MONEY_EARNED,
    STATISTIC_CHART_GOLD,
    STATISTIC_CHART_XP,
} from '../../../utils/StatisticChartsHelper'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import ChartsOptionsButton from '../../SettingsView/Statistics/ChartsOptionsButton'
import HourlyRateAndCurrencyWrapper from './HourlyRateAndCurrency/HourlyRateAndCurrencyWrapper'
import FilterByUser from './FilterByUser'
import InvoiceInfoWrapper from '../../Invoicing/InvoiceInfoWrapper'
import { formatCurrency } from '../../../utils/CurrencyConverter'
import Button from '../../UIControls/Button'
import {
    markDayRateDayWorked,
    normalizeDayRateTimeLogConfig,
    reconcileProjectDayRateTimeLogsBackfill,
} from '../../../utils/DayRateTimeLogHelper'

export default function StatisticsSection({
    projectId,
    updateFilterData,
    statisticsData,
    allStatisticsData,
    statisticsFilter,
    filterData,
    moneyEarned = 0,
}) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const statisticsSelectedUsersIds = useSelector(state => state.loggedUser.statisticsSelectedUsersIds[projectId])
    const { timestamp1, timestamp2 } = getDateRangesTimestamps(filterData, true)
    const project = ProjectHelper.getProjectById(projectId)
    const { doneTasks, gold, donePoints, doneTime, xp } = statisticsData
    const { allDoneTasks, allDonePoints, allGold, allDoneTime, allXp, allMoneyEarned } = allStatisticsData
    const [selectedChart, setSelectedChart] = useState(STATISTIC_CHART_DONE_TASKS)
    const [backfillingDayRate, setBackfillingDayRate] = useState(false)
    const estimationTypeToUse = getEstimationTypeToUse(projectId)

    const isGuide = !!project.parentTemplateId
    const currency = project?.hourlyRatesData?.currency || 'EUR'
    const showMoneyEarned = moneyEarned > 0
    const hasMoneyChart = showMoneyEarned && allMoneyEarned && Object.keys(allMoneyEarned).length > 0
    const dayRateTimeLog = normalizeDayRateTimeLogConfig(project?.dayRateTimeLog)
    const canMarkDayWorked = dayRateTimeLog.enabled && timestamp1.isSame(timestamp2, 'day')

    const markWorkedDay = () => {
        markDayRateDayWorked(projectId, loggedUserId, timestamp1.valueOf(), {
            source: 'statistics-mark-day-worked',
        }).catch(error => {
            console.log(error)
        })
    }

    const backfillDayRateProject = async () => {
        if (!project || backfillingDayRate) return

        setBackfillingDayRate(true)
        try {
            await reconcileProjectDayRateTimeLogsBackfill(
                project,
                loggedUserId,
                project.projectStartDate || project.created,
                moment().subtract(1, 'day').endOf('day').valueOf(),
                { forceFromProjectStart: true, source: 'statistics-reset-backfill' }
            )
        } catch (error) {
            console.log(error)
        } finally {
            setBackfillingDayRate(false)
        }
    }

    useEffect(() => {
        if (!hasMoneyChart && selectedChart === STATISTIC_CHART_MONEY_EARNED) {
            setSelectedChart(STATISTIC_CHART_DONE_TASKS)
        }
    }, [hasMoneyChart, selectedChart])

    return (
        <View style={localStyles.container}>
            <StatisticsSectionHeader updateFilterData={updateFilterData} statisticsFilter={statisticsFilter} />

            <View style={[localStyles.properties, mobile && localStyles.propertiesMobile]}>
                <View
                    style={[
                        localStyles.propertiesSection,
                        mobile && localStyles.propertiesSectionMobile,
                        { marginRight: mobile ? 0 : 36 },
                    ]}
                >
                    <StatisticItem icon="check-square" text="Done tasks" amount={parseNumberToUseThousand(doneTasks)} />
                    <StatisticItem isGold={true} text="Gold points" amount={parseNumberToUseThousand(gold)} />
                    {!isGuide && (
                        <HourlyRateAndCurrencyWrapper projectId={projectId} hourlyRatesData={project.hourlyRatesData} />
                    )}
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
                        <StatisticItem
                            icon="story-point"
                            text="Done points"
                            amount={parseNumberToUseThousand(donePoints)}
                        />
                    )}
                    {(estimationTypeToUse === ESTIMATION_TYPE_TIME || estimationTypeToUse === ESTIMATION_TYPE_BOTH) && (
                        <StatisticItem icon="clock" text="Time logged" amount={getDoneTimeValue(doneTime)} />
                    )}
                    {showMoneyEarned && (
                        <StatisticItem
                            icon="credit-card"
                            text="Money earned"
                            amount={formatCurrency(moneyEarned, currency)}
                        />
                    )}
                    <StatisticItem icon="trending-up" text="XP" amount={parseNumberToUseThousand(xp)} />
                    <FilterByUser
                        projectIndex={project.index}
                        projectId={project.id}
                        filterByUsers={statisticsSelectedUsersIds ? statisticsSelectedUsersIds : [loggedUserId]}
                    />
                    {!isGuide && (
                        <InvoiceInfoWrapper
                            filterData={filterData}
                            projectId={project.id}
                            timestamp1={timestamp1}
                            timestamp2={timestamp2}
                        />
                    )}
                    {canMarkDayWorked && (
                        <Button
                            icon="clock"
                            title={translate('Mark day worked')}
                            type="ghost"
                            onPress={markWorkedDay}
                            buttonStyle={localStyles.markWorkedButton}
                        />
                    )}
                    {dayRateTimeLog.enabled && (
                        <Button
                            icon="rotate-cw"
                            title={translate(
                                backfillingDayRate ? 'Backfilling day-rate...' : 'Reset and backfill day-rate'
                            )}
                            type="ghost"
                            onPress={backfillDayRateProject}
                            disabled={backfillingDayRate}
                            buttonStyle={localStyles.markWorkedButton}
                        />
                    )}
                </View>
            </View>

            <View style={[localStyles.properties, localStyles.propertiesMobile, { marginVertical: 24 }]}>
                <View style={[localStyles.propertiesSection, localStyles.propertiesSectionMobile]}>
                    <ChartsOptionsButton
                        key={selectedChart}
                        selectedChart={selectedChart}
                        setSelectedChart={setSelectedChart}
                        estimationTypeToUse={estimationTypeToUse}
                        hasMoneyChart={hasMoneyChart}
                    />

                    {(() => {
                        switch (selectedChart) {
                            case STATISTIC_CHART_DONE_TASKS:
                                return (
                                    <StackedBarChart
                                        title={translate('Done tasks')}
                                        statisticData={getDataForOneProjectCharts(allDoneTasks, timestamp1, timestamp2)}
                                        project={project}
                                    />
                                )
                            case STATISTIC_CHART_DONE_POINTS:
                                return (
                                    <StackedBarChart
                                        title={translate('Done points')}
                                        statisticData={getDataForOneProjectCharts(
                                            allDonePoints,
                                            timestamp1,
                                            timestamp2
                                        )}
                                        project={project}
                                    />
                                )
                            case STATISTIC_CHART_DONE_TIME:
                                return (
                                    <StackedBarChart
                                        title={`${translate('Time logged')} (${translate('hours')})`}
                                        statisticData={getDataForOneProjectCharts(allDoneTime, timestamp1, timestamp2)}
                                        project={project}
                                    />
                                )
                            case STATISTIC_CHART_MONEY_EARNED:
                                return (
                                    <StackedBarChart
                                        title={`${translate('Money earned')} (${currency})`}
                                        statisticData={getDataForOneProjectCharts(
                                            allMoneyEarned || {},
                                            timestamp1,
                                            timestamp2
                                        )}
                                        project={project}
                                    />
                                )
                            case STATISTIC_CHART_GOLD:
                                return (
                                    <StackedBarChart
                                        title={translate('Gold points')}
                                        statisticData={getDataForOneProjectCharts(allGold, timestamp1, timestamp2)}
                                        project={project}
                                    />
                                )
                            case STATISTIC_CHART_XP:
                                return (
                                    <StackedBarChart
                                        title={translate('XP')}
                                        statisticData={getDataForOneProjectCharts(allXp, timestamp1, timestamp2)}
                                        project={project}
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
        flexDirection: 'column',
    },
    properties: {
        flex: 1,
        flexDirection: 'row',
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
    markWorkedButton: {
        alignSelf: 'flex-start',
        marginTop: 8,
    },
})
