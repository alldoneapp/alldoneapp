import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import moment from 'moment'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import { getDateFormat } from '../../UIComponents/FloatModals/DateFormatPickerModal'
import { BACKLOG_DATE_STRING } from '../../TaskListView/Utils/TasksHelper'
import Icon from '../../Icon'
import { translate } from '../../../i18n/TranslationService'
import { generateDateHeaderText } from '../../../utils/EstimationHelper'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import SharedHelper from '../../../utils/SharedHelper'
import GoalTaskDateBarMoreButton from '../../UIComponents/FloatModals/MorePopupsOfMainViews/Tasks/GoalTaskDateBarMoreButton'

export default function OpenDateHeader({
    dateFormated,
    isFirstDay,
    amountTasks,
    estimation,
    projectId,
    ownerId,
    dateIndex,
}) {
    const loggedUser = useSelector(state => state.loggedUser)

    const weekdays = [
        translate('Monday'),
        translate('Tuesday'),
        translate('Wednesday'),
        translate('Thursday'),
        translate('Friday'),
        translate('Saturday'),
        translate('Sunday'),
    ]

    const dateIsToday = dateFormated === moment().format('YYYYMMDD')
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

    const loggedUserCanUpdateObject =
        loggedUser.uid === ownerId || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)
    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)

    return (
        <View style={[localStyles.container, isFirstDay ? localStyles.containerToday : undefined]}>
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
                    <GoalTaskDateBarMoreButton projectId={projectId} dateIndex={dateIndex} />
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
