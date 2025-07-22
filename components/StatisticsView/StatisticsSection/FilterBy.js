import React, { useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { StyleSheet, Text, View } from 'react-native'
import Popover from 'react-tiny-popover'
import moment from 'moment'

import SelectDateModal from './SelectDateModal'
import { hideFloatPopup, showFloatPopup } from '../../../redux/actions'
import styles, { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import { getDateFormat } from '../../UIComponents/FloatModals/DateFormatPickerModal'
import { translate } from '../../../i18n/TranslationService'
import {
    STATISTIC_RANGE_CURRENT_MONTH,
    STATISTIC_RANGE_LAST_14_DAYS,
    STATISTIC_RANGE_LAST_7_DAYS,
    STATISTIC_RANGE_LAST_MONTH,
    STATISTIC_RANGE_TODAY,
} from '../statisticsHelper'

export default function FilterBy({ updateFilterData, statisticsFilter, modalDescription, showWarningIconInModal }) {
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

    const getRangeText = () => {
        let rangeDate = statisticsFilter
        if (statisticsFilter === STATISTIC_RANGE_TODAY) {
            const startDay = moment()
            rangeDate = `${translate(statisticsFilter)} ${startDay.format(getDateFormat(true))}`
        } else if (statisticsFilter === STATISTIC_RANGE_LAST_7_DAYS) {
            const startDay = moment().subtract(1, 'week')
            const endDay = moment()
            rangeDate = `${translate(statisticsFilter)} ${startDay.format(getDateFormat(true))}-${endDay.format(
                getDateFormat(true)
            )}`
        } else if (statisticsFilter === STATISTIC_RANGE_LAST_14_DAYS) {
            const startDay = moment().subtract(2, 'weeks')
            const endDay = moment()
            rangeDate = `${translate(statisticsFilter)} ${startDay.format(getDateFormat(true))}-${endDay.format(
                getDateFormat(true)
            )}`
        } else if (statisticsFilter === STATISTIC_RANGE_LAST_MONTH) {
            const startDay = moment().subtract(1, 'month').startOf('month')
            const endDay = startDay.clone().add(startDay.daysInMonth() - 1, 'day')
            rangeDate = `${translate(statisticsFilter)} ${startDay.format(getDateFormat(true))}-${endDay.format(
                getDateFormat(true)
            )}`
        } else if (statisticsFilter === STATISTIC_RANGE_CURRENT_MONTH) {
            const startDay = moment().startOf('month')
            const endDay = startDay.clone().add(startDay.daysInMonth() - 1, 'day')
            rangeDate = `${translate(statisticsFilter)} ${startDay.format(getDateFormat(true))}-${endDay.format(
                getDateFormat(true)
            )}`
        }
        return rangeDate
    }

    const rangeText = getRangeText()
    return (
        <Popover
            content={
                <SelectDateModal
                    modalDescription={modalDescription}
                    updateFilterData={updateFilterData}
                    hidePopover={hidePopover}
                    statisticsFilter={statisticsFilter}
                    showWarningIconInModal={showWarningIconInModal}
                />
            }
            onClickOutside={hidePopover}
            isOpen={visiblePopover}
            position={['bottom', 'left', 'right', 'top']}
            padding={4}
            align={'end'}
            contentLocation={smallScreen ? null : undefined}
        >
            <View style={localStyles.container}>
                <Text style={[styles.body2, { color: colors.Text02 }]}>{translate('Filtered By')}</Text>
                <Button
                    title={rangeText}
                    type={'ghost'}
                    icon={'calendar'}
                    buttonStyle={{ marginLeft: 16 }}
                    onPress={showPopover}
                />
            </View>
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        paddingLeft: 16,
        height: 40,
        borderLeftWidth: 1,
        borderColor: colors.Grey200,
        alignItems: 'center',
    },
})
