import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { applyPopoverWidth } from '../../../utils/HelperFunctions'
import CloseButton from '../../FollowUp/CloseButton'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import Hotkeys from 'react-hot-keys'
import Icon from '../../Icon'
import Shortcut, { SHORTCUT_LIGHT } from '../../UIControls/Shortcut'
import { useSelector } from 'react-redux'
import {
    getChartName,
    STATISTIC_CHART_DONE_POINTS,
    STATISTIC_CHART_DONE_TASKS,
    STATISTIC_CHART_DONE_TIME,
    STATISTIC_CHART_GOLD,
    STATISTIC_CHART_XP,
} from '../../../utils/StatisticChartsHelper'
import { ESTIMATION_TYPE_BOTH, ESTIMATION_TYPE_POINTS, ESTIMATION_TYPE_TIME } from '../../../utils/EstimationHelper'

const StatisticChartsOptions = ({ chart, setChart, hidePopover, estimationTypeToUse }) => {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const chartList = [
        STATISTIC_CHART_DONE_TASKS,
        STATISTIC_CHART_DONE_POINTS,
        STATISTIC_CHART_DONE_TIME,
        STATISTIC_CHART_GOLD,
        STATISTIC_CHART_XP,
    ]

    if (estimationTypeToUse !== ESTIMATION_TYPE_POINTS && estimationTypeToUse !== ESTIMATION_TYPE_BOTH) {
        const index = chartList.indexOf(STATISTIC_CHART_DONE_POINTS)
        chartList.splice(index, 1)
    }
    if (estimationTypeToUse !== ESTIMATION_TYPE_TIME && estimationTypeToUse !== ESTIMATION_TYPE_BOTH) {
        const index = chartList.indexOf(STATISTIC_CHART_DONE_TIME)
        chartList.splice(index, 1)
    }

    const selectChart = value => {
        setChart(value)
        hidePopover()
    }

    return (
        <View style={[localStyles.container, applyPopoverWidth()]}>
            <View style={localStyles.innerContainer}>
                <View style={localStyles.heading}>
                    <Text style={localStyles.title}>{translate('Select chart')}</Text>
                    <Text style={localStyles.description}>{translate('Select chart description')}</Text>
                </View>

                <View style={{ marginTop: 20, paddingHorizontal: 16 }}>
                    {chartList.map((chartItem, i) => {
                        const selected = chartItem === chart
                        const shortcutText = `${i + 1}`

                        return (
                            <Hotkeys keyName={shortcutText} onKeyDown={() => selectChart(chartItem)} filter={e => true}>
                                <TouchableOpacity
                                    style={localStyles.chartContainer}
                                    onPress={() => selectChart(chartItem)}
                                    accessible={false}
                                >
                                    <Text style={[styles.subtitle1, { color: 'white' }]}>
                                        {translate(getChartName(chartItem))}
                                    </Text>
                                    <View style={localStyles.shortcut}>
                                        {selected && <Icon name="check" size={24} color="white" />}
                                        {!mobile && (
                                            <Shortcut
                                                text={shortcutText}
                                                theme={SHORTCUT_LIGHT}
                                                containerStyle={{ marginLeft: 4 }}
                                            />
                                        )}
                                    </View>
                                </TouchableOpacity>
                            </Hotkeys>
                        )
                    })}
                </View>
            </View>
            <CloseButton close={hidePopover} />
        </View>
    )
}

export default StatisticChartsOptions

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        width: 305,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    innerContainer: {
        flexDirection: 'column',
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
    },
    heading: {
        flexDirection: 'column',
        paddingLeft: 16,
        paddingTop: 16,
        paddingRight: 16,
    },
    title: {
        ...styles.title7,
        color: '#ffffff',
    },
    description: {
        ...styles.body2,
        color: colors.Text03,
    },

    chartContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 40,
    },
    shortcut: {
        flexDirection: 'row',
        position: 'absolute',
        right: 0,
    },
})
