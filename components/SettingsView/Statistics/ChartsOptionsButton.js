import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import Button from '../../UIControls/Button'
import StatisticChartsOptions from './StatisticChartsOptions'
import { hideFloatPopup, showFloatPopup } from '../../../redux/actions'
import { useDispatch, useSelector } from 'react-redux'
import { getChartName } from '../../../utils/StatisticChartsHelper'
import { translate } from '../../../i18n/TranslationService'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../styles/global'

const ChartsOptionsButton = ({ selectedChart, setSelectedChart, estimationTypeToUse }) => {
    const dispatch = useDispatch()
    const smallScreen = useSelector(state => state.smallScreen)
    const [visiblePopover, setVisiblePopover] = useState(false)

    const showPopover = () => {
        setVisiblePopover(true)
        dispatch(showFloatPopup())
    }

    const hidePopover = () => {
        setTimeout(() => {
            setVisiblePopover(false)
            dispatch(hideFloatPopup())
        })
    }

    return (
        <View style={localStyles.container}>
            <Popover
                content={
                    <StatisticChartsOptions
                        chart={selectedChart}
                        setChart={setSelectedChart}
                        hidePopover={hidePopover}
                        estimationTypeToUse={estimationTypeToUse}
                    />
                }
                onClickOutside={hidePopover}
                isOpen={visiblePopover}
                position={['bottom', 'left', 'right', 'top']}
                padding={4}
                align={'end'}
                contentLocation={smallScreen ? null : undefined}
            >
                <View style={localStyles.btnContainer}>
                    <Text style={[styles.body2, { color: colors.Text02 }]}>
                        {translate('Statistic chart selector')}
                    </Text>
                    <Button
                        title={translate(getChartName(selectedChart))}
                        type={'ghost'}
                        icon={'bar-chart-2'}
                        buttonStyle={{ marginLeft: 16 }}
                        onPress={showPopover}
                    />
                </View>
            </Popover>
        </View>
    )
}

export default ChartsOptionsButton

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'flex-end',
    },
    btnContainer: {
        flexDirection: 'row',
        paddingLeft: 16,
        height: 40,
        borderLeftWidth: 1,
        borderColor: colors.Grey200,
        alignItems: 'center',
    },
})
