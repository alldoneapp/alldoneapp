import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import moment from 'moment'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import { getDateFormat } from '../../UIComponents/FloatModals/DateFormatPickerModal'
import { BACKLOG_DATE_STRING } from '../Utils/TasksHelper'
import Icon from '../../Icon'
import TaskDateBarMoreButton from '../../UIComponents/FloatModals/MorePopupsOfMainViews/Tasks/TaskDateBarMoreButton'
import { translate } from '../../../i18n/TranslationService'
import { generateDateHeaderText } from '../../../utils/EstimationHelper'
import {
    AMOUNT_TASKS_INDEX,
    DATE_TASK_INDEX,
    ESTIMATION_TASKS_INDEX,
    TODAY_DATE,
} from '../../../utils/backends/openTasks'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'

export default function OpenTasksDateHeader({ instanceKey, projectId, dateIndex, accessGranted }) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const dateFormated = useSelector(state => state.filteredOpenTasksStore[instanceKey][dateIndex][DATE_TASK_INDEX])
    const amountTasks = useSelector(state => state.filteredOpenTasksStore[instanceKey][dateIndex][AMOUNT_TASKS_INDEX])
    const estimation = useSelector(
        state => state.filteredOpenTasksStore[instanceKey][dateIndex][ESTIMATION_TASKS_INDEX]
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

    const text = generateDateHeaderText(projectId, upperCaseDateText, dayName, estimation, amountTasks)

    const loggedUserIsBoardOwner = loggedUserId === currentUserId
    const loggedUserCanUpdateObject =
        loggedUserIsBoardOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

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
                {accessGranted && loggedUserCanUpdateObject && (
                    <TaskDateBarMoreButton projectId={projectId} dateIndex={dateIndex} instanceKey={instanceKey} />
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
})
