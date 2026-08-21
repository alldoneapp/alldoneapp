import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import moment from 'moment'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import { getDateFormat } from '../../UIComponents/FloatModals/DateFormatPickerModal'
import { BACKLOG_DATE_STRING } from '../Utils/TasksHelper'
import Icon from '../../Icon'
import { translate } from '../../../i18n/TranslationService'
import { generateDateHeaderText } from '../../../utils/EstimationHelper'
import CalendarSyncButton from '../../UIComponents/CalendarSyncButton'
import {
    AMOUNT_TASKS_INDEX,
    CALENDAR_TASK_INDEX,
    DATE_TASK_INDEX,
    ESTIMATION_TASKS_INDEX,
    TODAY_DATE,
} from '../../../utils/backends/openTasks'

export default function OpenTasksDateHeader({ instanceKey, projectId, dateIndex, additionalTasksAmount = 0 }) {
    const dateFormated = useSelector(state => state.filteredOpenTasksStore[instanceKey][dateIndex][DATE_TASK_INDEX])
    const amountTasks = useSelector(state => state.filteredOpenTasksStore[instanceKey][dateIndex][AMOUNT_TASKS_INDEX])
    const estimation = useSelector(
        state => state.filteredOpenTasksStore[instanceKey][dateIndex][ESTIMATION_TASKS_INDEX]
    )
    // AT-2377: the Calendar section carries the re-sync control in its own header again. Showing it
    // here as well would put two refresh icons on the same day, so this one only stands in when the
    // day renders no Calendar section - which is exactly the case the section could never cover.
    const dayHasCalendarSection = useSelector(
        state => state.filteredOpenTasksStore[instanceKey][dateIndex][CALENDAR_TASK_INDEX].length > 0
    )
    const weekdays = [
        translate('Monday'),
        translate('Tuesday'),
        translate('Wednesday'),
        translate('Thursday'),
        translate('Friday'),
        translate('Saturday'),
        translate('Sunday'),
    ]

    const dateIsToday = dateFormated === TODAY_DATE
    const isMainDay = dateIsToday
    const date = dateIsToday ? moment() : moment(dateFormated, 'YYYYMMDD')

    let dayName = ''
    const dateText = dateIsToday ? 'Today' : dateFormated
    let upperCaseDateText = dateText.toUpperCase()
    const inBacklog = upperCaseDateText === BACKLOG_DATE_STRING

    if (date._isValid) {
        dayName = weekdays[moment(date).isoWeekday() - 1].toUpperCase()
        if (
            upperCaseDateText !== 'TODAY' &&
            upperCaseDateText !== 'TOMORROW' &&
            upperCaseDateText !== 'YESTERDAY' &&
            upperCaseDateText !== BACKLOG_DATE_STRING
        ) {
            upperCaseDateText = date.format(getDateFormat())
        } else {
            upperCaseDateText = translate(upperCaseDateText)
        }
    }

    const text = generateDateHeaderText(
        projectId,
        upperCaseDateText,
        dayName,
        estimation,
        amountTasks + additionalTasksAmount
    )

    return (
        <View style={[localStyles.container, isMainDay ? localStyles.containerToday : undefined]}>
            <View style={[localStyles.innerContainer, inBacklog && localStyles.inBacklogIContainer]}>
                <View style={{ flex: 1, justifyContent: 'flex-start', flexDirection: 'row' }}>
                    {inBacklog && (
                        <View style={localStyles.backlogIcon}>
                            <Icon name={'layers'} size={16} color={colors.Text02} />
                        </View>
                    )}
                    <Text style={[styles.overline, localStyles.dateText, inBacklog && localStyles.textBacklog]}>
                        {text}
                    </Text>
                </View>
                {isMainDay && !dayHasCalendarSection && (
                    <CalendarSyncButton projectId={projectId} containerStyle={localStyles.syncButton} />
                )}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingTop: 24,
        paddingBottom: 8,
    },
    containerToday: {
        paddingTop: 8,
        paddingBottom: 8,
    },
    innerContainer: {
        flex: 1,
        justifyContent: 'space-between',
        flexDirection: 'row',
        backgroundColor: colors.Grey100,
        borderRadius: 4,
        height: 24,
        alignItems: 'center',
    },
    inBacklogIContainer: {
        backgroundColor: colors.Grey300,
    },
    dateText: {
        color: colors.Text02,
        zIndex: 1,
        paddingLeft: 12,
    },
    backlogIcon: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 8,
    },
    textBacklog: {
        paddingLeft: 0,
    },
    syncButton: {
        marginLeft: 8,
        marginRight: 8,
    },
})
